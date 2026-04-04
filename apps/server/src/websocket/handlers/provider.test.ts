/**
 * Provider Handler Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProviderHandler, registerProviderHandlers, createProviderHandler } from './provider';
import { MessageRouter, type HandlerContext } from '../message-router';
import { ConnectionManager } from '../connection-manager';
import { createWSMessage, WS_ERROR_CODES } from '@openaidy/shared-types';
import type { ProviderServices } from '../../providers';
import type { ProviderRegistryService } from '../../providers/registry';
import type { ModelProvider, ProviderDescriptor } from '@openaidy/runtime';

// ============================================================================
// Mock Factories
// ============================================================================

const createMockLogger = () => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  child: vi.fn(() => createMockLogger()),
  level: 'info',
  silent: false,
});

const createMockProviderServices = (): ProviderServices => {
  const providers: Map<string, { provider: ModelProvider; enabled: boolean }> = new Map([
    [
      'openai',
      {
        provider: {
          descriptor: {
            id: 'openai',
            name: 'OpenAI',
            vendorFamily: 'openai',
            capabilities: ['chat', 'streaming'],
            models: [
              { id: 'gpt-4', name: 'GPT-4', capabilities: ['chat', 'streaming'] },
              { id: 'gpt-4o-mini', name: 'GPT-4o Mini', capabilities: ['chat', 'streaming'] },
            ],
          },
        } as ModelProvider,
        enabled: true,
      },
    ],
    [
      'anthropic',
      {
        provider: {
          descriptor: {
            id: 'anthropic',
            name: 'Anthropic',
            vendorFamily: 'anthropic',
            capabilities: ['chat', 'streaming'],
            models: [
              { id: 'claude-3-opus', name: 'Claude 3 Opus', capabilities: ['chat', 'streaming'] },
            ],
          },
        } as ModelProvider,
        enabled: true,
      },
    ],
    [
      'disabled-provider',
      {
        provider: {
          descriptor: {
            id: 'disabled-provider',
            name: 'Disabled Provider',
            vendorFamily: 'test',
            capabilities: [],
            models: [],
          },
        } as ModelProvider,
        enabled: false,
      },
    ],
  ]);

  const registry = {
    listDescriptors: vi.fn().mockImplementation(() => {
      return Array.from(providers.values())
        .filter((p) => p.enabled)
        .map((p) => p.provider.descriptor);
    }),
    listAllDescriptors: vi.fn().mockImplementation(() => {
      return Array.from(providers.values()).map((p) => p.provider.descriptor);
    }),
    get: vi.fn().mockImplementation((id: string) => {
      const entry = providers.get(id);
      if (!entry || !entry.enabled) return undefined;
      return entry.provider;
    }),
    has: vi.fn().mockImplementation((id: string) => providers.has(id)),
    register: vi.fn(),
    unregister: vi.fn(),
    enable: vi.fn(),
    disable: vi.fn(),
    isEnabled: vi.fn(),
    size: providers.size,
    enabledCount: Array.from(providers.values()).filter((p) => p.enabled).length,
  } as unknown as ProviderRegistryService;

  return {
    registry,
    selection: {} as ProviderServices['selection'],
    invocation: {} as ProviderServices['invocation'],
  };
};

// ============================================================================
// Tests
// ============================================================================

describe('ProviderHandler', () => {
  let handler: ProviderHandler;
  let mockServices: ProviderServices;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let handlerContext: HandlerContext;
  let connectionManager: ConnectionManager;

  beforeEach(() => {
    mockServices = createMockProviderServices();
    mockLogger = createMockLogger();
    handler = new ProviderHandler(mockServices, mockLogger as unknown as HandlerContext['logger']);
    connectionManager = new ConnectionManager();
    handlerContext = {
      connectionManager,
      services: {},
      logger: mockLogger as unknown as HandlerContext['logger'],
    };
  });

  // ============================================================================
  // provider.list Tests
  // ============================================================================

  describe('handleList', () => {
    it('should list enabled providers', async () => {
      const request = createWSMessage('provider.list', {});
      const response = await handler.handleList('conn-1', request as never, handlerContext);

      expect(response.type).toBe('provider.list');
      expect(response.payload.providers).toHaveLength(2);
      expect(response.payload.providers[0].id).toBe('openai');
      expect(response.payload.providers[1].name).toBe('Anthropic');
    });

    it('should only include enabled providers', async () => {
      const request = createWSMessage('provider.list', {});
      const response = await handler.handleList('conn-1', request as never, handlerContext);

      expect(response.payload.providers.find((p) => p.id === 'disabled-provider')).toBeUndefined();
    });

    it('should include provider capabilities', async () => {
      const request = createWSMessage('provider.list', {});
      const response = await handler.handleList('conn-1', request as never, handlerContext);

      expect(response.payload.providers[0].capabilities).toContain('chat');
      expect(response.payload.providers[0].capabilities).toContain('streaming');
    });

    it('should log provider list operation', async () => {
      const request = createWSMessage('provider.list', {});
      await handler.handleList('conn-1', request as never, handlerContext);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ connectionId: 'conn-1' }),
        'Listing providers via WebSocket',
      );
    });
  });

  // ============================================================================
  // provider.models Tests
  // ============================================================================

  describe('handleModels', () => {
    it('should get models for an existing provider', async () => {
      const request = createWSMessage('provider.models', { providerId: 'openai' });
      const response = await handler.handleModels('conn-1', request as never, handlerContext);

      expect(response.type).toBe('provider.models');
      expect(response.payload.providerId).toBe('openai');
      expect(response.payload.models).toHaveLength(2);
      expect(response.payload.models[0].id).toBe('gpt-4');
      expect(response.payload.models[1].name).toBe('GPT-4o Mini');
    });

    it('should return error for non-existent provider', async () => {
      const request = createWSMessage('provider.models', { providerId: 'non-existent' });
      const response = await handler.handleModels('conn-1', request as never, handlerContext);

      expect(response.type).toBe('error');
      expect(response.payload.error.code).toBe(WS_ERROR_CODES.NOT_FOUND);
      expect(response.payload.error.message).toContain('non-existent');
    });

    it('should return error for disabled provider', async () => {
      const request = createWSMessage('provider.models', { providerId: 'disabled-provider' });
      const response = await handler.handleModels('conn-1', request as never, handlerContext);

      expect(response.type).toBe('error');
      expect(response.payload.error.code).toBe(WS_ERROR_CODES.NOT_FOUND);
    });

    it('should include model capabilities when available', async () => {
      const request = createWSMessage('provider.models', { providerId: 'openai' });
      const response = await handler.handleModels('conn-1', request as never, handlerContext);

      expect(response.payload.models[0].capabilities).toContain('chat');
      expect(response.payload.models[0].capabilities).toContain('streaming');
    });

    it('should log provider models operation', async () => {
      const request = createWSMessage('provider.models', { providerId: 'openai' });
      await handler.handleModels('conn-1', request as never, handlerContext);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ connectionId: 'conn-1', providerId: 'openai' }),
        'Getting provider models via WebSocket',
      );
    });
  });

  // ============================================================================
  // Factory Function Tests
  // ============================================================================

  describe('createProviderHandler', () => {
    it('should create handler instance', () => {
      const handler = createProviderHandler(mockServices, mockLogger as never);
      expect(handler).toBeInstanceOf(ProviderHandler);
    });
  });

  // ============================================================================
  // Handler Registration Tests
  // ============================================================================

  describe('registerProviderHandlers', () => {
    it('should register provider.list handler', () => {
      const router = { registerHandler: vi.fn() };
      registerProviderHandlers(router, handler);

      expect(router.registerHandler).toHaveBeenCalledWith('provider.list', expect.any(Function));
    });

    it('should register provider.models handler', () => {
      const router = { registerHandler: vi.fn() };
      registerProviderHandlers(router, handler);

      expect(router.registerHandler).toHaveBeenCalledWith('provider.models', expect.any(Function));
    });

    it('should register exactly 2 handlers', () => {
      const router = { registerHandler: vi.fn() };
      registerProviderHandlers(router, handler);

      expect(router.registerHandler).toHaveBeenCalledTimes(2);
    });
  });
});
