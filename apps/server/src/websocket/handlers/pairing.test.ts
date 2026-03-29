import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import {
  PairingHandler,
  registerPairingHandlers,
  createPairingHandler,
} from './pairing';
import { PairingService } from '../pairing-service';
import { NodeRegistry, type NodeType } from '../node-registry';
import { type HandlerContext } from '../message-router';
import { ConnectionManager } from '../connection-manager';
import { AuthMiddleware } from '../middleware/auth';
import { createWSMessage, WS_ERROR_CODES } from '@openaidy/shared-types';
import type { WebSocketConfig } from '../types';

// ============================================================================
// Mock Factories
// ============================================================================

const createMockLogger = (): FastifyBaseLogger => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  child: vi.fn(() => createMockLogger()),
  level: 'info',
  silent: false,
} as unknown as FastifyBaseLogger);

const createMockConfig = (): WebSocketConfig => ({
  auth: {
    secret: 'test-secret-key-for-pairing-handler-tests',
    tokenExpiry: 3600000, // 1 hour
  },
  rateLimit: {
    enabled: false,
    maxConnections: 100,
    windowMs: 60000,
  },
  heartbeat: {
    interval: 30000,
    timeout: 10000,
  },
} as WebSocketConfig);

// ============================================================================
// PairingHandler Tests
// ============================================================================

describe('PairingHandler', () => {
  let handler: PairingHandler;
  let pairingService: PairingService;
  let nodeRegistry: NodeRegistry;
  let connectionManager: ConnectionManager;
  let authMiddleware: AuthMiddleware;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let mockConfig: WebSocketConfig;
  let handlerContext: HandlerContext;

  beforeEach(() => {
    mockLogger = createMockLogger();
    mockConfig = createMockConfig();
    authMiddleware = new AuthMiddleware(mockConfig);
    
    pairingService = new PairingService(authMiddleware, mockLogger);
    nodeRegistry = new NodeRegistry({}, mockLogger);
    connectionManager = new ConnectionManager();
    handler = new PairingHandler(pairingService, connectionManager, nodeRegistry, mockLogger);
    
    handlerContext = {
      connectionManager,
      services: {},
      logger: mockLogger,
    };
  });

  afterEach(() => {
    pairingService.destroy();
    pairingService.clear();
    nodeRegistry.clear();
  });

  // ============================================================================
  // handleRequest Tests
  // ============================================================================

  describe('handleRequest', () => {
    it('should create a pairing request', async () => {
      const request = createWSMessage('pairing.request', {
        deviceName: 'Test Device',
        deviceType: 'mobile' as NodeType,
        capabilities: ['camera', 'microphone'],
      });

      const response = await handler.handleRequest('conn-1', request, handlerContext);

      if (response.type === 'pairing.requested') {
        expect(response.payload.requestId).toBeDefined();
        expect(response.payload.pairingCode).toBeDefined();
        expect(response.payload.pairingCode).toHaveLength(6);
        expect(response.payload.deviceName).toBe('Test Device');
        expect(response.payload.deviceType).toBe('mobile');
        expect(response.payload.capabilities).toEqual(['camera', 'microphone']);
        expect(response.payload.requestedAt).toBeDefined();
        expect(response.payload.expiresAt).toBeGreaterThan(response.payload.requestedAt);
      } else {
        expect.fail('Expected pairing.requested response');
      }
    });

    it('should create a pairing request with metadata', async () => {
      const metadata = { version: '1.0', platform: 'ios' };
      const request = createWSMessage('pairing.request', {
        deviceName: 'Test Device',
        deviceType: 'mobile' as NodeType,
        capabilities: ['camera'],
        metadata,
      });

      const response = await handler.handleRequest('conn-1', request, handlerContext);

      if (response.type === 'pairing.requested') {
        // Verify the request was stored with metadata
        const stored = pairingService.getRequest(response.payload.requestId);
        expect(stored?.metadata).toEqual(metadata);
      } else {
        expect.fail('Expected pairing.requested response');
      }
    });

    it('should log request creation', async () => {
      const request = createWSMessage('pairing.request', {
        deviceName: 'Test Device',
        deviceType: 'mobile' as NodeType,
        capabilities: ['camera'],
      });

      await handler.handleRequest('conn-1', request, handlerContext);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionId: 'conn-1',
          deviceName: 'Test Device',
          deviceType: 'mobile',
        }),
        'Creating pairing request via WebSocket',
      );
    });
  });

  // ============================================================================
  // handleStatus Tests
  // ============================================================================

  describe('handleStatus', () => {
    it('should get status by requestId', async () => {
      // Create a pairing request
      const createReq = createWSMessage('pairing.request', {
        deviceName: 'Test Device',
        deviceType: 'mobile' as NodeType,
        capabilities: ['camera'],
      });
      const created = await handler.handleRequest('conn-1', createReq, handlerContext);

      if (created.type !== 'pairing.requested') {
        expect.fail('Expected pairing.requested response');
      }

      const statusReq = createWSMessage('pairing.status', {
        requestId: created.payload.requestId,
      });
      const response = await handler.handleStatus('conn-1', statusReq, handlerContext);

      if (response.type === 'pairing.status') {
        expect(response.payload.request).toBeDefined();
        expect(response.payload.request?.requestId).toBe(created.payload.requestId);
      } else {
        expect.fail('Expected pairing.status response');
      }
    });

    it('should get status by pairingCode', async () => {
      const createReq = createWSMessage('pairing.request', {
        deviceName: 'Test Device',
        deviceType: 'mobile' as NodeType,
        capabilities: ['camera'],
      });
      const created = await handler.handleRequest('conn-1', createReq, handlerContext);

      if (created.type !== 'pairing.requested') {
        expect.fail('Expected pairing.requested response');
      }

      const statusReq = createWSMessage('pairing.status', {
        pairingCode: created.payload.pairingCode,
      });
      const response = await handler.handleStatus('conn-1', statusReq, handlerContext);

      if (response.type === 'pairing.status') {
        expect(response.payload.request).toBeDefined();
        expect(response.payload.request?.pairingCode).toBe(created.payload.pairingCode);
      } else {
        expect.fail('Expected pairing.status response');
      }
    });

    it('should return null for non-existent request', async () => {
      const statusReq = createWSMessage('pairing.status', {
        requestId: 'non-existent',
      });
      const response = await handler.handleStatus('conn-1', statusReq, handlerContext);

      if (response.type === 'pairing.status') {
        expect(response.payload.request).toBeNull();
      } else {
        expect.fail('Expected pairing.status response');
      }
    });

    it('should return null for non-existent pairing code', async () => {
      const statusReq = createWSMessage('pairing.status', {
        pairingCode: '000000',
      });
      const response = await handler.handleStatus('conn-1', statusReq, handlerContext);

      if (response.type === 'pairing.status') {
        expect(response.payload.request).toBeNull();
      } else {
        expect.fail('Expected pairing.status response');
      }
    });

    it('should log status request', async () => {
      const statusReq = createWSMessage('pairing.status', {
        requestId: 'test-id',
      });
      await handler.handleStatus('conn-1', statusReq, handlerContext);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionId: 'conn-1',
          requestId: 'test-id',
        }),
        'Getting pairing status via WebSocket',
      );
    });
  });

  // ============================================================================
  // handleApprove Tests
  // ============================================================================

  describe('handleApprove', () => {
    it('should approve a pending request', async () => {
      const createReq = createWSMessage('pairing.request', {
        deviceName: 'Test Device',
        deviceType: 'mobile' as NodeType,
        capabilities: ['camera'],
      });
      const created = await handler.handleRequest('conn-1', createReq, handlerContext);

      if (created.type !== 'pairing.requested') {
        expect.fail('Expected pairing.requested response');
      }

      const approveReq = createWSMessage('pairing.approve', {
        requestId: created.payload.requestId,
      });
      const response = await handler.handleApprove('conn-2', approveReq, handlerContext);

      if (response.type === 'pairing.approved') {
        expect(response.payload.requestId).toBe(created.payload.requestId);
        expect(response.payload.nodeId).toBeDefined();
        expect(response.payload.token).toBeDefined();
        expect(response.payload.scopes).toEqual(['camera']);
        expect(response.payload.approvedAt).toBeDefined();
      } else {
        expect.fail('Expected pairing.approved response');
      }
    });

    it('should approve with custom scopes', async () => {
      const createReq = createWSMessage('pairing.request', {
        deviceName: 'Test Device',
        deviceType: 'mobile' as NodeType,
        capabilities: ['camera', 'microphone'],
      });
      const created = await handler.handleRequest('conn-1', createReq, handlerContext);

      if (created.type !== 'pairing.requested') {
        expect.fail('Expected pairing.requested response');
      }

      const approveReq = createWSMessage('pairing.approve', {
        requestId: created.payload.requestId,
        scopes: ['camera'], // Only grant camera
      });
      const response = await handler.handleApprove('conn-2', approveReq, handlerContext);

      if (response.type === 'pairing.approved') {
        expect(response.payload.scopes).toEqual(['camera']);
      } else {
        expect.fail('Expected pairing.approved response');
      }
    });

    it('should return error for non-existent request', async () => {
      const approveReq = createWSMessage('pairing.approve', {
        requestId: 'non-existent',
      });
      const response = await handler.handleApprove('conn-1', approveReq, handlerContext);

      if (response.type === 'error') {
        expect(response.payload.error.code).toBe(WS_ERROR_CODES.NOT_FOUND);
      } else {
        expect.fail('Expected error response');
      }
    });

    it('should return error for already approved request', async () => {
      const createReq = createWSMessage('pairing.request', {
        deviceName: 'Test Device',
        deviceType: 'mobile' as NodeType,
        capabilities: ['camera'],
      });
      const created = await handler.handleRequest('conn-1', createReq, handlerContext);

      if (created.type !== 'pairing.requested') {
        expect.fail('Expected pairing.requested response');
      }

      const approveReq = createWSMessage('pairing.approve', {
        requestId: created.payload.requestId,
      });

      // First approval
      await handler.handleApprove('conn-2', approveReq, handlerContext);

      // Second approval attempt - the request is no longer found because it was already processed
      const response = await handler.handleApprove('conn-2', approveReq, handlerContext);

      if (response.type === 'error') {
        expect(response.payload.error.code).toBe(WS_ERROR_CODES.NOT_FOUND);
      } else {
        expect.fail('Expected error response');
      }
    });

    it('should register node after approval', async () => {
      const createReq = createWSMessage('pairing.request', {
        deviceName: 'Test Device',
        deviceType: 'mobile' as NodeType,
        capabilities: ['camera'],
      });
      const created = await handler.handleRequest('conn-1', createReq, handlerContext);

      if (created.type !== 'pairing.requested') {
        expect.fail('Expected pairing.requested response');
      }

      const approveReq = createWSMessage('pairing.approve', {
        requestId: created.payload.requestId,
      });
      const response = await handler.handleApprove('conn-2', approveReq, handlerContext);

      if (response.type === 'pairing.approved') {
        // Verify node was registered
        const node = nodeRegistry.getNode(response.payload.nodeId);
        expect(node).toBeDefined();
        expect(node?.name).toBe('Test Device');
        expect(node?.type).toBe('mobile');
        expect(node?.capabilities).toEqual(['camera']);
      } else {
        expect.fail('Expected pairing.approved response');
      }
    });

    it('should log approval', async () => {
      const createReq = createWSMessage('pairing.request', {
        deviceName: 'Test Device',
        deviceType: 'mobile' as NodeType,
        capabilities: ['camera'],
      });
      const created = await handler.handleRequest('conn-1', createReq, handlerContext);

      if (created.type !== 'pairing.requested') {
        expect.fail('Expected pairing.requested response');
      }

      const approveReq = createWSMessage('pairing.approve', {
        requestId: created.payload.requestId,
      });
      await handler.handleApprove('conn-2', approveReq, handlerContext);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionId: 'conn-2',
          requestId: created.payload.requestId,
        }),
        'Approving pairing request via WebSocket',
      );
    });
  });

  // ============================================================================
  // handleDeny Tests
  // ============================================================================

  describe('handleDeny', () => {
    it('should deny a pending request', async () => {
      const createReq = createWSMessage('pairing.request', {
        deviceName: 'Test Device',
        deviceType: 'mobile' as NodeType,
        capabilities: ['camera'],
      });
      const created = await handler.handleRequest('conn-1', createReq, handlerContext);

      if (created.type !== 'pairing.requested') {
        expect.fail('Expected pairing.requested response');
      }

      const denyReq = createWSMessage('pairing.deny', {
        requestId: created.payload.requestId,
      });
      const response = await handler.handleDeny('conn-2', denyReq, handlerContext);

      if (response.type === 'pairing.denied') {
        expect(response.payload.requestId).toBe(created.payload.requestId);
        expect(response.payload.deniedAt).toBeDefined();
      } else {
        expect.fail('Expected pairing.denied response');
      }
    });

    it('should return error for non-existent request', async () => {
      const denyReq = createWSMessage('pairing.deny', {
        requestId: 'non-existent',
      });
      const response = await handler.handleDeny('conn-1', denyReq, handlerContext);

      if (response.type === 'error') {
        expect(response.payload.error.code).toBe(WS_ERROR_CODES.NOT_FOUND);
      } else {
        expect.fail('Expected error response');
      }
    });

    it('should return error for already denied request', async () => {
      const createReq = createWSMessage('pairing.request', {
        deviceName: 'Test Device',
        deviceType: 'mobile' as NodeType,
        capabilities: ['camera'],
      });
      const created = await handler.handleRequest('conn-1', createReq, handlerContext);

      if (created.type !== 'pairing.requested') {
        expect.fail('Expected pairing.requested response');
      }

      const denyReq = createWSMessage('pairing.deny', {
        requestId: created.payload.requestId,
      });

      // First denial
      await handler.handleDeny('conn-2', denyReq, handlerContext);

      // Second denial attempt - the request is no longer found because it was already processed
      const response = await handler.handleDeny('conn-2', denyReq, handlerContext);

      if (response.type === 'error') {
        expect(response.payload.error.code).toBe(WS_ERROR_CODES.NOT_FOUND);
      } else {
        expect.fail('Expected error response');
      }
    });

    it('should log denial', async () => {
      const createReq = createWSMessage('pairing.request', {
        deviceName: 'Test Device',
        deviceType: 'mobile' as NodeType,
        capabilities: ['camera'],
      });
      const created = await handler.handleRequest('conn-1', createReq, handlerContext);

      if (created.type !== 'pairing.requested') {
        expect.fail('Expected pairing.requested response');
      }

      const denyReq = createWSMessage('pairing.deny', {
        requestId: created.payload.requestId,
      });
      await handler.handleDeny('conn-2', denyReq, handlerContext);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionId: 'conn-2',
          requestId: created.payload.requestId,
        }),
        'Denying pairing request via WebSocket',
      );
    });
  });

  // ============================================================================
  // handleList Tests
  // ============================================================================

  describe('handleList', () => {
    it('should list pending requests', async () => {
      // Create multiple requests
      const req1 = createWSMessage('pairing.request', {
        deviceName: 'Device 1',
        deviceType: 'mobile' as NodeType,
        capabilities: ['camera'],
      });
      const req2 = createWSMessage('pairing.request', {
        deviceName: 'Device 2',
        deviceType: 'desktop' as NodeType,
        capabilities: ['screen'],
      });

      await handler.handleRequest('conn-1', req1, handlerContext);
      await handler.handleRequest('conn-1', req2, handlerContext);

      const listReq = createWSMessage('pairing.list', {});
      const response = await handler.handleList('conn-2', listReq, handlerContext);

      if (response.type === 'pairing.list') {
        expect(response.payload.requests).toHaveLength(2);
        expect(response.payload.requests.map(r => r.deviceName)).toContain('Device 1');
        expect(response.payload.requests.map(r => r.deviceName)).toContain('Device 2');
      } else {
        expect.fail('Expected pairing.list response');
      }
    });

    it('should only list pending requests', async () => {
      const req1 = createWSMessage('pairing.request', {
        deviceName: 'Device 1',
        deviceType: 'mobile' as NodeType,
        capabilities: ['camera'],
      });
      const req2 = createWSMessage('pairing.request', {
        deviceName: 'Device 2',
        deviceType: 'desktop' as NodeType,
        capabilities: ['screen'],
      });

      const created1 = await handler.handleRequest('conn-1', req1, handlerContext);
      await handler.handleRequest('conn-1', req2, handlerContext);

      // Approve one
      if (created1.type === 'pairing.requested') {
        const approveReq = createWSMessage('pairing.approve', {
          requestId: created1.payload.requestId,
        });
        await handler.handleApprove('conn-2', approveReq, handlerContext);
      }

      const listReq = createWSMessage('pairing.list', {});
      const response = await handler.handleList('conn-2', listReq, handlerContext);

      if (response.type === 'pairing.list') {
        expect(response.payload.requests).toHaveLength(1);
        expect(response.payload.requests[0].deviceName).toBe('Device 2');
      } else {
        expect.fail('Expected pairing.list response');
      }
    });

    it('should return empty array when no pending requests', async () => {
      const listReq = createWSMessage('pairing.list', {});
      const response = await handler.handleList('conn-1', listReq, handlerContext);

      if (response.type === 'pairing.list') {
        expect(response.payload.requests).toHaveLength(0);
      } else {
        expect.fail('Expected pairing.list response');
      }
    });

    it('should log list operation', async () => {
      const listReq = createWSMessage('pairing.list', {});
      await handler.handleList('conn-1', listReq, handlerContext);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionId: 'conn-1',
        }),
        'Listing pending pairing requests via WebSocket',
      );
    });
  });
});

// ============================================================================
// registerPairingHandlers Tests
// ============================================================================

describe('registerPairingHandlers', () => {
  it('should register all pairing handlers', () => {
    const mockRouter = {
      registerHandler: vi.fn(),
    };

    const mockLogger = createMockLogger();
    const mockConfig = createMockConfig();
    const authMiddleware = new AuthMiddleware(mockConfig);
    const pairingService = new PairingService(authMiddleware, mockLogger);
    const nodeRegistry = new NodeRegistry({}, mockLogger);
    const connectionManager = new ConnectionManager();
    const handler = new PairingHandler(pairingService, connectionManager, nodeRegistry, mockLogger);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerPairingHandlers(mockRouter as any, handler);

    expect(mockRouter.registerHandler).toHaveBeenCalledTimes(5);
    expect(mockRouter.registerHandler).toHaveBeenCalledWith('pairing.request', expect.any(Function));
    expect(mockRouter.registerHandler).toHaveBeenCalledWith('pairing.status', expect.any(Function));
    expect(mockRouter.registerHandler).toHaveBeenCalledWith('pairing.approve', expect.any(Function));
    expect(mockRouter.registerHandler).toHaveBeenCalledWith('pairing.deny', expect.any(Function));
    expect(mockRouter.registerHandler).toHaveBeenCalledWith('pairing.list', expect.any(Function));

    pairingService.destroy();
    pairingService.clear();
  });
});

// ============================================================================
// createPairingHandler Factory Tests
// ============================================================================

describe('createPairingHandler', () => {
  it('should create PairingHandler instance', () => {
    const mockLogger = createMockLogger();
    const mockConfig = createMockConfig();
    const authMiddleware = new AuthMiddleware(mockConfig);
    const pairingService = new PairingService(authMiddleware, mockLogger);
    const nodeRegistry = new NodeRegistry({}, mockLogger);
    const connectionManager = new ConnectionManager();

    const handler = createPairingHandler(pairingService, connectionManager, nodeRegistry, mockLogger);

    expect(handler).toBeInstanceOf(PairingHandler);

    pairingService.destroy();
    pairingService.clear();
  });
});
