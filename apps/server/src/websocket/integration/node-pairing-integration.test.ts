import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import { createGateway, type WebSocketGateway } from '../index';
import type { WSMessage } from '@openaidy/shared-types';
import type { AppServices } from '../../types';
import { AuthMiddleware } from '../middleware/auth';

// ============================================================================
// Mock AuthMiddleware
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

// ============================================================================
// Mock Services
// ============================================================================

const createMockServices = (_authMiddleware: AuthMiddleware): AppServices =>
  ({
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
      createSession: vi.fn(),
      getSession: vi.fn(),
      getSessionOrFail: vi.fn(),
      listSessions: vi.fn(),
      deleteSession: vi.fn(),
      addMessage: vi.fn(),
      getMessages: vi.fn(),
      updateMetadata: vi.fn(),
      archiveSession: vi.fn(),
    } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    agents: {
      listAgents: vi.fn().mockReturnValue([]),
      getAgent: vi.fn(),
      getAgentOrFail: vi.fn(),
      createAgent: vi.fn(),
      updateAgent: vi.fn(),
      deleteAgent: vi.fn(),
    } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    providers: {
      getProvider: vi.fn(),
      listProviders: vi.fn().mockReturnValue([]),
    } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    config: {
      getConfig: vi.fn(),
      load: vi.fn(),
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
    } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    content: {
      createContent: vi.fn(),
      getContent: vi.fn(),
      listContent: vi.fn(),
      updateContent: vi.fn(),
      deleteContent: vi.fn(),
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
    taskSchedules: undefined,
    channels: undefined as unknown as AppServices['channels'],
  }) as AppServices;

// ============================================================================
// Node & Pairing Integration Tests
// ============================================================================

describe('Node & Pairing Handler Integration', () => {
  let gateway: WebSocketGateway;
  let mockServices: AppServices;
  let mockAuth: AuthMiddleware;
  let mockFastify: {
    log: FastifyBaseLogger;
    services: AppServices;
  };

  beforeEach(() => {
    mockAuth = createMockAuthMiddleware();
    mockServices = createMockServices(mockAuth);

    mockFastify = {
      log: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
        fatal: vi.fn(),
        trace: vi.fn(),
        child: () => mockFastify.log,
        level: 'info',
        silent: vi.fn(),
      } as unknown as FastifyBaseLogger,
      services: mockServices,
    };

    gateway = createGateway(mockFastify);
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
    it('should create a gateway with node and pairing handlers', () => {
      expect(gateway).toBeDefined();
      expect(gateway.config).toBeDefined();
      expect(gateway.pairingConfig).toBeDefined();
      expect(gateway.messageRouter).toBeDefined();
      expect(gateway.connectionManager).toBeDefined();
    });

    it('should have nodeHandler in gateway', () => {
      expect(gateway.nodeHandler).toBeDefined();
    });

    it('should have pairingHandler in gateway', () => {
      expect(gateway.pairingHandler).toBeDefined();
    });

    it('should have nodeRegistry in gateway', () => {
      expect(gateway.nodeRegistry).toBeDefined();
    });

    it('should have pairingService in gateway', () => {
      expect(gateway.pairingService).toBeDefined();
    });
  });

  // ============================================================================
  // Message Router Registration Tests
  // ============================================================================

  describe('Message Router Registration', () => {
    it('should have node handlers registered', () => {
      const handlerTypes = gateway.messageRouter.getHandlerTypes();

      expect(handlerTypes).toContain('node.list');
      expect(handlerTypes).toContain('node.describe');
      expect(handlerTypes).toContain('node.invoke');
      expect(handlerTypes).toContain('node.register');
      expect(handlerTypes).toContain('node.unregister');
    });

    it('should have pairing handlers registered', () => {
      const handlerTypes = gateway.messageRouter.getHandlerTypes();

      expect(handlerTypes).toContain('pairing.request');
      expect(handlerTypes).toContain('pairing.status');
      expect(handlerTypes).toContain('pairing.approve');
      expect(handlerTypes).toContain('pairing.deny');
      expect(handlerTypes).toContain('pairing.list');
    });

    it('should have all required handlers registered', () => {
      const handlerTypes = gateway.messageRouter.getHandlerTypes();

      // Node handlers
      expect(handlerTypes).toContain('node.list');
      expect(handlerTypes).toContain('node.describe');
      expect(handlerTypes).toContain('node.invoke');
      expect(handlerTypes).toContain('node.register');
      expect(handlerTypes).toContain('node.unregister');

      // Pairing handlers
      expect(handlerTypes).toContain('pairing.request');
      expect(handlerTypes).toContain('pairing.status');
      expect(handlerTypes).toContain('pairing.approve');
      expect(handlerTypes).toContain('pairing.deny');
      expect(handlerTypes).toContain('pairing.list');
    });
  });

  // ============================================================================
  // Node Registry Tests
  // ============================================================================

  describe('Node Registry', () => {
    it('should start empty', () => {
      expect(gateway.nodeRegistry.size).toBe(0);
    });

    it('should register nodes', () => {
      const node = {
        nodeId: 'test-node-1',
        name: 'Test Node',
        type: 'mobile' as const,
        status: 'online' as const,
        capabilities: ['camera', 'microphone'],
        metadata: {},
        connectionId: 'conn-1',
        registeredAt: Date.now(),
        lastSeen: Date.now(),
      };

      gateway.nodeRegistry.registerNode(node);

      expect(gateway.nodeRegistry.size).toBe(1);

      const retrieved = gateway.nodeRegistry.getNode('test-node-1');
      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe('Test Node');
    });

    it('should find nodes by capability', () => {
      gateway.nodeRegistry.registerNode({
        nodeId: 'node-1',
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
        nodeId: 'node-2',
        name: 'Node 2',
        type: 'desktop',
        status: 'online',
        capabilities: ['screen', 'keyboard'],
        metadata: {},
        connectionId: 'conn-2',
        registeredAt: Date.now(),
        lastSeen: Date.now(),
      });

      const cameraNodes = gateway.nodeRegistry.findNodesByCapability('camera');
      expect(cameraNodes).toHaveLength(1);
      expect(cameraNodes[0]?.nodeId).toBe('node-1');
    });

    it('should unregister nodes', () => {
      gateway.nodeRegistry.registerNode({
        nodeId: 'node-1',
        name: 'Test Node',
        type: 'mobile',
        status: 'online',
        capabilities: [],
        metadata: {},
        connectionId: 'conn-1',
        registeredAt: Date.now(),
        lastSeen: Date.now(),
      });

      gateway.nodeRegistry.unregisterNode('node-1');
      expect(gateway.nodeRegistry.size).toBe(0);
    });
  });

  // ============================================================================
  // Pairing Service Tests
  // ============================================================================

  describe('Pairing Service', () => {
    it('should create pairing requests', () => {
      const request = gateway.pairingService.createRequest(
        'Test Device',
        'mobile',
        ['camera', 'microphone'],
      );

      expect(request.requestId).toBeDefined();
      expect(request.pairingCode).toBeDefined();
      expect(request.pairingCode).toMatch(/^\d{6}$/);
      expect(request.deviceName).toBe('Test Device');
      expect(request.deviceType).toBe('mobile');
      expect(request.capabilities).toEqual(['camera', 'microphone']);
      expect(request.status).toBe('pending');
    });

    it('should get pending requests', () => {
      gateway.pairingService.createRequest('Device 1', 'mobile', ['camera']);
      gateway.pairingService.createRequest('Device 2', 'desktop', ['screen']);

      const pending = gateway.pairingService.getPendingRequests();
      expect(pending).toHaveLength(2);
    });

    it('should get request by code', () => {
      const created = gateway.pairingService.createRequest(
        'Test',
        'mobile',
        [],
      );

      const found = gateway.pairingService.getRequestByCode(
        created.pairingCode,
      );
      expect(found).toBeDefined();
      expect(found?.requestId).toBe(created.requestId);
    });

    it('should approve requests', async () => {
      const request = gateway.pairingService.createRequest(
        'Test Device',
        'mobile',
        ['camera'],
      );

      const approved = await gateway.pairingService.approveRequest(
        request.requestId,
        'admin-user',
        ['camera'],
      );

      expect(approved).toBeDefined();
      expect(approved?.status).toBe('approved');
      expect(approved?.nodeId).toBeDefined();
      expect(approved?.token).toBeDefined();
      // Token should be a JWT (three base64url-encoded parts separated by dots)
      expect(approved?.token).toMatch(
        /^eyJ[A-Za-z0-9-_]+\.eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/,
      );
    });

    it('should deny requests', () => {
      const request = gateway.pairingService.createRequest(
        'Test Device',
        'mobile',
        [],
      );

      const denied = gateway.pairingService.denyRequest(
        request.requestId,
        'admin-user',
      );

      expect(denied).toBeDefined();
      expect(denied?.status).toBe('denied');
    });
  });

  // ============================================================================
  // End-to-End Flow Tests
  // ============================================================================

  describe('End-to-End Flow', () => {
    it('should complete full pairing and node registration flow', async () => {
      // 1. Create pairing request
      const request = gateway.pairingService.createRequest(
        'My Phone',
        'mobile',
        ['camera', 'microphone', 'gps'],
      );

      expect(request.status).toBe('pending');

      // 2. Approve pairing
      const approved = await gateway.pairingService.approveRequest(
        request.requestId,
        'admin',
        ['camera', 'microphone'],
      );

      expect(approved?.status).toBe('approved');
      expect(approved?.nodeId).toBeDefined();
      // Token should be a JWT
      expect(approved?.token).toMatch(
        /^eyJ[A-Za-z0-9-_]+\.eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/,
      );

      // 3. Verify node is registered (note: approveRequest does NOT register the node,
      // it just generates a nodeId and token. The node needs to be registered separately
      // via node.register with the connectionId)

      // For this integration test, we verify the pairing flow works correctly
      // Node registration happens via node.register handler after receiving the token
    });

    it('should allow an approved device to authenticate and claim its approved node identity', async () => {
      gateway.connectionManager.registerConnection('device-conn');

      const request = gateway.pairingService.createRequest(
        'Paired Phone',
        'mobile',
        ['camera', 'microphone'],
      );

      const approved = await gateway.pairingService.approveRequest(
        request.requestId,
        'admin',
        ['camera'],
      );

      expect(approved?.nodeId).toBeDefined();
      expect(approved?.token).toBeDefined();

      const authResponse = await gateway.messageRouter.route(
        'device-conn',
        {
          id: 'auth-1',
          type: 'auth.authenticate',
          timestamp: new Date().toISOString(),
          payload: { token: approved!.token },
        } as unknown as WSMessage,
        {
          connectionManager: gateway.connectionManager,
          services: mockServices,
          logger: mockFastify.log,
        },
      );

      expect(authResponse?.type).toBe('auth.authenticated');

      const registerResponse = await gateway.messageRouter.route(
        'device-conn',
        {
          id: 'node-reg-1',
          type: 'node.register',
          timestamp: new Date().toISOString(),
          payload: {
            name: 'Paired Phone',
            type: 'mobile',
            capabilities: ['camera', 'microphone'],
            metadata: { platform: 'ios' },
          },
        } as unknown as WSMessage,
        {
          connectionManager: gateway.connectionManager,
          services: mockServices,
          logger: mockFastify.log,
        },
      );

      expect(registerResponse?.type).toBe('node.registered');

      const node = gateway.nodeRegistry.getNode(approved!.nodeId!);
      expect(node).toBeDefined();
      expect(node?.connectionId).toBe('device-conn');
      expect(node?.capabilities).toEqual(['camera']);
      expect(node?.scopes).toEqual(['camera']);
    });

    it('should handle multiple pairing requests', async () => {
      // Create multiple pairing requests
      const devices = [
        { name: 'Phone', type: 'mobile' as const, caps: ['camera'] },
        { name: 'Desktop', type: 'desktop' as const, caps: ['screen'] },
        { name: 'Browser', type: 'browser' as const, caps: ['notifications'] },
      ];

      const requests = devices.map((device) =>
        gateway.pairingService.createRequest(
          device.name,
          device.type,
          device.caps,
        ),
      );

      // Verify all requests are pending
      const pending = gateway.pairingService.getPendingRequests();
      expect(pending).toHaveLength(3);

      // Approve all
      for (const request of requests) {
        const approved = await gateway.pairingService.approveRequest(
          request.requestId,
          'admin',
        );
        expect(approved?.status).toBe('approved');
        // Token should be a JWT
        expect(approved?.token).toMatch(
          /^eyJ[A-Za-z0-9-_]+\.eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/,
        );
      }

      // Verify no more pending
      const remainingPending = gateway.pairingService.getPendingRequests();
      expect(remainingPending).toHaveLength(0);
    });
  });

  // ============================================================================
  // Cleanup Tests
  // ============================================================================

  describe('Cleanup', () => {
    it('should cleanup on shutdown', async () => {
      // Add some data
      gateway.nodeRegistry.registerNode({
        nodeId: 'test',
        name: 'Test',
        type: 'mobile',
        status: 'online',
        capabilities: [],
        metadata: {},
        connectionId: 'conn-1',
        registeredAt: Date.now(),
        lastSeen: Date.now(),
      });

      gateway.pairingService.createRequest('Device', 'mobile', []);

      // Shutdown
      await gateway.shutdown();

      // Verify cleanup
      expect(gateway.nodeRegistry.size).toBe(0);
    });
  });
});
