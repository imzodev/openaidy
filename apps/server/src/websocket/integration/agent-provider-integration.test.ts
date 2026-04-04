/**
 * Agent & Provider Integration Tests
 *
 * Comprehensive integration tests for agent and provider operations via WebSocket.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConnectionManager } from '../connection-manager';
import { MessageRouter, type HandlerContext } from '../message-router';
import { AgentHandler, registerAgentHandlers } from '../handlers/agent';
import {
  ProviderHandler,
  registerProviderHandlers,
} from '../handlers/provider';
import {
  type AgentListResponse,
  type AgentGetResponse,
  type ProviderListResponse,
  type ProviderModelsResponse,
  type ErrorResponse,
  createWSMessage,
  WS_ERROR_CODES,
} from '@openaidy/shared-types';
import type { AgentRegistry } from '../../agents/registry';
import type { ProviderServices } from '../../providers';

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

const createMockAgentRegistry = (): AgentRegistry => {
  const agents = new Map([
    [
      'agent-1',
      {
        id: 'agent-1',
        name: 'Test Agent 1',
        description: 'First test agent',
        systemPrompt: 'You are a helpful assistant.',
        enabled: true,
        model: 'openai/gpt-4o-mini',
        tools: ['chat', 'code'],
        tags: ['general', 'coding'],
        version: 1,
      },
    ],
    [
      'agent-2',
      {
        id: 'agent-2',
        name: 'Test Agent 2',
        description: 'Second test agent',
        systemPrompt: 'You are a creative assistant.',
        enabled: true,
        model: 'anthropic/claude-3',
        tools: ['chat'],
        tags: ['creative'],
        version: 1,
      },
    ],
    [
      'agent-disabled',
      {
        id: 'agent-disabled',
        name: 'Disabled Agent',
        description: 'This agent is disabled',
        systemPrompt: 'You are disabled.',
        enabled: false,
        model: 'test/model',
        tools: [],
        tags: [],
        version: 1,
      },
    ],
  ]);

  return {
    listAgents: vi.fn().mockImplementation(() => {
      return Array.from(agents.values())
        .filter((a) => a.enabled)
        .map((a) => ({
          id: a.id,
          name: a.name,
          description: a.description,
          capabilities: a.tools ?? [],
        }));
    }),
    listAllAgents: vi.fn().mockImplementation(() => {
      return Array.from(agents.values()).map((a) => ({
        id: a.id,
        name: a.name,
        description: a.description,
        capabilities: a.tools ?? [],
      }));
    }),
    getAgent: vi.fn().mockImplementation((id: string) => agents.get(id)),
    hasAgent: vi.fn().mockImplementation((id: string) => agents.has(id)),
    load: vi.fn(),
    reload: vi.fn(),
    size: agents.size,
    enabledCount: Array.from(agents.values()).filter((a) => a.enabled).length,
  } as unknown as AgentRegistry;
};

const createMockProviderServices = (): ProviderServices => {
  const providers = new Map([
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
              {
                id: 'gpt-4',
                name: 'GPT-4',
                capabilities: ['chat', 'streaming'],
              },
              {
                id: 'gpt-4o-mini',
                name: 'GPT-4o Mini',
                capabilities: ['chat', 'streaming'],
              },
            ],
          },
        },
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
              {
                id: 'claude-3-opus',
                name: 'Claude 3 Opus',
                capabilities: ['chat', 'streaming'],
              },
            ],
          },
        },
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
        },
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
    enabledCount: Array.from(providers.values()).filter((p) => p.enabled)
      .length,
  };

  return {
    registry,
    selection: {} as ProviderServices['selection'],
    invocation: {} as ProviderServices['invocation'],
  };
};

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Send a message through the router and wait for response
 */
async function sendAndReceive<T>(
  router: MessageRouter,
  connectionId: string,
  type: string,
  payload: unknown,
  context: HandlerContext,
): Promise<T> {
  const message = createWSMessage(type, payload);
  const response = await router.route(connectionId, message, context);
  return response as T;
}

/**
 * Create a mock connection context
 */
function createMockHandlerContext(
  connectionManager: ConnectionManager,
  logger: HandlerContext['logger'],
): HandlerContext {
  return {
    connectionManager,
    services: {},
    logger,
  };
}

// ============================================================================
// Integration Tests
// ============================================================================

describe('Agent & Provider Integration Tests', () => {
  let connectionManager: ConnectionManager;
  let messageRouter: MessageRouter;
  let agentHandler: AgentHandler;
  let providerHandler: ProviderHandler;
  let mockAgentRegistry: AgentRegistry;
  let mockProviderServices: ProviderServices;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let handlerContext: HandlerContext;

  beforeEach(() => {
    mockLogger = createMockLogger();
    mockAgentRegistry = createMockAgentRegistry();
    mockProviderServices = createMockProviderServices();

    connectionManager = new ConnectionManager();
    messageRouter = new MessageRouter(mockLogger as HandlerContext['logger']);

    agentHandler = new AgentHandler(
      mockAgentRegistry,
      mockLogger as HandlerContext['logger'],
    );
    providerHandler = new ProviderHandler(
      mockProviderServices,
      mockLogger as HandlerContext['logger'],
    );

    registerAgentHandlers(messageRouter, agentHandler);
    registerProviderHandlers(messageRouter, providerHandler);

    handlerContext = createMockHandlerContext(
      connectionManager,
      mockLogger as HandlerContext['logger'],
    );
  });

  // ============================================================================
  // Agent Operations
  // ============================================================================

  describe('Agent Operations', () => {
    describe('agent.list', () => {
      it('should list enabled agents', async () => {
        const response = await sendAndReceive<AgentListResponse>(
          messageRouter,
          'conn-1',
          'agent.list',
          {},
          handlerContext,
        );

        expect(response.type).toBe('agent.list');
        expect(response.payload.agents).toBeDefined();
        expect(Array.isArray(response.payload.agents)).toBe(true);
        expect(response.payload.agents.length).toBe(2);
      });

      it('should only include enabled agents', async () => {
        const response = await sendAndReceive<AgentListResponse>(
          messageRouter,
          'conn-1',
          'agent.list',
          {},
          handlerContext,
        );

        const disabledAgent = response.payload.agents.find(
          (a) => a.id === 'agent-disabled',
        );
        expect(disabledAgent).toBeUndefined();
      });

      it('should include agent capabilities', async () => {
        const response = await sendAndReceive<AgentListResponse>(
          messageRouter,
          'conn-1',
          'agent.list',
          {},
          handlerContext,
        );

        expect(response.payload.agents[0].capabilities).toBeDefined();
        expect(Array.isArray(response.payload.agents[0].capabilities)).toBe(
          true,
        );
      });
    });

    describe('agent.get', () => {
      it('should get an existing agent', async () => {
        const response = await sendAndReceive<AgentGetResponse>(
          messageRouter,
          'conn-1',
          'agent.get',
          { agentId: 'agent-1' },
          handlerContext,
        );

        expect(response.type).toBe('agent.get');
        expect(response.payload.agent.id).toBe('agent-1');
        expect(response.payload.agent.name).toBe('Test Agent 1');
      });

      it('should return error for non-existent agent', async () => {
        const response = await sendAndReceive<ErrorResponse>(
          messageRouter,
          'conn-1',
          'agent.get',
          { agentId: 'non-existent' },
          handlerContext,
        );

        expect(response.type).toBe('error');
        expect(response.payload.error.code).toBe(WS_ERROR_CODES.NOT_FOUND);
      });

      it('should return the agent even if disabled (registry returns disabled agents)', async () => {
        // Note: AgentRegistry.getAgent returns agents regardless of enabled status
        const response = await sendAndReceive<AgentGetResponse>(
          messageRouter,
          'conn-1',
          'agent.get',
          { agentId: 'agent-disabled' },
          handlerContext,
        );

        // The handler returns the agent if it exists (including disabled ones)
        expect(response.type).toBe('agent.get');
        expect(response.payload.agent.id).toBe('agent-disabled');
        expect(response.payload.agent.enabled).toBe(false);
      });

      it('should include system prompt in get response', async () => {
        const response = await sendAndReceive<AgentGetResponse>(
          messageRouter,
          'conn-1',
          'agent.get',
          { agentId: 'agent-1' },
          handlerContext,
        );

        expect(response.payload.agent.systemPrompt).toBe(
          'You are a helpful assistant.',
        );
      });

      it('should include enabled status in get response', async () => {
        const response = await sendAndReceive<AgentGetResponse>(
          messageRouter,
          'conn-1',
          'agent.get',
          { agentId: 'agent-1' },
          handlerContext,
        );

        expect(response.payload.agent.enabled).toBe(true);
      });
    });
  });

  // ============================================================================
  // Provider Operations
  // ============================================================================

  describe('Provider Operations', () => {
    describe('provider.list', () => {
      it('should list enabled providers', async () => {
        const response = await sendAndReceive<ProviderListResponse>(
          messageRouter,
          'conn-1',
          'provider.list',
          {},
          handlerContext,
        );

        expect(response.type).toBe('provider.list');
        expect(response.payload.providers).toBeDefined();
        expect(Array.isArray(response.payload.providers)).toBe(true);
        expect(response.payload.providers.length).toBe(2);
      });

      it('should only include enabled providers', async () => {
        const response = await sendAndReceive<ProviderListResponse>(
          messageRouter,
          'conn-1',
          'provider.list',
          {},
          handlerContext,
        );

        const disabledProvider = response.payload.providers.find(
          (p) => p.id === 'disabled-provider',
        );
        expect(disabledProvider).toBeUndefined();
      });

      it('should include provider capabilities', async () => {
        const response = await sendAndReceive<ProviderListResponse>(
          messageRouter,
          'conn-1',
          'provider.list',
          {},
          handlerContext,
        );

        expect(response.payload.providers[0].capabilities).toBeDefined();
        expect(Array.isArray(response.payload.providers[0].capabilities)).toBe(
          true,
        );
      });
    });

    describe('provider.models', () => {
      it('should get models for an existing provider', async () => {
        const response = await sendAndReceive<ProviderModelsResponse>(
          messageRouter,
          'conn-1',
          'provider.models',
          { providerId: 'openai' },
          handlerContext,
        );

        expect(response.type).toBe('provider.models');
        expect(response.payload.providerId).toBe('openai');
        expect(response.payload.models).toBeDefined();
        expect(Array.isArray(response.payload.models)).toBe(true);
        expect(response.payload.models.length).toBe(2);
      });

      it('should return error for non-existent provider', async () => {
        const response = await sendAndReceive<ErrorResponse>(
          messageRouter,
          'conn-1',
          'provider.models',
          { providerId: 'non-existent' },
          handlerContext,
        );

        expect(response.type).toBe('error');
        expect(response.payload.error.code).toBe(WS_ERROR_CODES.NOT_FOUND);
      });

      it('should return error for disabled provider', async () => {
        const response = await sendAndReceive<ErrorResponse>(
          messageRouter,
          'conn-1',
          'provider.models',
          { providerId: 'disabled-provider' },
          handlerContext,
        );

        expect(response.type).toBe('error');
        expect(response.payload.error.code).toBe(WS_ERROR_CODES.NOT_FOUND);
      });

      it('should include model capabilities when available', async () => {
        const response = await sendAndReceive<ProviderModelsResponse>(
          messageRouter,
          'conn-1',
          'provider.models',
          { providerId: 'openai' },
          handlerContext,
        );

        expect(response.payload.models[0].capabilities).toBeDefined();
        expect(response.payload.models[0].capabilities).toContain('chat');
      });
    });
  });

  // ============================================================================
  // Handler Registration
  // ============================================================================

  describe('Handler Registration', () => {
    it('should have agent.list handler registered', () => {
      expect(messageRouter.hasHandler('agent.list')).toBe(true);
    });

    it('should have agent.get handler registered', () => {
      expect(messageRouter.hasHandler('agent.get')).toBe(true);
    });

    it('should have provider.list handler registered', () => {
      expect(messageRouter.hasHandler('provider.list')).toBe(true);
    });

    it('should have provider.models handler registered', () => {
      expect(messageRouter.hasHandler('provider.models')).toBe(true);
    });
  });

  // ============================================================================
  // Multiple Connection Tests
  // ============================================================================

  describe('Multiple Connections', () => {
    it('should handle multiple independent connections', async () => {
      const response1 = await sendAndReceive<AgentListResponse>(
        messageRouter,
        'conn-1',
        'agent.list',
        {},
        handlerContext,
      );

      const response2 = await sendAndReceive<AgentListResponse>(
        messageRouter,
        'conn-2',
        'agent.list',
        {},
        handlerContext,
      );

      expect(response1.type).toBe('agent.list');
      expect(response2.type).toBe('agent.list');
      expect(response1.payload.agents).toEqual(response2.payload.agents);
    });

    it('should handle provider operations on different connections', async () => {
      const response1 = await sendAndReceive<ProviderListResponse>(
        messageRouter,
        'conn-1',
        'provider.list',
        {},
        handlerContext,
      );

      const response2 = await sendAndReceive<ProviderModelsResponse>(
        messageRouter,
        'conn-2',
        'provider.models',
        { providerId: 'openai' },
        handlerContext,
      );

      expect(response1.type).toBe('provider.list');
      expect(response2.type).toBe('provider.models');
    });
  });

  // ============================================================================
  // Error Handling
  // ============================================================================

  describe('Error Handling', () => {
    it('should handle invalid agent ID gracefully', async () => {
      const response = await sendAndReceive<ErrorResponse>(
        messageRouter,
        'conn-1',
        'agent.get',
        { agentId: '' },
        handlerContext,
      );

      // Empty string ID should return not found
      expect(response.type).toBe('error');
    });

    it('should handle invalid provider ID gracefully', async () => {
      const response = await sendAndReceive<ErrorResponse>(
        messageRouter,
        'conn-1',
        'provider.models',
        { providerId: '' },
        handlerContext,
      );

      expect(response.type).toBe('error');
    });
  });
});
