import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import {
  websocketGatewayPlugin,
  createGateway,
  ConnectionManager,
  MessageRouter,
  type WebSocketGateway,
  type WebSocketGatewayOptions,
  type MessageHandler,
  type HandlerContext,
} from './index';
import {
  createWSMessage,
  createErrorResponse,
  WS_ERROR_CODES,
  type WSMessage,
} from '@openaidy/shared-types';
import { defaultWebSocketConfig, defaultPairingConfig } from './types';

// Mock services for testing
const mockServices = {
  config: {
    getConfig: () => ({ defaults: { agentId: 'default-agent' } }),
    load: async () => {},
  },
  providers: {
    getProvider: () => null,
    listProviders: () => [],
  },
  sessions: {
    createSession: async () => ({ id: 'test-session', title: 'Test', createdAt: new Date().toISOString() }),
  },
  agents: {
    getAgent: () => null,
    listAgents: () => [],
  },
  runEvents: {
    subscribe: () => () => {},
    emit: () => {},
  },
  dbAdapter: undefined,
  scheduler: undefined,
  jobsRepo: undefined,
  jobRunsRepo: undefined,
  sessionsRepo: undefined,
};

const mockLogger = {
  info: () => {},
  error: () => {},
  warn: () => {},
};

describe('websocket gateway plugin', () => {
  describe('createGateway', () => {
    it('should create a gateway with default config', () => {
      const fastify = {
        log: mockLogger,
        services: mockServices,
      };

      const gateway = createGateway(fastify);

      expect(gateway).toBeDefined();
      expect(gateway.config).toBeDefined();
      expect(gateway.config.enabled).toBe(true);
      expect(gateway.config.path).toBe('/ws');
      expect(gateway.connectionManager).toBeDefined();
      expect(gateway.messageRouter).toBeDefined();
    });

    it('should create a gateway with custom config', () => {
      const fastify = {
        log: mockLogger,
        services: mockServices,
      };

      const gateway = createGateway(fastify, {
        enabled: false,
        port: 8080,
        path: '/websocket',
        maxConnections: 500,
      });

      expect(gateway.config.enabled).toBe(false);
      expect(gateway.config.port).toBe(8080);
      expect(gateway.config.path).toBe('/websocket');
      expect(gateway.config.maxConnections).toBe(500);
    });

    it('should create a gateway with pairing config', () => {
      const fastify = {
        log: mockLogger,
        services: mockServices,
      };

      const gateway = createGateway(fastify, undefined, {
        codeLength: 8,
        requireAdminApproval: false,
      });

      expect(gateway.pairingConfig.codeLength).toBe(8);
      expect(gateway.pairingConfig.requireAdminApproval).toBe(false);
    });

    it('should shutdown cleanly', async () => {
      const fastify = {
        log: mockLogger,
        services: mockServices,
      };

      const gateway = createGateway(fastify);
      await expect(gateway.shutdown()).resolves.toBeUndefined();
    });
  });

  describe('ConnectionManager', () => {
    let manager: ConnectionManager;
    let mockSocket: { send: () => void; close: () => void };

    beforeEach(() => {
      manager = new ConnectionManager(defaultWebSocketConfig);
      mockSocket = {
        send: () => {},
        close: () => {},
      };
    });

    afterEach(() => {
      manager.closeAll();
    });

    it('should register a connection', () => {
      const ctx = manager.registerConnection('conn-1', mockSocket as any);

      expect(ctx.id).toBe('conn-1');
      expect(ctx.status).toBe('connected');
      expect(ctx.authenticated).toBe(false);
      expect(ctx.capabilities).toEqual([]);
      expect(ctx.subscriptions.size).toBe(0);
    });

    it('should remove a connection', () => {
      manager.registerConnection('conn-1', mockSocket as any);
      manager.removeConnection('conn-1');

      expect(manager.getConnection('conn-1')).toBeUndefined();
    });

    it('should get a connection by ID', () => {
      manager.registerConnection('conn-1', mockSocket as any);
      const ctx = manager.getConnection('conn-1');

      expect(ctx).toBeDefined();
      expect(ctx?.id).toBe('conn-1');
    });

    it('should get all connections', () => {
      manager.registerConnection('conn-1', mockSocket as any);
      manager.registerConnection('conn-2', mockSocket as any);

      const connections = manager.getAllConnections();
      expect(connections.length).toBe(2);
    });

    it('should track connection count', () => {
      expect(manager.getAllConnections().length).toBe(0);

      manager.registerConnection('conn-1', mockSocket as any);
      expect(manager.getAllConnections().length).toBe(1);

      manager.registerConnection('conn-2', mockSocket as any);
      expect(manager.getAllConnections().length).toBe(2);

      manager.removeConnection('conn-1');
      expect(manager.getAllConnections().length).toBe(1);
    });

    it('should update heartbeat', () => {
      const ctx = manager.registerConnection('conn-1', mockSocket as any);
      const initialHeartbeat = ctx.lastHeartbeat;

      // Wait a tiny bit
      const start = Date.now();
      while (Date.now() === start) {}

      manager.updateHeartbeat('conn-1');
      const updated = manager.getConnection('conn-1');

      expect(updated?.lastHeartbeat).toBeGreaterThan(initialHeartbeat);
    });

    it('should check rate limits', () => {
      manager.registerConnection('conn-1', mockSocket as any);

      // Should allow first request
      const result1 = manager.checkRateLimit('conn-1');
      expect(result1.allowed).toBe(true);
      expect(result1.info.remaining).toBeGreaterThan(0);

      // Record a request
      manager.recordRequest('conn-1');

      // Should still allow (under limit)
      const result2 = manager.checkRateLimit('conn-1');
      expect(result2.allowed).toBe(true);
    });

    it('should return rate limit info', () => {
      manager.registerConnection('conn-1', mockSocket as any);
      const result = manager.checkRateLimit('conn-1');

      expect(result.info.limit).toBe(defaultWebSocketConfig.rateLimit.max);
      expect(result.info.remaining).toBe(defaultWebSocketConfig.rateLimit.max);
      expect(result.info.reset).toBeGreaterThan(Date.now());
    });

    it('should check stale connections', () => {
      const ctx = manager.registerConnection('conn-1', mockSocket as any);

      // Not stale initially
      const stale1 = manager.checkStaleConnections(60000);
      expect(stale1.length).toBe(0);

      // Simulate old heartbeat
      ctx.lastHeartbeat = Date.now() - 120000; // 2 minutes ago

      const stale2 = manager.checkStaleConnections(60000);
      expect(stale2.length).toBe(1);
      expect(stale2[0]).toBe('conn-1');
    });

    it('should close all connections', () => {
      manager.registerConnection('conn-1', mockSocket as any);
      manager.registerConnection('conn-2', mockSocket as any);

      manager.closeAll();

      expect(manager.getConnectionCount()).toBe(0);
    });

    it('should handle unknown connection operations gracefully', () => {
      expect(manager.getConnection('unknown')).toBeUndefined();

      // Should not throw
      manager.removeConnection('unknown');
      manager.updateHeartbeat('unknown');
    });
  });

  describe('MessageRouter', () => {
    let router: MessageRouter;
    let handlerContext: HandlerContext;

    beforeEach(() => {
      router = new MessageRouter(mockLogger);
      handlerContext = {
        connectionManager: new ConnectionManager(defaultWebSocketConfig),
        services: mockServices,
        logger: mockLogger,
      };
    });

    it('should register a handler', () => {
      const handler: MessageHandler = async () => undefined;
      router.registerHandler('test.message', handler);

      expect(router.hasHandler('test.message')).toBe(true);
    });

    it('should unregister a handler', () => {
      const handler: MessageHandler = async () => undefined;
      router.registerHandler('test.message', handler);
      router.unregisterHandler('test.message');

      expect(router.hasHandler('test.message')).toBe(false);
    });

    it('should get handler types', () => {
      router.registerHandler('test.one', async () => undefined);
      router.registerHandler('test.two', async () => undefined);

      const types = router.getHandlerTypes();
      expect(types).toContain('test.one');
      expect(types).toContain('test.two');
    });

    it('should route message to handler', async () => {
      const handler: MessageHandler = async (connId, msg) => {
        return createWSMessage('test.response', { echo: msg.payload });
      };

      router.registerHandler('test.message', handler);

      const message = createWSMessage('test.message', { data: 'hello' });
      const response = await router.route('conn-1', message, handlerContext);

      expect(response).toBeDefined();
      expect(response?.type).toBe('test.response');
    });

    it('should return error for unknown message type', async () => {
      const message = createWSMessage('unknown.type', {});
      const response = await router.route('conn-1', message, handlerContext);

      expect(response?.type).toBe('error');
    });

    it('should handle handler errors', async () => {
      const handler: MessageHandler = async () => {
        throw new Error('Handler error');
      };

      router.registerHandler('test.error', handler);

      const message = createWSMessage('test.error', {});
      const response = await router.route('conn-1', message, handlerContext);

      expect(response?.type).toBe('error');
    });

    it('should pass connection ID to handler', async () => {
      let receivedConnId: string | undefined;

      const handler: MessageHandler = async (connId) => {
        receivedConnId = connId;
        return undefined;
      };

      router.registerHandler('test.connid', handler);

      const message = createWSMessage('test.connid', {});
      await router.route('my-connection-123', message, handlerContext);

      expect(receivedConnId).toBe('my-connection-123');
    });

    it('should pass handler context to handler', async () => {
      let receivedContext: HandlerContext | undefined;

      const handler: MessageHandler = async (_connId, _msg, ctx) => {
        receivedContext = ctx;
        return undefined;
      };

      router.registerHandler('test.context', handler);

      const message = createWSMessage('test.context', {});
      await router.route('conn-1', message, handlerContext);

      expect(receivedContext).toBe(handlerContext);
      expect(receivedContext?.connectionManager).toBeDefined();
      expect(receivedContext?.services).toBeDefined();
    });
  });

  describe('websocketGatewayPlugin', () => {
    it('should export the plugin function', () => {
      expect(websocketGatewayPlugin).toBeDefined();
      expect(typeof websocketGatewayPlugin).toBe('function');
    });

    it('should have correct plugin name pattern', () => {
      // The plugin should be a Fastify plugin function
      expect(websocketGatewayPlugin.name).toMatch(/websocketGateway/);
    });
  });

  describe('integration', () => {
    it('should work end-to-end with gateway components', async () => {
      const fastify = {
        log: mockLogger,
        services: mockServices,
      };

      const gateway = createGateway(fastify);

      // Register a test handler
      gateway.messageRouter.registerHandler('ping', async (_connId, _msg) => {
        return createWSMessage('pong', { timestamp: Date.now() });
      });

      // Register a connection
      const mockSocket = { send: () => {}, close: () => {} };
      const ctx = gateway.connectionManager.registerConnection('test-conn', mockSocket as any);

      expect(ctx.authenticated).toBe(false);

      // Route a message
      const handlerContext: HandlerContext = {
        connectionManager: gateway.connectionManager,
        services: mockServices,
        logger: mockLogger,
      };

      const message = createWSMessage('ping', {});
      const response = await gateway.messageRouter.route('test-conn', message, handlerContext);

      expect(response?.type).toBe('pong');

      // Cleanup
      await gateway.shutdown();
    });
  });
});
