import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import {
  PairingService,
  PairingCodeGenerator,
  createPairingService,
  type PairingRequest,
  type PairingServiceOptions,
} from './pairing-service';
import { AuthMiddleware } from './middleware/auth';
import type { DevicesStore, PairingRequestsStore } from '@openaidy/db';
import type { WebSocketConfig } from './types';

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
    secret: 'test-secret-key-for-pairing-service-tests',
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

const createMockPersistence = () => {
  const pairingRequestsStore: PairingRequestsStore = {
    create: vi.fn(),
    findById: vi.fn(),
    findByCode: vi.fn(),
    findByToken: vi.fn(),
    listAll: vi.fn().mockResolvedValue([]),
    listPending: vi.fn().mockResolvedValue([]),
    update: vi.fn(),
  };

  const devicesStore: DevicesStore = {
    upsert: vi.fn(),
    findByNodeId: vi.fn(),
    findByToken: vi.fn(),
    listAll: vi.fn().mockResolvedValue([]),
    update: vi.fn(),
  };

  return {
    pairingRequestsStore,
    devicesStore,
  };
};

// ============================================================================
// PairingCodeGenerator Tests
// ============================================================================

describe('PairingCodeGenerator', () => {
  it('should generate a code with default length', () => {
    const generator = new PairingCodeGenerator();
    const code = generator.generate();
    
    expect(code).toHaveLength(6);
    expect(/^\d{6}$/.test(code)).toBe(true);
  });

  it('should generate a code with custom length', () => {
    const generator = new PairingCodeGenerator(8);
    const code = generator.generate();
    
    expect(code).toHaveLength(8);
    expect(/^\d{8}$/.test(code)).toBe(true);
  });

  it('should generate different codes', () => {
    const generator = new PairingCodeGenerator();
    const codes = new Set<string>();
    
    for (let i = 0; i < 100; i++) {
      codes.add(generator.generate());
    }
    
    // At least 95% should be unique (very high probability)
    expect(codes.size).toBeGreaterThan(95);
  });

  it('should validate correct code format', () => {
    const generator = new PairingCodeGenerator(6);
    
    expect(generator.validate('123456')).toBe(true);
    expect(generator.validate('000000')).toBe(true);
    expect(generator.validate('999999')).toBe(true);
  });

  it('should reject invalid code format', () => {
    const generator = new PairingCodeGenerator(6);
    
    expect(generator.validate('12345')).toBe(false);
    expect(generator.validate('1234567')).toBe(false);
    expect(generator.validate('abcdef')).toBe(false);
    expect(generator.validate('12a456')).toBe(false);
    expect(generator.validate('')).toBe(false);
  });
});

// ============================================================================
// PairingService Tests
// ============================================================================

describe('PairingService', () => {
  let service: PairingService;
  let authMiddleware: AuthMiddleware;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let mockConfig: WebSocketConfig;
  let mockPersistence: ReturnType<typeof createMockPersistence>;

  beforeEach(() => {
    mockLogger = createMockLogger();
    mockConfig = createMockConfig();
    authMiddleware = new AuthMiddleware(mockConfig);
    mockPersistence = createMockPersistence();
    
    // Use short cleanup interval for testing
    const options: PairingServiceOptions = {
      requestExpiry: 1000, // 1 second for testing
      cleanupInterval: 100, // 100ms for testing
    };
    
    service = new PairingService(authMiddleware, mockLogger, options);
  });

  afterEach(() => {
    service.destroy();
    service.clear();
  });

  // ============================================================================
  // Create Request Tests
  // ============================================================================

  describe('createRequest', () => {
    it('should create a pairing request', () => {
      const request = service.createRequest(
        'Test Device',
        'mobile',
        ['camera', 'microphone'],
      );

      expect(request.requestId).toBeDefined();
      expect(request.pairingCode).toBeDefined();
      expect(request.pairingCode).toHaveLength(6);
      expect(request.deviceName).toBe('Test Device');
      expect(request.deviceType).toBe('mobile');
      expect(request.capabilities).toEqual(['camera', 'microphone']);
      expect(request.status).toBe('pending');
      expect(request.requestedAt).toBeDefined();
      expect(request.expiresAt).toBeGreaterThan(request.requestedAt);
    });

    it('should create a request with metadata', () => {
      const metadata = { version: '1.0', platform: 'ios' };
      const request = service.createRequest(
        'Test Device',
        'mobile',
        ['camera'],
        metadata,
      );

      expect(request.metadata).toEqual(metadata);
    });

    it('should generate unique pairing codes', () => {
      const requests: PairingRequest[] = [];
      
      for (let i = 0; i < 10; i++) {
        requests.push(service.createRequest(`Device ${i}`, 'mobile', []));
      }

      const codes = requests.map(r => r.pairingCode);
      const uniqueCodes = new Set(codes);
      
      expect(uniqueCodes.size).toBe(10);
    });

    it('should log request creation', () => {
      service.createRequest('Test Device', 'mobile', ['camera']);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          deviceName: 'Test Device',
          deviceType: 'mobile',
        }),
        'Pairing request created',
      );
    });

    it('should persist new requests when a durable store is configured', async () => {
      const persistentService = new PairingService(authMiddleware, mockLogger, {
        persistence: {
          pairingRequests: mockPersistence.pairingRequestsStore,
          devices: mockPersistence.devicesStore,
        },
      });

      const request = persistentService.createRequest('Persisted Device', 'mobile', ['camera']);
      await persistentService.awaitPendingWrites();

      expect(mockPersistence.pairingRequestsStore.create).toHaveBeenCalledWith(
        expect.objectContaining({
          id: request.requestId,
          deviceName: 'Persisted Device',
          requestedCapabilities: ['camera'],
        }),
      );

      persistentService.destroy();
      persistentService.clear();
    });
  });

  // ============================================================================
  // Approve Request Tests
  // ============================================================================

  describe('approveRequest', () => {
    it('should approve a pending request', async () => {
      const request = service.createRequest(
        'Test Device',
        'mobile',
        ['camera'],
      );

      const approved = await service.approveRequest(
        request.requestId,
        'admin-1',
      );

      expect(approved).toBeDefined();
      expect(approved!.status).toBe('approved');
      expect(approved!.approvedAt).toBeDefined();
      expect(approved!.approvedBy).toBe('admin-1');
      expect(approved!.nodeId).toBeDefined();
      expect(approved!.token).toBeDefined();
      expect(approved!.scopes).toEqual(['camera']);
    });

    it('should approve with custom scopes', async () => {
      const request = service.createRequest(
        'Test Device',
        'mobile',
        ['camera', 'microphone'],
      );

      const approved = await service.approveRequest(
        request.requestId,
        'admin-1',
        ['camera'], // Only grant camera
      );

      expect(approved!.scopes).toEqual(['camera']);
    });

    it('should return null for non-existent request', async () => {
      const result = await service.approveRequest('non-existent', 'admin-1');
      
      expect(result).toBeNull();
    });

    it('should return null for non-pending request', async () => {
      const request = service.createRequest('Test Device', 'mobile', []);
      await service.approveRequest(request.requestId, 'admin-1');

      const result = await service.approveRequest(request.requestId, 'admin-2');
      
      expect(result).toBeNull();
    });

    it('should return expired for expired request', async () => {
      // Create service with very short expiry
      const shortExpiryService = new PairingService(
        authMiddleware,
        mockLogger,
        { requestExpiry: 1 }, // 1ms
      );

      const request = shortExpiryService.createRequest('Test Device', 'mobile', []);
      
      // Wait for expiry
      await new Promise(resolve => setTimeout(resolve, 10));

      const result = await shortExpiryService.approveRequest(request.requestId, 'admin-1');
      
      expect(result!.status).toBe('expired');

      shortExpiryService.destroy();
      shortExpiryService.clear();
    });

    it('should log approval', async () => {
      const request = service.createRequest('Test Device', 'mobile', ['camera']);
      await service.approveRequest(request.requestId, 'admin-1');

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: request.requestId,
          approvedBy: 'admin-1',
        }),
        'Pairing request approved',
      );
    });

    it('should persist approved devices and granted scopes', async () => {
      const persistentService = new PairingService(authMiddleware, mockLogger, {
        persistence: {
          pairingRequests: mockPersistence.pairingRequestsStore,
          devices: mockPersistence.devicesStore,
        },
      });

      const request = persistentService.createRequest('Approved Device', 'mobile', ['camera', 'microphone']);
      const approved = await persistentService.approveRequest(request.requestId, 'admin-1', ['camera']);
      await persistentService.awaitPendingWrites();

      expect(mockPersistence.pairingRequestsStore.update).toHaveBeenCalledWith(
        request.requestId,
        expect.objectContaining({
          status: 'approved',
          grantedScopes: ['camera'],
          nodeId: approved?.nodeId,
        }),
      );
      expect(mockPersistence.devicesStore.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          nodeId: approved?.nodeId,
          scopes: ['camera'],
          token: approved?.token,
        }),
      );

      persistentService.destroy();
      persistentService.clear();
    });
  });

  // ============================================================================
  // Deny Request Tests
  // ============================================================================

  describe('denyRequest', () => {
    it('should deny a pending request', () => {
      const request = service.createRequest('Test Device', 'mobile', []);

      const denied = service.denyRequest(request.requestId, 'admin-1');

      expect(denied).toBeDefined();
      expect(denied!.status).toBe('denied');
      expect(denied!.deniedAt).toBeDefined();
      expect(denied!.deniedBy).toBe('admin-1');
    });

    it('should return null for non-existent request', () => {
      const result = service.denyRequest('non-existent', 'admin-1');
      
      expect(result).toBeNull();
    });

    it('should return null for non-pending request', () => {
      const request = service.createRequest('Test Device', 'mobile', []);
      service.denyRequest(request.requestId, 'admin-1');

      const result = service.denyRequest(request.requestId, 'admin-2');
      
      expect(result).toBeNull();
    });

    it('should log denial', () => {
      const request = service.createRequest('Test Device', 'mobile', []);
      service.denyRequest(request.requestId, 'admin-1');

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: request.requestId,
          deniedBy: 'admin-1',
        }),
        'Pairing request denied',
      );
    });
  });

  // ============================================================================
  // Request Lookup Tests
  // ============================================================================

  describe('getRequest', () => {
    it('should get a request by ID', () => {
      const created = service.createRequest('Test Device', 'mobile', []);
      const retrieved = service.getRequest(created.requestId);

      expect(retrieved).toEqual(created);
    });

    it('should return undefined for non-existent ID', () => {
      const result = service.getRequest('non-existent');
      
      expect(result).toBeUndefined();
    });
  });

  describe('getRequestByCode', () => {
    it('should get a request by pairing code', () => {
      const created = service.createRequest('Test Device', 'mobile', []);
      const retrieved = service.getRequestByCode(created.pairingCode);

      expect(retrieved).toEqual(created);
    });

    it('should return undefined for non-existent code', () => {
      const result = service.getRequestByCode('000000');
      
      expect(result).toBeUndefined();
    });
  });

  describe('getPendingRequests', () => {
    it('should return only pending requests', async () => {
      const req1 = service.createRequest('Device 1', 'mobile', []);
      const req2 = service.createRequest('Device 2', 'mobile', []);
      const req3 = service.createRequest('Device 3', 'mobile', []);

      await service.approveRequest(req2.requestId, 'admin-1');
      service.denyRequest(req3.requestId, 'admin-1');

      const pending = service.getPendingRequests();

      expect(pending).toHaveLength(1);
      expect(pending[0].requestId).toBe(req1.requestId);
    });

    it('should return empty array when no pending requests', () => {
      const pending = service.getPendingRequests();
      
      expect(pending).toHaveLength(0);
    });
  });

  describe('getAllRequests', () => {
    it('should return all requests', async () => {
      service.createRequest('Device 1', 'mobile', []);
      service.createRequest('Device 2', 'mobile', []);

      const all = service.getAllRequests();

      expect(all).toHaveLength(2);
    });
  });

  // ============================================================================
  // Token Management Tests
  // ============================================================================

  describe('validateToken', () => {
    it('should validate an approved token', async () => {
      const request = service.createRequest('Test Device', 'mobile', ['camera']);
      const approved = await service.approveRequest(request.requestId, 'admin-1');

      const payload = await service.validateToken(approved!.token!);

      expect(payload).toBeDefined();
      expect(payload!.sub).toBe(approved!.nodeId);
      expect(payload!.type).toBe('pairing');
      expect(payload!.scopes).toContain('camera');
    });

    it('should return null for invalid token', async () => {
      const payload = await service.validateToken('invalid-token');
      
      expect(payload).toBeNull();
    });

    it('should return null for revoked token', async () => {
      const request = service.createRequest('Test Device', 'mobile', ['camera']);
      const approved = await service.approveRequest(request.requestId, 'admin-1');

      service.revokeToken(approved!.token!);
      
      const payload = await service.validateToken(approved!.token!);
      
      expect(payload).toBeNull();
    });
  });

  describe('revokeToken', () => {
    it('should revoke a token', async () => {
      const request = service.createRequest('Test Device', 'mobile', []);
      const approved = await service.approveRequest(request.requestId, 'admin-1');

      const result = service.revokeToken(approved!.token!);

      expect(result).toBe(true);
      expect(approved!.token).toBeUndefined();
      expect(approved!.status).toBe('expired');
    });

    it('should return false for non-existent token', () => {
      const result = service.revokeToken('non-existent-token');
      
      expect(result).toBe(false);
    });

    it('should log token revocation', async () => {
      const request = service.createRequest('Test Device', 'mobile', []);
      const approved = await service.approveRequest(request.requestId, 'admin-1');

      service.revokeToken(approved!.token!);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: request.requestId,
        }),
        'Pairing token revoked',
      );
    });
  });

  describe('getRequestByToken', () => {
    it('should get request by token', async () => {
      const request = service.createRequest('Test Device', 'mobile', []);
      const approved = await service.approveRequest(request.requestId, 'admin-1');

      const retrieved = service.getRequestByToken(approved!.token!);

      expect(retrieved).toBeDefined();
      expect(retrieved!.requestId).toBe(request.requestId);
    });

    it('should return undefined for non-existent token', () => {
      const result = service.getRequestByToken('non-existent');
      
      expect(result).toBeUndefined();
    });

    it('should reload approved requests and tokens from persistence', async () => {
      const requestedAt = new Date();
      const expiresAt = new Date(requestedAt.getTime() + 60_000);
      const approvedAt = new Date(requestedAt.getTime() + 1_000);

      mockPersistence.pairingRequestsStore.listAll = vi.fn().mockResolvedValue([
        {
          id: 'persisted-request',
          pairingCode: '123456',
          deviceName: 'Persisted Phone',
          deviceType: 'mobile',
          requestedCapabilities: ['camera', 'microphone'],
          grantedScopes: ['camera'],
          metadata: { platform: 'ios' },
          status: 'approved',
          requestedAt,
          expiresAt,
          approvedAt,
          approvedBy: 'admin-1',
          deniedAt: null,
          deniedBy: null,
          nodeId: 'node-persisted',
          token: 'persisted-token',
        },
      ]);
      mockPersistence.devicesStore.listAll = vi.fn().mockResolvedValue([
        {
          nodeId: 'node-persisted',
          pairingRequestId: 'persisted-request',
          deviceName: 'Persisted Phone',
          deviceType: 'mobile',
          capabilities: ['camera', 'microphone'],
          scopes: ['camera'],
          metadata: { platform: 'ios' },
          token: 'persisted-token',
          tokenHash: 'persisted-token',
          status: 'approved',
          lastSeen: approvedAt,
          createdAt: requestedAt,
          updatedAt: approvedAt,
        },
      ]);

      const persistentService = new PairingService(authMiddleware, mockLogger, {
        persistence: {
          pairingRequests: mockPersistence.pairingRequestsStore,
          devices: mockPersistence.devicesStore,
        },
      });

      await persistentService.loadPersistedState();

      const reloaded = persistentService.getRequest('persisted-request');
      expect(reloaded).toBeDefined();
      expect(reloaded?.nodeId).toBe('node-persisted');
      expect(reloaded?.scopes).toEqual(['camera']);
      expect(persistentService.getRequestByToken('persisted-token')?.requestId).toBe('persisted-request');

      persistentService.destroy();
      persistentService.clear();
    });
  });

  // ============================================================================
  // Cleanup Tests
  // ============================================================================

  describe('cleanupExpiredRequests', () => {
    it('should mark expired requests', async () => {
      // Create service with short expiry
      const shortExpiryService = new PairingService(
        authMiddleware,
        mockLogger,
        { requestExpiry: 10, cleanupInterval: 10000 }, // 10ms expiry
      );

      const request = shortExpiryService.createRequest('Test Device', 'mobile', []);
      
      // Wait for expiry
      await new Promise(resolve => setTimeout(resolve, 50));

      const cleaned = shortExpiryService.cleanupExpiredRequests();

      expect(cleaned).toBe(1);
      expect(request.status).toBe('expired');

      shortExpiryService.destroy();
      shortExpiryService.clear();
    });

    it('should remove code from index when expired', async () => {
      const shortExpiryService = new PairingService(
        authMiddleware,
        mockLogger,
        { requestExpiry: 10, cleanupInterval: 10000 },
      );

      const request = shortExpiryService.createRequest('Test Device', 'mobile', []);
      
      await new Promise(resolve => setTimeout(resolve, 50));

      shortExpiryService.cleanupExpiredRequests();

      const found = shortExpiryService.getRequestByCode(request.pairingCode);
      expect(found).toBeUndefined();

      shortExpiryService.destroy();
      shortExpiryService.clear();
    });

    it('should not clean up non-expired requests', () => {
      service.createRequest('Test Device', 'mobile', []);

      const cleaned = service.cleanupExpiredRequests();

      expect(cleaned).toBe(0);
    });
  });

  // ============================================================================
  // Clear Tests
  // ============================================================================

  describe('clear', () => {
    it('should clear all requests', () => {
      service.createRequest('Device 1', 'mobile', []);
      service.createRequest('Device 2', 'mobile', []);

      service.clear();

      expect(service.size).toBe(0);
    });

    it('should clear code index', () => {
      const request = service.createRequest('Test Device', 'mobile', []);

      service.clear();

      const found = service.getRequestByCode(request.pairingCode);
      expect(found).toBeUndefined();
    });

    it('should log clear operation', () => {
      service.clear();

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Pairing service cleared',
      );
    });
  });

  // ============================================================================
  // Size Tests
  // ============================================================================

  describe('size', () => {
    it('should return correct size', () => {
      expect(service.size).toBe(0);

      service.createRequest('Device 1', 'mobile', []);
      expect(service.size).toBe(1);

      service.createRequest('Device 2', 'mobile', []);
      expect(service.size).toBe(2);
    });
  });

  // ============================================================================
  // Factory Function Tests
  // ============================================================================

  describe('createPairingService', () => {
    it('should create PairingService instance', () => {
      const newService = createPairingService(authMiddleware, mockLogger);
      
      expect(newService).toBeInstanceOf(PairingService);

      newService.destroy();
      newService.clear();
    });
  });
});
