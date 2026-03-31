/**
 * Tests for Pairing Flow - Issue #128
 * 
 * Secure and complete device pairing approval flow
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import {
  PairingService,
  PairingCodeGenerator,
  createPairingService,
  type PairingRequestStatus,
} from './pairing-service';
import { PairingHandler, registerPairingHandlers } from './handlers/pairing';
import { NodeRegistry, type NodeType } from './node-registry';
import { AuthMiddleware } from './middleware/auth';
import { MessageRouter, type HandlerContext } from './message-router';
import { ConnectionManager } from './connection-manager';
import type { WebSocketConfig } from './types';
import {
  createWSMessage,
  WS_ERROR_CODES,
  WS_CAPABILITIES,
} from '@openaidy/shared-types';

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
    secret: 'test-secret-key-for-pairing-flow-tests-min-32-chars',
    tokenExpiry: 3600000,
    required: false,
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
  enabled: true,
  path: '/ws',
  port: 3000,
  maxConnections: 100,
  heartbeatInterval: 30000,
} as WebSocketConfig);

// ============================================================================
// State Transition Tests
// ============================================================================

describe('Pairing Request State Transitions - Issue #128', () => {
  let pairingService: PairingService;
  let authMiddleware: AuthMiddleware;
  let mockLogger: FastifyBaseLogger;
  let mockConfig: WebSocketConfig;

  beforeEach(() => {
    vi.useFakeTimers();
    mockLogger = createMockLogger();
    mockConfig = createMockConfig();
    authMiddleware = new AuthMiddleware(mockConfig);
    pairingService = new PairingService(authMiddleware, mockLogger, {
      codeLength: 6,
      requestExpiry: 300000, // 5 minutes
      tokenExpiry: 2592000000, // 30 days
      cleanupInterval: 60000,
    });
  });

  afterEach(() => {
    pairingService.destroy();
    pairingService.clear();
    vi.useRealTimers();
  });

  describe('Valid state transitions', () => {
    it('should start in pending state', () => {
      const request = pairingService.createRequest(
        'Test Device',
        'mobile',
        ['sendMessage', 'receiveMessage'],
      );

      expect(request.status).toBe('pending');
    });

    it('should transition from pending to approved', async () => {
      const request = pairingService.createRequest('Device', 'mobile', []);
      const approved = await pairingService.approveRequest(request.requestId, 'admin-1');

      expect(approved).not.toBeNull();
      expect(approved?.status).toBe('approved');
      expect(approved?.nodeId).toBeDefined();
      expect(approved?.token).toBeDefined();
      expect(approved?.scopes).toEqual([]);
    });

    it('should transition from pending to denied', () => {
      const request = pairingService.createRequest('Device', 'mobile', []);
      const denied = pairingService.denyRequest(request.requestId, 'admin-1');

      expect(denied).not.toBeNull();
      expect(denied?.status).toBe('denied');
      expect(denied?.deniedBy).toBe('admin-1');
    });

    it('should transition from pending to expired', () => {
      const request = pairingService.createRequest('Device', 'mobile', []);
      
      // Advance time past expiry
      vi.advanceTimersByTime(301000); // 5 minutes + 1 second
      
      pairingService.cleanupExpiredRequests();
      
      const expiredRequest = pairingService.getRequest(request.requestId);
      expect(expiredRequest?.status).toBe('expired');
    });
  });

  describe('Invalid state transitions', () => {
    it('should NOT allow approving already approved request', async () => {
      const request = pairingService.createRequest('Device', 'mobile', []);
      
      const firstApproval = await pairingService.approveRequest(request.requestId, 'admin-1');
      expect(firstApproval?.status).toBe('approved');
      
      const secondApproval = await pairingService.approveRequest(request.requestId, 'admin-2');
      // Second approval should return null (request not pending)
      expect(secondApproval).toBeNull();
    });

    it('should NOT allow approving denied request', async () => {
      const request = pairingService.createRequest('Device', 'mobile', []);
      
      pairingService.denyRequest(request.requestId, 'admin-1');
      
      const approval = await pairingService.approveRequest(request.requestId, 'admin-2');
      // Approval should return null (request not pending)
      expect(approval).toBeNull();
    });

    it('should NOT allow approving expired request', async () => {
      const request = pairingService.createRequest('Device', 'mobile', []);
      
      // Expire the request via cleanup
      vi.advanceTimersByTime(301000);
      pairingService.cleanupExpiredRequests();
      
      const approval = await pairingService.approveRequest(request.requestId, 'admin-1');
      // Approval should return null since request is no longer pending after cleanup
      expect(approval).toBeNull();
    });

    it('should NOT allow denying already denied request', () => {
      const request = pairingService.createRequest('Device', 'mobile', []);
      
      pairingService.denyRequest(request.requestId, 'admin-1');
      
      const secondDenial = pairingService.denyRequest(request.requestId, 'admin-2');
      // Second denial should return null (request not pending)
      expect(secondDenial).toBeNull();
    });

    it('should NOT allow denying approved request', async () => {
      const request = pairingService.createRequest('Device', 'mobile', []);
      
      await pairingService.approveRequest(request.requestId, 'admin-1');
      
      const denial = pairingService.denyRequest(request.requestId, 'admin-2');
      // Denial should return null (request not pending)
      expect(denial).toBeNull();
    });

    it('should NOT allow denying expired request', async () => {
      const request = pairingService.createRequest('Device', 'mobile', []);
      
      // Expire the request
      vi.advanceTimersByTime(301000);
      pairingService.cleanupExpiredRequests();
      
      const denial = pairingService.denyRequest(request.requestId, 'admin-1');
      // Denial should return null (request not pending)
      // The deny method doesn't check expiry, only pending status
      // After cleanup, the status is 'expired' so it's not pending
      expect(denial).toBeNull();
    });
  });

  describe('Approval generates valid token', () => {
    it('should generate a valid JWT token on approval', async () => {
      const request = pairingService.createRequest('Device', 'mobile', ['sendMessage']);
      
      const approved = await pairingService.approveRequest(request.requestId, 'admin-1');
      
      expect(approved?.token).toBeDefined();
      expect(typeof approved?.token).toBe('string');
      expect(approved?.token!.split('.').length).toBe(3); // JWT format
    });

    it('should generate token with correct scopes', async () => {
      const scopes = ['sendMessage', 'receiveMessage'];
      const request = pairingService.createRequest('Device', 'mobile', scopes);
      
      const approved = await pairingService.approveRequest(request.requestId, 'admin-1', scopes);
      
      expect(approved?.scopes).toEqual(scopes);
    });

    it('should validate the generated token', async () => {
      const request = pairingService.createRequest('Device', 'mobile', ['sendMessage']);
      
      const approved = await pairingService.approveRequest(request.requestId, 'admin-1');
      const token = approved?.token!;
      
      const payload = await pairingService.validateToken(token);
      
      expect(payload).not.toBeNull();
      expect(payload?.type).toBe('pairing');
      expect(payload?.sub).toBe(approved?.nodeId);
    });

    it('should generate unique node IDs for different requests', async () => {
      const request1 = pairingService.createRequest('Device 1', 'mobile', []);
      const request2 = pairingService.createRequest('Device 2', 'mobile', []);
      
      const approved1 = await pairingService.approveRequest(request1.requestId, 'admin-1');
      const approved2 = await pairingService.approveRequest(request2.requestId, 'admin-1');
      
      expect(approved1?.nodeId).not.toBe(approved2?.nodeId);
    });
  });
});

// ============================================================================
// Permission Tests
// ============================================================================

describe('Pairing Permission Enforcement - Issue #128', () => {
  let pairingService: PairingService;
  let pairingHandler: PairingHandler;
  let authMiddleware: AuthMiddleware;
  let nodeRegistry: NodeRegistry;
  let connectionManager: ConnectionManager;
  let mockLogger: FastifyBaseLogger;
  let mockConfig: WebSocketConfig;
  let handlerContext: HandlerContext;

  beforeEach(() => {
    mockLogger = createMockLogger();
    mockConfig = createMockConfig();
    authMiddleware = new AuthMiddleware(mockConfig);
    pairingService = new PairingService(authMiddleware, mockLogger);
    nodeRegistry = new NodeRegistry({}, mockLogger);
    
    // Create connection manager with proper mock
    connectionManager = {
      send: vi.fn().mockReturnValue(true),
      registerConnection: vi.fn(),
      removeConnection: vi.fn(),
      getConnection: vi.fn(),
      authenticate: vi.fn(),
      isAuthenticated: vi.fn().mockReturnValue(false),
      hasCapability: vi.fn((connId, cap) => {
        // Mock capability check
        const capMap: Record<string, string[]> = {
          'authorized-conn': [WS_CAPABILITIES.PAIRING_APPROVE, WS_CAPABILITIES.PAIRING_DENY],
          'approve-only': [WS_CAPABILITIES.PAIRING_APPROVE],
          'deny-only': [WS_CAPABILITIES.PAIRING_DENY],
          'unauthorized': [],
        };
        return capMap[connId]?.includes(cap) ?? false;
      }),
      getMetadata: vi.fn().mockReturnValue({}),
      updateMetadata: vi.fn(),
    } as unknown as ConnectionManager;
    
    pairingHandler = new PairingHandler(
      pairingService,
      connectionManager,
      nodeRegistry,
      mockLogger,
    );

    handlerContext = {
      connectionManager,
      services: {} as any,
      logger: mockLogger,
    };
  });

  afterEach(() => {
    pairingService.destroy();
    pairingService.clear();
  });

  describe('pairing.list permissions', () => {
    it('should allow authorized operator to list pending requests', async () => {
      // Create a pending request
      pairingService.createRequest('Test Device', 'mobile', []);

      const request = createWSMessage('pairing.list', {});
      const response = await pairingHandler.handleList('authorized-conn', request, handlerContext);

      expect(response.type).toBe('pairing.list');
      if (response.type === 'pairing.list') {
        expect(response.payload.requests).toHaveLength(1);
      }
    });

    it('should deny unauthorized operator from listing requests', async () => {
      pairingService.createRequest('Test Device', 'mobile', []);

      const request = createWSMessage('pairing.list', {});
      const response = await pairingHandler.handleList('unauthorized', request, handlerContext);

      expect(response.type).toBe('error');
      if (response.type === 'error') {
        expect(response.payload.error.code).toBe(WS_ERROR_CODES.FORBIDDEN);
      }
    });

    it('should allow operator with only APPROVE capability to list', async () => {
      pairingService.createRequest('Test Device', 'mobile', []);

      const request = createWSMessage('pairing.list', {});
      const response = await pairingHandler.handleList('approve-only', request, handlerContext);

      expect(response.type).toBe('pairing.list');
    });
  });

  describe('pairing.approve permissions', () => {
    it('should allow authorized operator to approve request', async () => {
      const pendingRequest = pairingService.createRequest('Test Device', 'mobile', []);

      const request = createWSMessage('pairing.approve', {
        requestId: pendingRequest.requestId,
      });
      const response = await pairingHandler.handleApprove('authorized-conn', request, handlerContext);

      expect(response.type).toBe('pairing.approved');
    });

    it('should allow operator with only APPROVE capability', async () => {
      const pendingRequest = pairingService.createRequest('Test Device', 'mobile', []);

      const request = createWSMessage('pairing.approve', {
        requestId: pendingRequest.requestId,
      });
      const response = await pairingHandler.handleApprove('approve-only', request, handlerContext);

      expect(response.type).toBe('pairing.approved');
    });

    it('should deny unauthorized operator from approving', async () => {
      const pendingRequest = pairingService.createRequest('Test Device', 'mobile', []);

      const request = createWSMessage('pairing.approve', {
        requestId: pendingRequest.requestId,
      });
      const response = await pairingHandler.handleApprove('unauthorized', request, handlerContext);

      expect(response.type).toBe('error');
      if (response.type === 'error') {
        expect(response.payload.error.code).toBe(WS_ERROR_CODES.FORBIDDEN);
      }
    });

    it('should deny operator with only DENY capability', async () => {
      const pendingRequest = pairingService.createRequest('Test Device', 'mobile', []);

      const request = createWSMessage('pairing.approve', {
        requestId: pendingRequest.requestId,
      });
      const response = await pairingHandler.handleApprove('deny-only', request, handlerContext);

      expect(response.type).toBe('error');
      if (response.type === 'error') {
        expect(response.payload.error.code).toBe(WS_ERROR_CODES.FORBIDDEN);
      }
    });
  });

  describe('pairing.deny permissions', () => {
    it('should allow authorized operator to deny request', async () => {
      const pendingRequest = pairingService.createRequest('Test Device', 'mobile', []);

      const request = createWSMessage('pairing.deny', {
        requestId: pendingRequest.requestId,
      });
      const response = await pairingHandler.handleDeny('authorized-conn', request, handlerContext);

      expect(response.type).toBe('pairing.denied');
    });

    it('should allow operator with only DENY capability', async () => {
      const pendingRequest = pairingService.createRequest('Test Device', 'mobile', []);

      const request = createWSMessage('pairing.deny', {
        requestId: pendingRequest.requestId,
      });
      const response = await pairingHandler.handleDeny('deny-only', request, handlerContext);

      expect(response.type).toBe('pairing.denied');
    });

    it('should deny unauthorized operator from denying', async () => {
      const pendingRequest = pairingService.createRequest('Test Device', 'mobile', []);

      const request = createWSMessage('pairing.deny', {
        requestId: pendingRequest.requestId,
      });
      const response = await pairingHandler.handleDeny('unauthorized', request, handlerContext);

      expect(response.type).toBe('error');
      if (response.type === 'error') {
        expect(response.payload.error.code).toBe(WS_ERROR_CODES.FORBIDDEN);
      }
    });

    it('should deny operator with only APPROVE capability', async () => {
      const pendingRequest = pairingService.createRequest('Test Device', 'mobile', []);

      const request = createWSMessage('pairing.deny', {
        requestId: pendingRequest.requestId,
      });
      const response = await pairingHandler.handleDeny('approve-only', request, handlerContext);

      expect(response.type).toBe('error');
      if (response.type === 'error') {
        expect(response.payload.error.code).toBe(WS_ERROR_CODES.FORBIDDEN);
      }
    });
  });

  describe('pairing.request (unauthenticated)', () => {
    it('should allow unauthenticated connection to create pairing request', async () => {
      const request = createWSMessage('pairing.request', {
        deviceName: 'My Phone',
        deviceType: 'mobile',
        capabilities: ['sendMessage'],
      });
      const response = await pairingHandler.handleRequest('unauthorized', request, handlerContext);

      expect(response.type).toBe('pairing.requested');
      if (response.type === 'pairing.requested') {
        expect(response.payload.deviceName).toBe('My Phone');
        expect(response.payload.pairingCode).toBeDefined();
        expect(response.payload.requestId).toBeDefined();
      }
    });
  });
});

// ============================================================================
// Expiry Tests
// ============================================================================

describe('Pairing Request Expiry - Issue #128', () => {
  let pairingService: PairingService;
  let authMiddleware: AuthMiddleware;
  let mockLogger: FastifyBaseLogger;
  let mockConfig: WebSocketConfig;

  beforeEach(() => {
    vi.useFakeTimers();
    mockLogger = createMockLogger();
    mockConfig = createMockConfig();
    authMiddleware = new AuthMiddleware(mockConfig);
    pairingService = new PairingService(authMiddleware, mockLogger, {
      requestExpiry: 300000, // 5 minutes
    });
  });

  afterEach(() => {
    pairingService.destroy();
    pairingService.clear();
    vi.useRealTimers();
  });

  it('should set correct expiry time', () => {
    const now = Date.now();
    const request = pairingService.createRequest('Device', 'mobile', []);
    
    expect(request.expiresAt).toBe(now + 300000);
  });

  it('should NOT approve expired request', async () => {
    const request = pairingService.createRequest('Device', 'mobile', []);
    
    // Advance time past expiry
    vi.advanceTimersByTime(301000);
    pairingService.cleanupExpiredRequests();
    
    const approved = await pairingService.approveRequest(request.requestId, 'admin-1');
    
    // After cleanup, request status is 'expired' (not pending), so approveRequest returns null
    expect(approved).toBeNull();
  });

  it('should NOT deny expired request', () => {
    const request = pairingService.createRequest('Device', 'mobile', []);
    
    // Advance time past expiry
    vi.advanceTimersByTime(301000);
    pairingService.cleanupExpiredRequests();
    
    const denied = pairingService.denyRequest(request.requestId, 'admin-1');
    
    // After cleanup, request status is 'expired' (not pending), denyRequest returns null
    expect(denied).toBeNull();
  });

  it('should remove pairing code index when expired', () => {
    const request = pairingService.createRequest('Device', 'mobile', []);
    
    // Verify code is indexed
    expect(pairingService.getRequestByCode(request.pairingCode)).toBeDefined();
    
    // Expire
    vi.advanceTimersByTime(301000);
    pairingService.cleanupExpiredRequests();
    
    // Code should no longer be indexed
    expect(pairingService.getRequestByCode(request.pairingCode)).toBeUndefined();
  });
});

// ============================================================================
// Duplicate Request Tests
// ============================================================================

describe('Duplicate Pairing Requests - Issue #128', () => {
  let pairingService: PairingService;
  let authMiddleware: AuthMiddleware;
  let mockLogger: FastifyBaseLogger;
  let mockConfig: WebSocketConfig;

  beforeEach(() => {
    mockLogger = createMockLogger();
    mockConfig = createMockConfig();
    authMiddleware = new AuthMiddleware(mockConfig);
    pairingService = new PairingService(authMiddleware, mockLogger);
  });

  afterEach(() => {
    pairingService.destroy();
    pairingService.clear();
  });

  it('should allow multiple pairing requests from same device name', () => {
    const request1 = pairingService.createRequest('My Phone', 'mobile', []);
    const request2 = pairingService.createRequest('My Phone', 'mobile', []);

    expect(request1.requestId).not.toBe(request2.requestId);
    expect(request1.pairingCode).not.toBe(request2.pairingCode);
  });

  it('should generate unique pairing codes', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const request = pairingService.createRequest('Device', 'mobile', []);
      codes.add(request.pairingCode);
    }
    expect(codes.size).toBe(100);
  });

  it('should allow approving one request while another is pending', async () => {
    const request1 = pairingService.createRequest('Device 1', 'mobile', []);
    const request2 = pairingService.createRequest('Device 2', 'mobile', []);

    const approved1 = await pairingService.approveRequest(request1.requestId, 'admin-1');
    
    expect(approved1?.status).toBe('approved');
    expect(pairingService.getRequest(request2.requestId)?.status).toBe('pending');
  });
});

// ============================================================================
// Token Validation Tests
// ============================================================================

describe('Pairing Token Validation - Issue #128', () => {
  let pairingService: PairingService;
  let authMiddleware: AuthMiddleware;
  let mockLogger: FastifyBaseLogger;
  let mockConfig: WebSocketConfig;

  beforeEach(() => {
    mockLogger = createMockLogger();
    mockConfig = createMockConfig();
    authMiddleware = new AuthMiddleware(mockConfig);
    pairingService = new PairingService(authMiddleware, mockLogger);
  });

  afterEach(() => {
    pairingService.destroy();
    pairingService.clear();
  });

  it('should validate approved token', async () => {
    const request = pairingService.createRequest('Device', 'mobile', ['sendMessage']);
    const approved = await pairingService.approveRequest(request.requestId, 'admin-1', ['sendMessage']);
    
    const payload = await pairingService.validateToken(approved!.token!);
    
    expect(payload).not.toBeNull();
    expect(payload?.type).toBe('pairing');
    expect(payload?.scopes).toContain('sendMessage');
  });

  it('should reject unknown token', async () => {
    const payload = await pairingService.validateToken('invalid-token');
    expect(payload).toBeNull();
  });

  it('should reject revoked token', async () => {
    const request = pairingService.createRequest('Device', 'mobile', []);
    const approved = await pairingService.approveRequest(request.requestId, 'admin-1');
    const token = approved!.token!;
    
    // Revoke the token
    pairingService.revokeToken(token);
    
    // Should no longer validate
    const payload = await pairingService.validateToken(token);
    expect(payload).toBeNull();
  });

  it('should return request by token', async () => {
    const request = pairingService.createRequest('Device', 'mobile', []);
    const approved = await pairingService.approveRequest(request.requestId, 'admin-1');
    
    const found = pairingService.getRequestByToken(approved!.token!);
    
    expect(found).not.toBeNull();
    expect(found?.requestId).toBe(request.requestId);
  });
});
