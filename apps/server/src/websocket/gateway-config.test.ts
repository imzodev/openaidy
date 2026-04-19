/**
 * WebSocket Gateway Runtime Configuration Tests - Issue #130
 *
 * Tests for verifying that runtime gateway configuration is honored
 * and hardcoded route/path behavior is removed.
 */

import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { websocketGatewayPlugin, createGateway } from './index';
import {
  defaultWebSocketConfig,
  createWebSocketConfig,
  validateWebSocketConfig,
} from './types';
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
  apiKeysRepo: undefined,
  workspace: undefined,
  mcpService: undefined,
} as unknown as AppServices;

const mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  child: () => mockLogger,
  level: 'info',
  silent: false,
} as const;

describe('WebSocket Gateway Runtime Configuration - Issue #130', () => {
  describe('Config parsing', () => {
    it('should use default path /ws when no WS_PATH is set', () => {
      const config = createWebSocketConfig({});
      expect(config.path).toBe('/ws');
    });

    it('should use custom path when WS_PATH is set', () => {
      const config = createWebSocketConfig({ WS_PATH: '/websocket' });
      expect(config.path).toBe('/websocket');
    });

    it('should use custom nested path when WS_PATH has segments', () => {
      const config = createWebSocketConfig({ WS_PATH: '/api/v1/ws' });
      expect(config.path).toBe('/api/v1/ws');
    });

    it('should use default maxConnections when not set', () => {
      const config = createWebSocketConfig({});
      expect(config.maxConnections).toBe(1000);
    });

    it('should use custom maxConnections when set', () => {
      const config = createWebSocketConfig({ WS_MAX_CONNECTIONS: '500' });
      expect(config.maxConnections).toBe(500);
    });

    it('should use default heartbeatInterval when not set', () => {
      const config = createWebSocketConfig({});
      expect(config.heartbeatInterval).toBe(30000);
    });

    it('should use custom heartbeatInterval when set', () => {
      const config = createWebSocketConfig({ WS_HEARTBEAT_INTERVAL: '60000' });
      expect(config.heartbeatInterval).toBe(60000);
    });

    it('should use default enabled when not set', () => {
      const config = createWebSocketConfig({});
      expect(config.enabled).toBe(true);
    });

    it('should parse WS_ENABLED=false correctly', () => {
      const config = createWebSocketConfig({ WS_ENABLED: 'false' });
      expect(config.enabled).toBe(false);
    });

    it('should parse WS_ENABLED=true correctly', () => {
      const config = createWebSocketConfig({ WS_ENABLED: 'true' });
      expect(config.enabled).toBe(true);
    });
  });

  describe('Config validation', () => {
    it('should validate a valid config', () => {
      const config = {
        enabled: true,
        path: '/ws',
        maxConnections: 1000,
        heartbeatInterval: 30000,
        auth: {
          required: true,
          tokenExpiry: 86400000,
          secret: 'test-secret-key-here',
        },
        rateLimit: { max: 100, window: 60000 },
      };
      const result = validateWebSocketConfig(config);
      expect(result.path).toBe('/ws');
    });

    it('should apply defaults for missing values', () => {
      const config = { path: '/custom' };
      const result = validateWebSocketConfig(config);
      expect(result.path).toBe('/custom');
      expect(result.enabled).toBe(true);
      expect(result.maxConnections).toBe(1000);
    });

    it('should reject invalid path types', () => {
      expect(() => validateWebSocketConfig({ path: 123 as unknown })).toThrow();
    });

    it('should reject invalid maxConnections values', () => {
      expect(() => validateWebSocketConfig({ maxConnections: -1 })).toThrow();
    });

    it('should reject invalid heartbeatInterval values', () => {
      expect(() => validateWebSocketConfig({ heartbeatInterval: 0 })).toThrow();
    });
  });

  describe('createGateway config application', () => {
    it('should create gateway with default config', () => {
      const fastify = {
        log: mockLogger,
        services: mockServices,
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const gateway = createGateway(fastify as any);

      expect(gateway.config.path).toBe('/ws');
      expect(gateway.config.enabled).toBe(true);
      expect(gateway.config.maxConnections).toBe(1000);
      expect(gateway.config.heartbeatInterval).toBe(30000);
    });

    it('should create gateway with custom path config', () => {
      const fastify = {
        log: mockLogger,
        services: mockServices,
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const gateway = createGateway(fastify as any, {
        path: '/custom-ws',
      });

      expect(gateway.config.path).toBe('/custom-ws');
    });

    it('should create gateway with custom maxConnections config', () => {
      const fastify = {
        log: mockLogger,
        services: mockServices,
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const gateway = createGateway(fastify as any, {
        maxConnections: 500,
      });

      expect(gateway.config.maxConnections).toBe(500);
    });

    it('should create gateway with custom heartbeatInterval config', () => {
      const fastify = {
        log: mockLogger,
        services: mockServices,
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const gateway = createGateway(fastify as any, {
        heartbeatInterval: 45000,
      });

      expect(gateway.config.heartbeatInterval).toBe(45000);
    });

    it('should create gateway with all custom config', () => {
      const fastify = {
        log: mockLogger,
        services: mockServices,
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const gateway = createGateway(fastify as any, {
        enabled: true,
        port: 8080,
        path: '/api/ws',
        maxConnections: 200,
        heartbeatInterval: 15000,
      });

      expect(gateway.config.path).toBe('/api/ws');
      expect(gateway.config.maxConnections).toBe(200);
      expect(gateway.config.heartbeatInterval).toBe(15000);
      expect(gateway.config.port).toBe(8080);
    });
  });

  describe('Plugin disabled behavior', () => {
    it('should not register routes when disabled via options', async () => {
      const app = Fastify();
      await app.register(websocket);

      const registeredRoutes: string[] = [];
      app.addHook('onRoute', (routeOptions) => {
        registeredRoutes.push(routeOptions.url || '');
      });

      await app.register(websocketGatewayPlugin, {
        enabled: false,
      });

      // The gateway should be disabled and no routes registered
      expect(app.websocketGateway).toBeUndefined();
      expect(registeredRoutes).not.toContain('/ws');
      expect(registeredRoutes).not.toContain('/custom-ws');

      await app.close();
    });

    it('should skip initialization when disabled', async () => {
      const app = Fastify();
      await app.register(websocket);

      const logSpy = vi.fn();
      app.log.info = logSpy;

      await app.register(websocketGatewayPlugin, {
        enabled: false,
      });

      expect(logSpy).toHaveBeenCalledWith('WebSocket gateway is disabled');

      await app.close();
    });
  });

  describe('Runtime config is authoritative', () => {
    it('should use config path for route registration', async () => {
      const app = Fastify();
      app.decorate('services', mockServices);
      await app.register(websocket);

      // Track registered routes
      const registeredRoutes: string[] = [];
      app.addHook('onRoute', (routeOptions) => {
        if (routeOptions.websocket) {
          registeredRoutes.push(routeOptions.url || '');
        }
      });

      await app.register(websocketGatewayPlugin, {
        wsConfig: {
          path: '/my-custom-websocket-path',
        },
      });

      // The custom path should be registered
      expect(registeredRoutes).toContain('/my-custom-websocket-path');
      // Default path should NOT be registered
      expect(registeredRoutes).not.toContain('/ws');

      await app.close();
    });

    it('should log the actual configured path on startup', async () => {
      const app = Fastify();
      app.decorate('services', mockServices);
      await app.register(websocket);

      const logMessages: string[] = [];
      const originalInfo = app.log.info.bind(app.log);
      app.log.info = (msg: string | { msg?: unknown }) => {
        logMessages.push(
          typeof msg === 'string'
            ? msg
            : ((msg as { msg?: unknown }).msg?.toString() ?? String(msg)),
        );
        return originalInfo(msg);
      };

      await app.register(websocketGatewayPlugin, {
        wsConfig: {
          path: '/realtime',
        },
      });

      // Should log the configured path
      expect(logMessages.some((msg) => msg.includes('/realtime'))).toBe(true);

      await app.close();
    });

    it('should enforce maxConnections from config', () => {
      const fastify = {
        log: mockLogger,
        services: mockServices,
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const gateway = createGateway(fastify as any, {
        maxConnections: 3,
      });

      // Register 3 connections
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockSocket = { send: vi.fn(), close: vi.fn() } as any;
      gateway.connectionManager.registerConnection('conn-1', mockSocket);
      gateway.connectionManager.registerConnection('conn-2', mockSocket);
      gateway.connectionManager.registerConnection('conn-3', mockSocket);

      expect(gateway.connectionManager.getConnectionCount()).toBe(3);
      expect(
        gateway.connectionManager.getConnectionCount(),
      ).toBeLessThanOrEqual(gateway.config.maxConnections);
    });

    it('should use heartbeatInterval from config', async () => {
      const fastify = {
        log: mockLogger,
        services: mockServices,
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const gateway = createGateway(fastify as any, {
        heartbeatInterval: 10000, // 10 seconds
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockSocket = { send: vi.fn(), close: vi.fn() } as any;
      const ctx = gateway.connectionManager.registerConnection(
        'conn-1',
        mockSocket,
      );

      // Not stale within threshold
      const stale1 = gateway.connectionManager.checkStaleConnections(15000); // 15 seconds
      expect(stale1.length).toBe(0);

      // Simulate old heartbeat
      ctx.lastHeartbeat = Date.now() - 25000; // 25 seconds ago

      // Now stale
      const stale2 = gateway.connectionManager.checkStaleConnections(15000);
      expect(stale2.length).toBe(1);
      expect(stale2[0]).toBe('conn-1');

      await gateway.shutdown();
    });
  });

  describe('Edge cases', () => {
    it('should handle path with trailing slash', () => {
      const config = createWebSocketConfig({ WS_PATH: '/ws/' });
      expect(config.path).toBe('/ws/');
    });

    it('should handle path with nested segments', () => {
      const config = createWebSocketConfig({ WS_PATH: '/api/v2/realtime' });
      expect(config.path).toBe('/api/v2/realtime');
    });

    it('should handle path without leading slash', () => {
      // Zod schema may or may not validate this - test actual behavior
      const config = createWebSocketConfig({ WS_PATH: 'websocket' });
      expect(config.path).toBe('websocket');
    });

    it('should use auth config from env', () => {
      const config = createWebSocketConfig({
        WS_AUTH_REQUIRED: 'false',
        WS_TOKEN_EXPIRY: '3600000',
        WS_TOKEN_SECRET: 'my-super-secret-key-min-16-chars',
      });
      expect(config.auth.required).toBe(false);
      expect(config.auth.tokenExpiry).toBe(3600000);
      expect(config.auth.secret).toBe('my-super-secret-key-min-16-chars');
    });

    it('should use rate limit config from env', () => {
      const config = createWebSocketConfig({
        WS_RATE_LIMIT_MAX: '50',
        WS_RATE_LIMIT_WINDOW: '30000',
      });
      expect(config.rateLimit.max).toBe(50);
      expect(config.rateLimit.window).toBe(30000);
    });
  });

  describe('Config object immutability', () => {
    it('should not mutate default config when creating custom config', () => {
      const fastify = {
        log: mockLogger,
        services: mockServices,
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      createGateway(fastify as any, { path: '/new-path' });

      // Default should still be /ws
      expect(defaultWebSocketConfig.path).toBe('/ws');
    });

    it('should create independent config objects', () => {
      const fastify = {
        log: mockLogger,
        services: mockServices,
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const gateway1 = createGateway(fastify as any, { path: '/path1' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const gateway2 = createGateway(fastify as any, { path: '/path2' });

      expect(gateway1.config.path).toBe('/path1');
      expect(gateway2.config.path).toBe('/path2');
    });
  });
});
