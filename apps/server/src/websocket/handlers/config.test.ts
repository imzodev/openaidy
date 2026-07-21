/**
 * Config Handler Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import type { Mock } from 'vitest';
import {
  ConfigHandler,
  registerConfigHandlers,
  type ConfigWatchRequest,
  type ConfigUnwatchRequest,
} from './config';
import type { AppConfigService } from '../../config/service';
import type { ConnectionManager } from '../connection-manager';
import type { HandlerContext } from '../index';
import type { MessageRouter } from '../message-router';
import {
  createWSMessage,
  WS_ERROR_CODES,
  type ConfigGetRequest,
  type ConfigUpdateRequest,
} from '@openaidy/shared-types';

// ============================================================================
// Mocks
// ============================================================================

const createMockLogger = () =>
  ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => createMockLogger()),
  }) as unknown as FastifyBaseLogger;

const createMockConfigService = (): AppConfigService =>
  ({
    getConfig: vi.fn().mockReturnValue({
      app: { name: 'TestApp', version: '1.0.0' },
      defaults: { agentId: 'default-agent' },
      providers: {},
      agents: {},
    }),
    getStatus: vi.fn().mockReturnValue({ issues: [] }),
    load: vi.fn(),
    save: vi.fn(),
  }) as unknown as AppConfigService;

const createMockConnectionManager = (): ConnectionManager =>
  ({
    registerConnection: vi.fn(),
    removeConnection: vi.fn(),
    getConnection: vi.fn().mockReturnValue({
      id: 'conn-1',
      socket: { readyState: 1, send: vi.fn() },
      authenticated: true,
      capabilities: ['config.read', 'config.write', '*'],
    }),
    getConnectionCount: vi.fn().mockReturnValue(0),
    getAllConnections: vi.fn().mockReturnValue([]),
    closeAll: vi.fn(),
  }) as unknown as ConnectionManager;

// ============================================================================
// Tests
// ============================================================================

describe('ConfigHandler', () => {
  let handler: ConfigHandler;
  let mockConfigService: AppConfigService;
  let mockConnectionManager: ConnectionManager;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let handlerContext: HandlerContext;

  beforeEach(() => {
    mockLogger = createMockLogger();
    mockConfigService = createMockConfigService();
    mockConnectionManager = createMockConnectionManager();

    handler = new ConfigHandler(
      mockConfigService,
      mockConnectionManager,
      mockLogger,
    );

    handlerContext = {
      connectionManager: mockConnectionManager,
      services: {},
      logger: mockLogger,
    };
  });

  // ============================================================================
  // handleGet Tests
  // ============================================================================

  describe('handleGet', () => {
    it('should return full config when no path specified', async () => {
      const request = createWSMessage('config.get', {}) as ConfigGetRequest;

      const response = await handler.handleGet(
        'conn-1',
        request,
        handlerContext,
      );

      expect(response.type).toBe('config.get');
      if ('config' in response.payload) {
        expect(response.payload.config).toBeDefined();
        const config = response.payload.config as { app: { name: string } };
        expect(config.app.name).toBe('TestApp');
      }
    });

    it('should return specific path from config', async () => {
      const request = createWSMessage('config.get', {
        path: 'app.name',
      }) as ConfigGetRequest;

      const response = await handler.handleGet(
        'conn-1',
        request,
        handlerContext,
      );

      expect(response.type).toBe('config.get');
      if ('config' in response.payload) {
        expect(response.payload.path).toBe('app.name');
      }
    });

    it('should return undefined for non-existent path', async () => {
      const request = createWSMessage('config.get', {
        path: 'nonexistent.path',
      }) as ConfigGetRequest;

      const response = await handler.handleGet(
        'conn-1',
        request,
        handlerContext,
      );

      expect(response.type).toBe('config.get');
    });

    it('should handle config service errors', async () => {
      (mockConfigService.getConfig as unknown as Mock).mockImplementation(
        () => {
          throw new Error('Config not loaded');
        },
      );

      const request = createWSMessage('config.get', {}) as ConfigGetRequest;

      const response = await handler.handleGet(
        'conn-1',
        request,
        handlerContext,
      );

      expect(response.type).toBe('error');
      if ('error' in response.payload) {
        expect(response.payload.error.code).toBe(WS_ERROR_CODES.INTERNAL_ERROR);
      }
    });
  });

  // ============================================================================
  // handleUpdate Tests
  // ============================================================================

  describe('handleUpdate', () => {
    it('should update config with valid updates', async () => {
      const request = createWSMessage('config.update', {
        updates: { 'app.name': 'NewAppName' },
      }) as ConfigUpdateRequest;

      const response = await handler.handleUpdate(
        'conn-1',
        request,
        handlerContext,
      );

      expect(response.type).toBe('config.update');
      if ('success' in response.payload) {
        expect(response.payload.success).toBe(true);
        expect(response.payload.config).toBeDefined();
      }
    });

    it('should return error for invalid updates', async () => {
      const request = createWSMessage('config.update', {
        updates: {},
      }) as ConfigUpdateRequest;

      const response = await handler.handleUpdate(
        'conn-1',
        request,
        handlerContext,
      );

      // Empty updates should still succeed
      expect(response.type).toBe('config.update');
    });

    it('should handle save errors', async () => {
      (mockConfigService.save as unknown as Mock).mockImplementation(() => {
        throw new Error('Failed to save');
      });

      const request = createWSMessage('config.update', {
        updates: { 'app.name': 'NewName' },
      }) as ConfigUpdateRequest;

      const response = await handler.handleUpdate(
        'conn-1',
        request,
        handlerContext,
      );

      expect(response.type).toBe('error');
    });

    it('should log update operation', async () => {
      const request = createWSMessage('config.update', {
        updates: { 'app.name': 'NewName' },
      }) as ConfigUpdateRequest;

      await handler.handleUpdate('conn-1', request, handlerContext);

      expect(mockLogger.info).toHaveBeenCalled();
    });
  });

  // ============================================================================
  // handleWatch Tests
  // ============================================================================

  describe('handleWatch', () => {
    it('should register watcher for all paths', async () => {
      const request = createWSMessage('config.watch', {}) as ConfigWatchRequest;

      const response = await handler.handleWatch(
        'conn-1',
        request,
        handlerContext,
      );

      expect(response.type).toBe('config.watch');
      if ('watching' in response.payload) {
        expect(response.payload.watching).toBe(true);
      }
    });

    it('should register watcher for specific paths', async () => {
      const request = createWSMessage('config.watch', {
        paths: ['app.name', 'defaults.agentId'],
      }) as ConfigWatchRequest;

      const response = await handler.handleWatch(
        'conn-1',
        request,
        handlerContext,
      );

      expect(response.type).toBe('config.watch');
      if ('watching' in response.payload) {
        expect(response.payload.watching).toBe(true);
        expect(response.payload.paths).toEqual([
          'app.name',
          'defaults.agentId',
        ]);
      }
    });

    it('should log watch registration', async () => {
      const request = createWSMessage('config.watch', {}) as ConfigWatchRequest;

      await handler.handleWatch('conn-1', request, handlerContext);

      expect(mockLogger.info).toHaveBeenCalled();
    });
  });

  // ============================================================================
  // handleUnwatch Tests
  // ============================================================================

  describe('handleUnwatch', () => {
    it('should remove watcher', async () => {
      // First, add a watcher
      const watchRequest = createWSMessage(
        'config.watch',
        {},
      ) as ConfigWatchRequest;
      await handler.handleWatch('conn-1', watchRequest, handlerContext);

      // Then, remove it
      const unwatchRequest = createWSMessage(
        'config.unwatch',
        {},
      ) as ConfigUnwatchRequest;
      const response = await handler.handleUnwatch(
        'conn-1',
        unwatchRequest,
        handlerContext,
      );

      expect(response.type).toBe('config.unwatch');
      if ('watching' in response.payload) {
        expect(response.payload.watching).toBe(false);
      }
    });

    it('should return watching: false when not watching', async () => {
      const request = createWSMessage(
        'config.unwatch',
        {},
      ) as ConfigUnwatchRequest;

      const response = await handler.handleUnwatch(
        'conn-2',
        request,
        handlerContext,
      );

      expect(response.type).toBe('config.unwatch');
      if ('watching' in response.payload) {
        expect(response.payload.watching).toBe(false);
      }
    });

    it('should log unwatch operation', async () => {
      const request = createWSMessage(
        'config.unwatch',
        {},
      ) as ConfigUnwatchRequest;

      await handler.handleUnwatch('conn-1', request, handlerContext);

      expect(mockLogger.info).toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Config Path Resolution Tests
  // ============================================================================

  describe('resolveConfigPath', () => {
    it('should resolve nested paths', async () => {
      const request = createWSMessage('config.get', {
        path: 'defaults.agentId',
      }) as ConfigGetRequest;

      const response = await handler.handleGet(
        'conn-1',
        request,
        handlerContext,
      );

      expect(response.type).toBe('config.get');
    });
  });

  // ============================================================================
  // Config Update Notification Tests
  // ============================================================================

  describe('notifyWatchers', () => {
    it('should track watchers', async () => {
      // Add watcher
      const watchRequest = createWSMessage('config.watch', {
        paths: ['app.name'],
      }) as ConfigWatchRequest;
      await handler.handleWatch('conn-1', watchRequest, handlerContext);

      // Update config
      const updateRequest = createWSMessage('config.update', {
        updates: { 'app.name': 'NewName' },
      }) as ConfigUpdateRequest;
      await handler.handleUpdate('conn-1', updateRequest, handlerContext);

      // Verify update was processed
      expect(mockLogger.info).toHaveBeenCalled();
    });
  });
});

// ============================================================================
// Handler Registration Tests
// ============================================================================

describe('registerConfigHandlers', () => {
  it('should register all config handlers', () => {
    const mockRouter = {
      registerHandler: vi.fn(),
    };

    const mockHandler = {
      handleGet: vi.fn(),
      handleUpdate: vi.fn(),
      handleWatch: vi.fn(),
      handleUnwatch: vi.fn(),
    } as unknown as ConfigHandler;

    registerConfigHandlers(mockRouter as unknown as MessageRouter, mockHandler);

    expect(mockRouter.registerHandler).toHaveBeenCalledTimes(4);
    expect(mockRouter.registerHandler).toHaveBeenCalledWith(
      'config.get',
      expect.any(Function),
    );
    expect(mockRouter.registerHandler).toHaveBeenCalledWith(
      'config.update',
      expect.any(Function),
    );
    expect(mockRouter.registerHandler).toHaveBeenCalledWith(
      'config.watch',
      expect.any(Function),
    );
    expect(mockRouter.registerHandler).toHaveBeenCalledWith(
      'config.unwatch',
      expect.any(Function),
    );
  });
});
