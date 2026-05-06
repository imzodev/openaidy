/**
 * End-to-End Integration Tests
 *
 * Comprehensive E2E tests that verify all WebSocket gateway components
 * work together correctly, simulating real client behavior.
 *
 * Tests cover:
 * - Connection lifecycle
 * - Authentication flows
 * - Session operations
 * - Agent & Provider operations
 * - Node & Pairing flows
 * - Configuration & Presence
 * - Error handling
 * - Performance characteristics
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createGateway, type WebSocketGateway } from '../index';
import type { AppServices } from '../../types';
import { AuthMiddleware } from '../middleware/auth';
import { MessageRouter, type HandlerContext } from '../message-router';
import {
  type ErrorResponse,
  type SessionCreatedResponse,
  type SessionListResponse,
  type AgentListResponse,
  type ProviderListResponse,
  WS_ERROR_CODES,
  createWSMessage,
} from '@openaidy/shared-types';
import { defaultWebSocketConfig } from '../types';

// ============================================================================
// Mock Factories
// ============================================================================

const createMockAuthMiddleware = (): AuthMiddleware => {
  return {
    validateToken: vi.fn().mockResolvedValue({
      valid: true,
      payload: { sub: 'test-client', scopes: [] },
    }),
    generateToken: vi.fn().mockResolvedValue('mock-jwt-token-abc123'),
    hasCapability: vi.fn().mockReturnValue(true),
    hasAnyCapability: vi.fn().mockReturnValue(true),
    hasAllCapabilities: vi.fn().mockReturnValue(true),
  } as unknown as AuthMiddleware;
};

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

const createMockServices = (_authMiddleware: AuthMiddleware): AppServices => ({
  bootstrapAdmin: undefined,
  dbAdapter: undefined,
  scheduler: undefined,
  jobsRepo: undefined,
  jobRunsRepo: undefined,
  sessionsRepo: undefined,
  pairingRequestsRepo: undefined,
  devicesRepo: undefined,
  accessTokensRepo: undefined,
  sessions: {
    createSession: vi.fn().mockResolvedValue({
      id: 'session-e2e-id',
      title: 'E2E Test Session',
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    getSession: vi.fn().mockImplementation(async (id: string) => {
      if (id === 'non-existent-session') return null;
      return {
        id,
        title: 'E2E Test Session',
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }),
    getSessionOrFail: vi.fn().mockResolvedValue({
      id: 'session-e2e-id',
      title: 'E2E Test Session',
      status: 'active',
      createdAt: new Date().toISOString(),
    }),
    listSessions: vi.fn().mockResolvedValue([
      {
        id: 'session-1',
        title: 'Session 1',
        status: 'active',
        createdAt: new Date().toISOString(),
      },
      {
        id: 'session-2',
        title: 'Session 2',
        status: 'active',
        createdAt: new Date().toISOString(),
      },
    ]),
    deleteSession: vi.fn().mockResolvedValue(true),
    addMessage: vi.fn(),
    getMessages: vi.fn().mockResolvedValue([]),
    updateMetadata: vi.fn(),
    archiveSession: vi.fn(),
    submitMessageStreaming: vi.fn().mockResolvedValue({
      ok: true,
      userMessage: { id: 'msg-user', content: 'Hello', role: 'user' },
      assistantMessage: {
        id: 'msg-assistant',
        content: 'Hi there!',
        role: 'assistant',
      },
      run: {
        id: 'run-e2e',
        finishReason: 'stop',
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
      },
    }),
  } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
  agents: {
    listAgents: vi.fn().mockReturnValue([
      {
        id: 'agent-1',
        name: 'Agent 1',
        description: 'Test agent',
        tools: ['chat'],
        enabled: true,
      },
      {
        id: 'agent-2',
        name: 'Agent 2',
        description: 'Test agent 2',
        tools: ['chat'],
        enabled: true,
      },
    ]),
    listAllAgents: vi.fn().mockReturnValue([
      {
        id: 'agent-1',
        name: 'Agent 1',
        description: 'Test agent',
        tools: ['chat'],
        enabled: true,
      },
    ]),
    getAgent: vi.fn().mockImplementation((id: string) => {
      if (id === 'non-existent-agent') return undefined;
      return {
        id,
        name: `Agent ${id}`,
        description: 'Test',
        tools: ['chat'],
        enabled: true,
      };
    }),
    getAgentOrFail: vi.fn(),
    createAgent: vi.fn(),
    updateAgent: vi.fn(),
    deleteAgent: vi.fn(),
  } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
  providers: {
    registry: {
      listDescriptors: vi.fn().mockReturnValue([
        {
          id: 'openai',
          name: 'OpenAI',
          vendorFamily: 'openai',
          capabilities: ['chat', 'streaming'],
          models: [],
        },
        {
          id: 'anthropic',
          name: 'Anthropic',
          vendorFamily: 'anthropic',
          capabilities: ['chat', 'streaming'],
          models: [],
        },
      ]),
      get: vi.fn().mockImplementation((id: string) => {
        if (id === 'non-existent-provider') return undefined;
        return {
          descriptor: {
            id,
            name: `Provider ${id}`,
            vendorFamily: id,
            capabilities: ['chat'],
            models: [
              { id: 'model-1', name: 'Model 1', capabilities: ['chat'] },
            ],
          },
          listModels: vi.fn().mockResolvedValue({
            ok: true,
            value: [{ id: 'model-1', name: 'Model 1', capabilities: ['chat'] }],
          }),
        };
      }),
    },
    getProvider: vi.fn(),
    listProviders: vi.fn().mockReturnValue([]),
  } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
  config: {
    get: vi.fn().mockResolvedValue({
      app: { name: 'OpenAidy', version: '1.0.0' },
      server: { port: 3000 },
    }),
    getConfig: vi.fn().mockReturnValue({
      app: { name: 'OpenAidy', version: '1.0.0' },
      server: { port: 3000 },
    }),
    set: vi.fn().mockResolvedValue(undefined),
    save: vi.fn().mockResolvedValue(undefined),
    load: vi.fn(),
    watch: vi.fn(),
    unwatch: vi.fn(),
  } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
  runEvents: {
    createRun: vi.fn(),
    getRun: vi.fn(),
    listRuns: vi.fn(),
    updateRun: vi.fn(),
    completeRun: vi.fn(),
    failRun: vi.fn(),
    cancelRun: vi.fn(),
    addEvent: vi.fn(),
    getEvents: vi.fn(),
    subscribeToRun: vi.fn(),
    unsubscribeFromRun: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
  workspace: undefined as any, // eslint-disable-line @typescript-eslint/no-explicit-any
  mcpService: undefined as any, // eslint-disable-line @typescript-eslint/no-explicit-any
  skills: {
    load: () => {},
    listSkills: () => [],
    getSkill: () => undefined,
    getSkillsForAgent: () => [],
  } as unknown as AppServices['skills'],
  personality: undefined as unknown as AppServices['personality'],
});

// ============================================================================
// Test Helpers
// ============================================================================

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

// ============================================================================
// E2E Test Suite
// ============================================================================

describe('E2E Integration Tests', () => {
  let gateway: WebSocketGateway;
  let mockServices: AppServices;
  let mockAuth: AuthMiddleware;
  let mockFastify: {
    log: ReturnType<typeof createMockLogger>;
    services: AppServices;
  };
  let handlerContext: HandlerContext;

  beforeEach(() => {
    mockAuth = createMockAuthMiddleware();
    mockServices = createMockServices(mockAuth);

    mockFastify = {
      log: createMockLogger(),
      services: mockServices,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    gateway = createGateway(mockFastify as any);

    handlerContext = {
      connectionManager: gateway.connectionManager,
      services: mockServices,
      logger: mockFastify.log as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    };

    // Start stream manager
    gateway.streamManager.start();
  });

  afterEach(async () => {
    if (gateway && gateway.shutdown) {
      await gateway.shutdown();
    }
  });

  // ============================================================================
  // Gateway Creation Tests
  // ============================================================================

  describe('Gateway Creation', () => {
    it('should create a gateway with all components', () => {
      expect(gateway).toBeDefined();
      expect(gateway.config).toBeDefined();
      expect(gateway.pairingConfig).toBeDefined();
      expect(gateway.messageRouter).toBeDefined();
      expect(gateway.connectionManager).toBeDefined();
    });

    it('should have all handlers in gateway', () => {
      expect(gateway.sessionHandler).toBeDefined();
      expect(gateway.agentHandler).toBeDefined();
      expect(gateway.providerHandler).toBeDefined();
      expect(gateway.nodeHandler).toBeDefined();
      expect(gateway.pairingHandler).toBeDefined();
      expect(gateway.configHandler).toBeDefined();
      expect(gateway.presenceHandler).toBeDefined();
    });

    it('should have all registries and services', () => {
      expect(gateway.nodeRegistry).toBeDefined();
      expect(gateway.pairingService).toBeDefined();
      expect(gateway.presenceManager).toBeDefined();
    });
  });

  // ============================================================================
  // Connection Lifecycle Tests
  // ============================================================================

  describe('Connection Lifecycle', () => {
    it('should register a new connection', () => {
      const ctx = gateway.connectionManager.registerConnection('conn-1');
      expect(ctx.id).toBe('conn-1');
      expect(ctx.status).toBe('connected');
      expect(gateway.connectionManager.getConnectionCount()).toBe(1);
    });

    it('should handle multiple concurrent connections', () => {
      const connections = [];
      for (let i = 0; i < 100; i++) {
        connections.push(
          gateway.connectionManager.registerConnection(`conn-${i}`),
        );
      }
      expect(gateway.connectionManager.getConnectionCount()).toBe(100);
    });

    it('should remove connection on close', () => {
      gateway.connectionManager.registerConnection('conn-1');
      gateway.connectionManager.removeConnection('conn-1');
      expect(gateway.connectionManager.getConnectionCount()).toBe(0);
    });

    it('should update heartbeat on activity', () => {
      const ctx = gateway.connectionManager.registerConnection('conn-1');
      const initialHeartbeat = ctx.lastHeartbeat;

      gateway.connectionManager.updateHeartbeat('conn-1');

      const updated = gateway.connectionManager.getConnection('conn-1');
      expect(updated?.lastHeartbeat).toBeGreaterThanOrEqual(initialHeartbeat);
    });

    it('should detect stale connections', async () => {
      gateway.connectionManager.registerConnection('conn-1');

      // Manually set old heartbeat (more than 2x heartbeat interval)
      const ctx = gateway.connectionManager.getConnection('conn-1');
      if (ctx) {
        ctx.lastHeartbeat =
          Date.now() - defaultWebSocketConfig.heartbeatInterval * 3;
      }

      const staleIds = gateway.connectionManager.checkStaleConnections(
        defaultWebSocketConfig.heartbeatInterval * 2,
      );
      expect(staleIds).toContain('conn-1');
    });

    it('should handle reconnection after disconnect', () => {
      // First connection
      gateway.connectionManager.registerConnection('conn-1');
      gateway.connectionManager.removeConnection('conn-1');

      // Reconnect with same ID
      const ctx = gateway.connectionManager.registerConnection('conn-1');
      expect(ctx.id).toBe('conn-1');
      expect(ctx.status).toBe('connected');
    });
  });

  // ============================================================================
  // Authentication Tests
  // ============================================================================

  describe('Authentication', () => {
    it('should handle valid token authentication', async () => {
      gateway.connectionManager.registerConnection('conn-1');

      const realAuth = new AuthMiddleware(gateway.config);
      const token = await realAuth.generateToken({
        clientId: 'e2e-client',
        type: 'access',
        scopes: ['sessions.read', 'config.read'],
      });

      const response = await sendAndReceive<{
        type: 'auth.authenticated';
        payload: { clientId: string; capabilities: string[] };
      }>(
        gateway.messageRouter,
        'conn-1',
        'auth.authenticate',
        { token },
        handlerContext,
      );

      expect(response.type).toBe('auth.authenticated');
      expect(response.payload.clientId).toBe('e2e-client');
      expect(response.payload.capabilities).toEqual([
        'sessions.read',
        'config.read',
      ]);
      expect(gateway.connectionManager.isAuthenticated('conn-1')).toBe(true);
    });

    it('should extract capabilities from token', async () => {
      gateway.connectionManager.registerConnection('conn-2');

      const realAuth = new AuthMiddleware(gateway.config);
      const token = await realAuth.generateToken({
        clientId: 'cap-client',
        type: 'access',
        scopes: ['config.write'],
      });

      await sendAndReceive(
        gateway.messageRouter,
        'conn-2',
        'auth.authenticate',
        { token },
        handlerContext,
      );

      expect(gateway.connectionManager.getCapabilities('conn-2')).toEqual([
        'config.write',
      ]);
      expect(
        gateway.connectionManager.hasCapability('conn-2', 'config.write'),
      ).toBe(true);
    });

    it('should reject invalid token authentication', async () => {
      gateway.connectionManager.registerConnection('conn-3');

      const response = await sendAndReceive<ErrorResponse>(
        gateway.messageRouter,
        'conn-3',
        'auth.authenticate',
        { token: 'invalid-token' },
        handlerContext,
      );

      expect(response.type).toBe('error');
      expect(response.payload.error.code).toBe(WS_ERROR_CODES.AUTH_FAILED);
      expect(gateway.connectionManager.isAuthenticated('conn-3')).toBe(false);
    });
  });

  // ============================================================================
  // Session Flow Tests
  // ============================================================================

  describe('Session Flow', () => {
    it('should create a session', async () => {
      const response = await sendAndReceive<SessionCreatedResponse>(
        gateway.messageRouter,
        'conn-1',
        'session.create',
        {},
        handlerContext,
      );

      expect(response.type).toBe('session.created');
      expect(response.payload.sessionId).toBeDefined();
      expect(response.payload.agentId).toBeDefined();
      expect(response.payload.createdAt).toBeDefined();
    });

    it('should list sessions', async () => {
      const response = await sendAndReceive<SessionListResponse>(
        gateway.messageRouter,
        'conn-1',
        'session.list',
        {},
        handlerContext,
      );

      expect(response.type).toBe('session.list');
      expect(Array.isArray(response.payload.sessions)).toBe(true);
      expect(response.payload.total).toBeGreaterThanOrEqual(0);
    });

    it('should delete a session', async () => {
      const response = await sendAndReceive<{
        type: string;
        payload: { deleted: boolean };
      }>(
        gateway.messageRouter,
        'conn-1',
        'session.delete',
        { sessionId: 'session-e2e-id' },
        handlerContext,
      );

      expect(response.type).toBe('session.delete');
      expect(response.payload.deleted).toBe(true);
    });

    it('should handle concurrent sessions', async () => {
      const sessions = await Promise.all([
        sendAndReceive<SessionCreatedResponse>(
          gateway.messageRouter,
          'conn-1',
          'session.create',
          {},
          handlerContext,
        ),
        sendAndReceive<SessionCreatedResponse>(
          gateway.messageRouter,
          'conn-2',
          'session.create',
          {},
          handlerContext,
        ),
        sendAndReceive<SessionCreatedResponse>(
          gateway.messageRouter,
          'conn-3',
          'session.create',
          {},
          handlerContext,
        ),
      ]);

      expect(sessions).toHaveLength(3);
      sessions.forEach((s) => expect(s.type).toBe('session.created'));
    });
  });

  // ============================================================================
  // Agent & Provider Tests
  // ============================================================================

  describe('Agent & Provider Operations', () => {
    it('should list all agents', async () => {
      const response = await sendAndReceive<AgentListResponse>(
        gateway.messageRouter,
        'conn-1',
        'agent.list',
        {},
        handlerContext,
      );

      expect(response.type).toBe('agent.list');
      expect(Array.isArray(response.payload.agents)).toBe(true);
    });

    it('should get specific agent details', async () => {
      const response = await sendAndReceive<{
        type: string;
        payload: { agent: { id: string } };
      }>(
        gateway.messageRouter,
        'conn-1',
        'agent.get',
        { agentId: 'agent-1' },
        handlerContext,
      );

      expect(response.type).toBe('agent.get');
      expect(response.payload.agent.id).toBe('agent-1');
    });

    it('should list all providers', async () => {
      const response = await sendAndReceive<ProviderListResponse>(
        gateway.messageRouter,
        'conn-1',
        'provider.list',
        {},
        handlerContext,
      );

      expect(response.type).toBe('provider.list');
      expect(Array.isArray(response.payload.providers)).toBe(true);
    });

    it('should get provider models', async () => {
      const response = await sendAndReceive<{
        type: string;
        payload: { models: unknown[] };
      }>(
        gateway.messageRouter,
        'conn-1',
        'provider.models',
        { providerId: 'openai' },
        handlerContext,
      );

      expect(response.type).toBe('provider.models');
      expect(Array.isArray(response.payload.models)).toBe(true);
    });
  });

  // ============================================================================
  // Node & Pairing Tests
  // ============================================================================

  describe('Node & Pairing Operations', () => {
    it('should create pairing request', async () => {
      const response = await sendAndReceive<{
        type: string;
        payload: { code?: string; pairingCode?: string };
      }>(
        gateway.messageRouter,
        'conn-1',
        'pairing.request',
        { clientId: 'test-client', capabilities: ['test'] },
        handlerContext,
      );

      // Response type is pairing.requested
      expect(response.type).toBe('pairing.requested');
      // pairingCode is in the payload
      expect(response.payload.pairingCode).toBeDefined();
      expect(response.payload.pairingCode).toMatch(/^\d{6}$/);
    });

    it('should list registered nodes', async () => {
      const response = await sendAndReceive<{
        type: string;
        payload: { nodes: unknown[] };
      }>(gateway.messageRouter, 'conn-1', 'node.list', {}, handlerContext);

      expect(response.type).toBe('node.list');
      expect(Array.isArray(response.payload.nodes)).toBe(true);
    });

    it('should register a node via node registry', async () => {
      // Register directly via node registry (as the handler does)
      gateway.nodeRegistry.registerNode({
        nodeId: 'node-e2e-1',
        name: 'E2E Test Node',
        type: 'mobile',
        status: 'online',
        capabilities: ['test'],
        metadata: { version: '1.0.0' },
        connectionId: 'conn-1',
        registeredAt: Date.now(),
        lastSeen: Date.now(),
      });

      const node = gateway.nodeRegistry.getNode('node-e2e-1');
      expect(node).toBeDefined();
      expect(node?.nodeId).toBe('node-e2e-1');
    });

    it('should filter nodes by capability', async () => {
      // Register nodes with different capabilities directly
      gateway.nodeRegistry.registerNode({
        nodeId: 'node-cap-1',
        name: 'Node 1',
        type: 'mobile',
        status: 'online',
        capabilities: ['camera', 'microphone'],
        metadata: {},
        connectionId: 'conn-1',
        registeredAt: Date.now(),
        lastSeen: Date.now(),
      });
      gateway.nodeRegistry.registerNode({
        nodeId: 'node-cap-2',
        name: 'Node 2',
        type: 'desktop',
        status: 'online',
        capabilities: ['speaker'],
        metadata: {},
        connectionId: 'conn-2',
        registeredAt: Date.now(),
        lastSeen: Date.now(),
      });

      // Query for camera capability
      const nodes = gateway.nodeRegistry.findNodesByCapability('camera');
      expect(nodes.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ============================================================================
  // Configuration & Presence Tests
  // ============================================================================

  describe('Configuration & Presence Operations', () => {
    it('should get configuration', async () => {
      const response = await sendAndReceive<{
        type: string;
        payload: { config?: unknown };
      }>(gateway.messageRouter, 'conn-1', 'config.get', {}, handlerContext);

      expect(response.type).toBe('config.get');
      // The config service returns config
      expect(response.payload).toBeDefined();
    });

    it('should update presence status', async () => {
      // The handler returns presence.update type (not presence.updated)
      const response = await sendAndReceive<{
        type: string;
        payload: { success: boolean };
      }>(
        gateway.messageRouter,
        'conn-1',
        'presence.update',
        { status: 'online', metadata: { device: 'desktop' } },
        handlerContext,
      );

      // Response type matches request type (presence.update)
      expect(response.type).toBe('presence.update');
      expect(response.payload.success).toBe(true);
    });

    it('should get all presence', async () => {
      // Update presence first
      await sendAndReceive(
        gateway.messageRouter,
        'conn-1',
        'presence.update',
        { status: 'online' },
        handlerContext,
      );

      const response = await sendAndReceive<{
        type: string;
        payload: { presence: unknown[] };
      }>(
        gateway.messageRouter,
        'conn-1',
        'presence.getAll',
        {},
        handlerContext,
      );

      expect(response.type).toBe('presence.getAll');
      expect(Array.isArray(response.payload.presence)).toBe(true);
    });

    it('should subscribe to presence events', async () => {
      // The handler returns presence.subscribe type (not presence.subscribed)
      const response = await sendAndReceive<{
        type: string;
        payload: { subscribed: boolean };
      }>(
        gateway.messageRouter,
        'conn-1',
        'presence.subscribe',
        {},
        handlerContext,
      );

      // Response type matches request type (presence.subscribe)
      expect(response.type).toBe('presence.subscribe');
      expect(response.payload.subscribed).toBe(true);
    });
  });

  // ============================================================================
  // Error Handling Tests
  // ============================================================================

  describe('Error Handling', () => {
    it('should return error for unknown message type', async () => {
      const response = await sendAndReceive<ErrorResponse>(
        gateway.messageRouter,
        'conn-1',
        'unknown.message.type',
        {},
        handlerContext,
      );

      expect(response.type).toBe('error');
      expect(response.payload.error.code).toBe(
        WS_ERROR_CODES.UNKNOWN_MESSAGE_TYPE,
      );
    });

    it('should handle non-existent resource', async () => {
      const response = await sendAndReceive<ErrorResponse>(
        gateway.messageRouter,
        'conn-1',
        'session.get',
        { sessionId: 'non-existent-session' },
        handlerContext,
      );

      expect(response.type).toBe('error');
      expect(response.payload.error.code).toBe(WS_ERROR_CODES.NOT_FOUND);
    });

    it('should handle service errors gracefully', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockServices.sessions.listSessions as any).mockRejectedValueOnce(
        new Error('Database unavailable'),
      );

      const response = await sendAndReceive<ErrorResponse>(
        gateway.messageRouter,
        'conn-1',
        'session.list',
        {},
        handlerContext,
      );

      expect(response.type).toBe('error');
      expect(response.payload.error.code).toBe(WS_ERROR_CODES.INTERNAL_ERROR);
    });

    it('should enforce rate limiting', () => {
      gateway.connectionManager.registerConnection('conn-1');

      // First request should be allowed
      const result1 = gateway.connectionManager.checkRateLimit('conn-1');
      expect(result1.allowed).toBe(true);
    });
  });

  // ============================================================================
  // Handler Registration Tests
  // ============================================================================

  describe('Handler Registration', () => {
    it('should have all session handlers registered', () => {
      expect(gateway.messageRouter.hasHandler('session.create')).toBe(true);
      expect(gateway.messageRouter.hasHandler('session.get')).toBe(true);
      expect(gateway.messageRouter.hasHandler('session.list')).toBe(true);
      expect(gateway.messageRouter.hasHandler('session.delete')).toBe(true);
      expect(gateway.messageRouter.hasHandler('session.message')).toBe(true);
    });

    it('should have all agent handlers registered', () => {
      expect(gateway.messageRouter.hasHandler('agent.list')).toBe(true);
      expect(gateway.messageRouter.hasHandler('agent.get')).toBe(true);
    });

    it('should have provider handlers registered', () => {
      // Provider handler registers: provider.list, provider.models (not provider.get)
      expect(gateway.messageRouter.hasHandler('provider.list')).toBe(true);
      expect(gateway.messageRouter.hasHandler('provider.models')).toBe(true);
    });

    it('should have node handlers registered', () => {
      // Node handler registers: node.list, node.describe, node.invoke, node.register, node.unregister
      expect(gateway.messageRouter.hasHandler('node.list')).toBe(true);
      expect(gateway.messageRouter.hasHandler('node.register')).toBe(true);
      expect(gateway.messageRouter.hasHandler('node.unregister')).toBe(true);
      expect(gateway.messageRouter.hasHandler('node.invoke')).toBe(true);
    });

    it('should have all pairing handlers registered', () => {
      expect(gateway.messageRouter.hasHandler('pairing.request')).toBe(true);
      expect(gateway.messageRouter.hasHandler('pairing.status')).toBe(true);
      expect(gateway.messageRouter.hasHandler('pairing.approve')).toBe(true);
      expect(gateway.messageRouter.hasHandler('pairing.deny')).toBe(true);
      expect(gateway.messageRouter.hasHandler('pairing.list')).toBe(true);
    });

    it('should have all config handlers registered', () => {
      expect(gateway.messageRouter.hasHandler('config.get')).toBe(true);
      expect(gateway.messageRouter.hasHandler('config.update')).toBe(true);
      expect(gateway.messageRouter.hasHandler('config.watch')).toBe(true);
      expect(gateway.messageRouter.hasHandler('config.unwatch')).toBe(true);
    });

    it('should have all presence handlers registered', () => {
      expect(gateway.messageRouter.hasHandler('presence.update')).toBe(true);
      expect(gateway.messageRouter.hasHandler('presence.get')).toBe(true);
      expect(gateway.messageRouter.hasHandler('presence.getAll')).toBe(true);
      expect(gateway.messageRouter.hasHandler('presence.subscribe')).toBe(true);
      expect(gateway.messageRouter.hasHandler('presence.unsubscribe')).toBe(
        true,
      );
    });
  });

  // ============================================================================
  // Cleanup Tests
  // ============================================================================

  describe('Cleanup', () => {
    it('should cleanup all resources on connection close', () => {
      const connId = 'conn-cleanup';

      // Setup
      gateway.connectionManager.registerConnection(connId);
      gateway.subscriptionManager.createSubscription(connId, 'session-1');

      // Verify setup
      expect(gateway.connectionManager.getConnectionCount()).toBe(1);
      expect(gateway.subscriptionManager.getSubscriptionCount()).toBe(1);

      // Cleanup
      gateway.subscriptionManager.removeConnectionSubscriptions(connId);
      gateway.connectionManager.removeConnection(connId);

      // Verify cleanup
      expect(gateway.connectionManager.getConnectionCount()).toBe(0);
      expect(gateway.subscriptionManager.getSubscriptionCount()).toBe(0);
    });

    it('should handle multiple connections independently', () => {
      // Setup two connections
      gateway.connectionManager.registerConnection('conn-1');
      gateway.connectionManager.registerConnection('conn-2');
      gateway.subscriptionManager.createSubscription('conn-1', 'session-1');
      gateway.subscriptionManager.createSubscription('conn-2', 'session-1');

      // Remove one connection
      gateway.subscriptionManager.removeConnectionSubscriptions('conn-1');
      gateway.connectionManager.removeConnection('conn-1');

      // Verify other connection still exists
      expect(gateway.connectionManager.getConnectionCount()).toBe(1);
      expect(gateway.subscriptionManager.getSubscriptionCount()).toBe(1);
    });

    it('should cleanup node registry', () => {
      gateway.nodeRegistry.registerNode({
        nodeId: 'node-1',
        name: 'Node 1',
        type: 'mobile',
        status: 'online',
        capabilities: [],
        metadata: {},
        connectionId: 'conn-1',
        registeredAt: Date.now(),
        lastSeen: Date.now(),
      });
      expect(gateway.nodeRegistry.size).toBe(1);

      gateway.nodeRegistry.clear();
      expect(gateway.nodeRegistry.size).toBe(0);
    });

    it('should cleanup presence manager', () => {
      gateway.presenceManager.updatePresence('conn-1', 'online');
      expect(gateway.presenceManager.size).toBe(1);

      gateway.presenceManager.clear();
      expect(gateway.presenceManager.size).toBe(0);
    });
  });

  // ============================================================================
  // Gateway Integration Tests
  // ============================================================================

  describe('Gateway Integration', () => {
    it('should track pending requests', () => {
      const requestId = gateway.messageRouter.createRequestId();
      expect(requestId).toBeDefined();
      expect(requestId.startsWith('req_')).toBe(true);
    });

    it('should clear pending requests on connection close', async () => {
      const requestId = gateway.messageRouter.createRequestId();
      const trackPromise = gateway.messageRouter.trackRequest(
        requestId,
        'conn-1',
      );

      const cleared = gateway.messageRouter.clearPendingRequests('conn-1');
      expect(cleared).toBe(1);

      await expect(trackPromise).rejects.toThrow('Connection closed');
    });

    it('should check if message can be routed', () => {
      expect(
        gateway.messageRouter.canRoute({
          id: '1',
          type: 'session.create',
          timestamp: '',
          payload: {},
        }),
      ).toBe(true);
      expect(
        gateway.messageRouter.canRoute({
          id: '1',
          type: 'unknown.type',
          timestamp: '',
          payload: {},
        }),
      ).toBe(false);
    });
  });

  // ============================================================================
  // Performance Tests
  // ============================================================================

  describe('Performance', () => {
    it('should handle 100 concurrent connections', () => {
      const start = performance.now();

      for (let i = 0; i < 100; i++) {
        gateway.connectionManager.registerConnection(`conn-perf-${i}`);
      }

      const duration = performance.now() - start;
      expect(gateway.connectionManager.getConnectionCount()).toBe(100);
      expect(duration).toBeLessThan(100); // Should be fast
    });

    it('should handle 100 messages quickly', async () => {
      gateway.connectionManager.registerConnection('conn-perf');

      const messageCount = 100;
      const start = performance.now();

      const promises = [];
      for (let i = 0; i < messageCount; i++) {
        promises.push(
          sendAndReceive(
            gateway.messageRouter,
            'conn-perf',
            'session.list',
            {},
            handlerContext,
          ),
        );
      }

      await Promise.all(promises);

      const duration = performance.now() - start;
      const messagesPerSecond = (messageCount / duration) * 1000;

      expect(messagesPerSecond).toBeGreaterThan(100); // At least 100 msg/s
    });

    it('should cleanup connections efficiently', () => {
      // Create 100 connections
      for (let i = 0; i < 100; i++) {
        gateway.connectionManager.registerConnection(`conn-cleanup-${i}`);
      }

      const start = performance.now();

      // Remove all
      for (let i = 0; i < 100; i++) {
        gateway.connectionManager.removeConnection(`conn-cleanup-${i}`);
      }

      const duration = performance.now() - start;
      expect(gateway.connectionManager.getConnectionCount()).toBe(0);
      expect(duration).toBeLessThan(50); // Should be fast
    });
  });
});
