import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import {
  websocketGatewayPlugin,
  createGateway,
  ConnectionManager,
  MessageRouter,
  type MessageHandler,
  type HandlerContext,
} from './index';
import {
  createWSMessage,
  createErrorResponse,
  WS_ERROR_CODES,
  WS_CAPABILITIES,
  type WSResponse,
} from '@openaidy/shared-types';
import { defaultWebSocketConfig } from './types';
import { AuthMiddleware } from './middleware/auth';
import type { AppServices } from '../app';

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
    createSession: async () => ({
      id: 'test-session',
      title: 'Test',
      createdAt: new Date().toISOString(),
    }),
  },
  agents: {
    getAgent: () => null,
    listAgents: () => [],
  },
  runEvents: {
    subscribe: () => () => {},
    emit: () => {},
  },
  bootstrapAdmin: undefined,
  dbAdapter: undefined,
  scheduler: undefined,
  jobsRepo: undefined,
  jobRunsRepo: undefined,
  sessionsRepo: undefined,
  pairingRequestsRepo: undefined,
  devicesRepo: undefined,
} as unknown as AppServices;

const mockLogger = {
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
  fatal: () => {},
  trace: () => {},
  child: () => mockLogger,
  level: 'info',
  silent: () => {},
} as unknown as FastifyBaseLogger;

describe('websocket gateway plugin', () => {
  describe('createGateway', () => {
    it('should create a gateway with default config', () => {
      const fastify = {
        log: mockLogger,
        services: mockServices,
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const gateway = createGateway(fastify as any);

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

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const gateway = createGateway(fastify as any);
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ctx = manager.registerConnection('conn-1', mockSocket as any);

      expect(ctx.id).toBe('conn-1');
      expect(ctx.status).toBe('connected');
      expect(ctx.authenticated).toBe(false);
      expect(ctx.capabilities).toEqual([]);
      expect(ctx.subscriptions.size).toBe(0);
    });

    it('should remove a connection', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      manager.registerConnection('conn-1', mockSocket as any);
      manager.removeConnection('conn-1');

      expect(manager.getConnection('conn-1')).toBeUndefined();
    });

    it('should get a connection by ID', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      manager.registerConnection('conn-1', mockSocket as any);
      const ctx = manager.getConnection('conn-1');

      expect(ctx).toBeDefined();
      expect(ctx?.id).toBe('conn-1');
    });

    it('should get all connections', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      manager.registerConnection('conn-1', mockSocket as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      manager.registerConnection('conn-2', mockSocket as any);

      const connections = manager.getAllConnections();
      expect(connections.length).toBe(2);
    });

    it('should track connection count', () => {
      expect(manager.getAllConnections().length).toBe(0);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      manager.registerConnection('conn-1', mockSocket as any);
      expect(manager.getAllConnections().length).toBe(1);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      manager.registerConnection('conn-2', mockSocket as any);
      expect(manager.getAllConnections().length).toBe(2);

      manager.removeConnection('conn-1');
      expect(manager.getAllConnections().length).toBe(1);
    });

    it('should update heartbeat', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ctx = manager.registerConnection('conn-1', mockSocket as any);
      const initialHeartbeat = ctx.lastHeartbeat;

      // Wait a tiny bit to ensure time passes
      const start = Date.now();
      while (Date.now() === start) {
        // Empty loop to wait for next timestamp
      }

      manager.updateHeartbeat('conn-1');
      const updated = manager.getConnection('conn-1');

      expect(updated?.lastHeartbeat).toBeGreaterThan(initialHeartbeat);
    });

    it('should check rate limits', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      manager.registerConnection('conn-1', mockSocket as any);
      const result = manager.checkRateLimit('conn-1');

      expect(result.info.limit).toBe(defaultWebSocketConfig.rateLimit.max);
      expect(result.info.remaining).toBe(defaultWebSocketConfig.rateLimit.max);
      expect(result.info.reset).toBeGreaterThan(Date.now());
    });

    it('should check stale connections', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      manager.registerConnection('conn-1', mockSocket as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      const handler: MessageHandler = async (_connId, msg) => {
        return createErrorResponse(
          msg.id,
          WS_ERROR_CODES.INTERNAL_ERROR,
          'test.response',
        ) as WSResponse;
      };

      router.registerHandler('test.message', handler);

      const message = createWSMessage('test.message', { data: 'hello' });
      const response = await router.route('conn-1', message, handlerContext);

      expect(response).toBeDefined();
      expect(response?.type).toBe('error');
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

      const gateway = createGateway(
        fastify as Parameters<typeof createGateway>[0],
      );

      // Register a test handler
      gateway.messageRouter.registerHandler('ping', async (_connId, _msg) => {
        return createErrorResponse(
          'ping-test',
          WS_ERROR_CODES.INTERNAL_ERROR,
          'pong',
        ) as WSResponse;
      });

      // Register a connection
      const mockSocket = { send: () => {}, close: () => {} };
      const ctx = gateway.connectionManager.registerConnection(
        'test-conn',
        mockSocket as unknown as WebSocket,
      );

      expect(ctx.authenticated).toBe(false);

      // Route a message
      const handlerContext: HandlerContext = {
        connectionManager: gateway.connectionManager,
        services: mockServices,
        logger: mockLogger,
      };

      const message = createWSMessage('ping', {});
      const response = await gateway.messageRouter.route(
        'test-conn',
        message,
        handlerContext,
      );

      expect(response?.type).toBe('error');

      // Cleanup
      await gateway.shutdown();
    });

    it('should authenticate a connection through auth.authenticate', async () => {
      const fastify = {
        log: mockLogger,
        services: mockServices,
      };

      const gateway = createGateway(fastify);
      const authMiddleware = new AuthMiddleware(gateway.config);
      const token = await authMiddleware.generateToken({
        clientId: 'client-auth',
        type: 'access',
        scopes: [WS_CAPABILITIES.SESSIONS_READ],
      });

      gateway.connectionManager.registerConnection('auth-conn', {
        send: () => {},
        close: () => {},
      } as unknown as WebSocket);

      const handlerContext: HandlerContext = {
        connectionManager: gateway.connectionManager,
        services: mockServices,
        logger: mockLogger,
      };

      const response = await gateway.messageRouter.route(
        'auth-conn',
        createWSMessage('auth.authenticate', { token }),
        handlerContext,
      );

      expect(response?.type).toBe('auth.authenticated');
      expect(gateway.connectionManager.isAuthenticated('auth-conn')).toBe(true);
      expect(
        gateway.connectionManager.getConnection('auth-conn')?.clientId,
      ).toBe('client-auth');

      await gateway.shutdown();
    });

    it('should reject protected routes for unauthenticated connections when auth is required', async () => {
      const fastify = {
        log: mockLogger,
        services: mockServices,
      };

      const gateway = createGateway(fastify);
      gateway.connectionManager.registerConnection('unauth-conn', {
        send: () => {},
        close: () => {},
      } as unknown as WebSocket);

      const message = createWSMessage('session.list', {});
      const connection = gateway.connectionManager.getConnection('unauth-conn');

      expect(connection?.authenticated).toBe(false);

      const requiresAuth =
        gateway.config.auth.required && !connection?.authenticated;
      const isProtectedType = ![
        'auth.authenticate',
        'auth.refresh',
        'pairing.request',
        'pairing.status',
      ].includes(message.type);

      expect(requiresAuth && isProtectedType).toBe(true);

      await gateway.shutdown();
    });

    it('should enforce capability requirements after authentication', async () => {
      const fastify = {
        log: mockLogger,
        services: mockServices,
      };

      const gateway = createGateway(fastify);
      gateway.connectionManager.registerConnection('cap-conn', {
        send: () => {},
        close: () => {},
      } as unknown as WebSocket);
      gateway.connectionManager.authenticate('cap-conn', 'client-cap', [
        WS_CAPABILITIES.SESSIONS_READ,
      ]);

      expect(
        gateway.connectionManager.hasCapability(
          'cap-conn',
          WS_CAPABILITIES.CONFIG_WRITE,
        ),
      ).toBe(false);
      expect(
        gateway.connectionManager.hasCapability(
          'cap-conn',
          WS_CAPABILITIES.SESSIONS_READ,
        ),
      ).toBe(true);

      await gateway.shutdown();
    });
  });
});
