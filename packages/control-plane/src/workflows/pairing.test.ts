/**
 * Control Plane - Pairing Workflow Tests
 * 
 * Tests for the pairing workflow service.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  PairingWorkflow,
  createPairingWorkflow,
  type PairingContext,
} from './pairing.js';
import type { PairingRequestData } from '../types.js';

describe('PairingWorkflow', () => {
  let workflow: PairingWorkflow;
  let mockContext: PairingContext;
  let mockRequests: Map<string, PairingRequestData>;

  const createMockRequest = (
    id: string,
    status: PairingRequestData['status'] = 'pending',
  ): PairingRequestData => ({
    requestId: id,
    pairingCode: '123456',
    deviceName: `Device ${id}`,
    deviceType: 'mobile',
    capabilities: ['chat', 'notifications'],
    status,
    requestedAt: Date.now() - 60000,
    expiresAt: Date.now() + 300000,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    
    mockRequests = new Map();
    
    // Add some test requests
    mockRequests.set('req-1', createMockRequest('req-1', 'pending'));
    mockRequests.set('req-2', createMockRequest('req-2', 'pending'));
    mockRequests.set('req-3', createMockRequest('req-3', 'approved'));
    mockRequests.set('req-4', createMockRequest('req-4', 'denied'));
    mockRequests.set('req-5', createMockRequest('req-5', 'expired'));

    mockContext = {
      pairingService: {
        getPendingRequests: () => Array.from(mockRequests.values()).filter(r => r.status === 'pending'),
        getAllRequests: () => Array.from(mockRequests.values()),
        getRequest: (id: string) => mockRequests.get(id),
        approveRequest: vi.fn(),
        denyRequest: vi.fn(),
      },
      actor: 'admin-cli',
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      } as any,
    };
    
    workflow = createPairingWorkflow(mockContext);
  });

  describe('listRequests()', () => {
    it('lists all requests without filter', () => {
      const result = workflow.listRequests();
      
      expect(result.success).toBe(true);
      expect(result.data?.count).toBe(5);
      expect(result.data?.requests).toHaveLength(5);
    });

    it('lists pending requests when status is pending', () => {
      const result = workflow.listRequests({ status: 'pending' });
      
      expect(result.success).toBe(true);
      expect(result.data?.count).toBe(2);
      expect(result.data?.requests.every(r => r.status === 'pending')).toBe(true);
    });

    it('lists approved requests when status is approved', () => {
      const result = workflow.listRequests({ status: 'approved' });
      
      expect(result.success).toBe(true);
      expect(result.data?.count).toBe(1);
      expect(result.data?.requests[0].requestId).toBe('req-3');
    });

    it('returns empty array when no requests match status', () => {
      // Clear all requests
      mockRequests.clear();
      
      const result = workflow.listRequests({ status: 'pending' });
      
      expect(result.success).toBe(true);
      expect(result.data?.count).toBe(0);
      expect(result.data?.requests).toEqual([]);
    });
  });

  describe('getRequest()', () => {
    it('returns request when found', () => {
      const result = workflow.getRequest('req-1');
      
      expect(result.success).toBe(true);
      expect(result.data?.requestId).toBe('req-1');
    });

    it('returns failure when request not found', () => {
      const result = workflow.getRequest('nonexistent');
      
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PAIRING_REQUEST_NOT_FOUND');
      expect(result.error?.message).toContain('nonexistent');
    });
  });

  describe('approveRequest()', () => {
    it('approves a pending request', async () => {
      const approvedRequest: PairingRequestData = {
        ...createMockRequest('req-1', 'approved'),
        approvedAt: Date.now(),
        approvedBy: 'admin-cli',
        nodeId: 'node-1',
        token: 'test-token',
        scopes: ['chat', 'notifications'],
      };
      
      vi.mocked(mockContext.pairingService.approveRequest).mockResolvedValue(approvedRequest);
      
      const result = await workflow.approveRequest('req-1');
      
      expect(result.success).toBe(true);
      expect(result.data?.status).toBe('approved');
      expect(result.data?.approvedBy).toBe('admin-cli');
      expect(mockContext.pairingService.approveRequest).toHaveBeenCalledWith(
        'req-1',
        'admin-cli',
        undefined,
      );
    });

    it('approves with custom scopes', async () => {
      const approvedRequest: PairingRequestData = {
        ...createMockRequest('req-1', 'approved'),
        approvedAt: Date.now(),
        approvedBy: 'admin-cli',
        scopes: ['admin'],
      };
      
      vi.mocked(mockContext.pairingService.approveRequest).mockResolvedValue(approvedRequest);
      
      const result = await workflow.approveRequest('req-1', ['admin']);
      
      expect(result.success).toBe(true);
      expect(mockContext.pairingService.approveRequest).toHaveBeenCalledWith(
        'req-1',
        'admin-cli',
        ['admin'],
      );
    });

    it('returns failure when request not found', async () => {
      vi.mocked(mockContext.pairingService.approveRequest).mockResolvedValue(null);
      
      const result = await workflow.approveRequest('nonexistent');
      
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PAIRING_REQUEST_NOT_FOUND');
    });

    it('returns failure when request already processed', async () => {
      vi.mocked(mockContext.pairingService.approveRequest).mockResolvedValue(null);
      
      const result = await workflow.approveRequest('req-3'); // already approved
      
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PAIRING_REQUEST_ALREADY_PROCESSED');
    });

    it('returns failure when request expired', async () => {
      vi.mocked(mockContext.pairingService.approveRequest).mockResolvedValue(null);
      
      const result = await workflow.approveRequest('req-5'); // expired
      
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PAIRING_REQUEST_EXPIRED');
    });
  });

  describe('denyRequest()', () => {
    it('denies a pending request', () => {
      const deniedRequest: PairingRequestData = {
        ...createMockRequest('req-1', 'denied'),
        deniedAt: Date.now(),
        deniedBy: 'admin-cli',
      };
      
      vi.mocked(mockContext.pairingService.denyRequest).mockReturnValue(deniedRequest);
      
      const result = workflow.denyRequest('req-1');
      
      expect(result.success).toBe(true);
      expect(result.data?.status).toBe('denied');
      expect(result.data?.deniedBy).toBe('admin-cli');
      expect(mockContext.pairingService.denyRequest).toHaveBeenCalledWith(
        'req-1',
        'admin-cli',
      );
    });

    it('returns failure when request not found', () => {
      vi.mocked(mockContext.pairingService.denyRequest).mockReturnValue(null);
      
      const result = workflow.denyRequest('nonexistent');
      
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PAIRING_REQUEST_NOT_FOUND');
    });

    it('returns failure when request already processed', () => {
      vi.mocked(mockContext.pairingService.denyRequest).mockReturnValue(null);
      
      const result = workflow.denyRequest('req-3'); // already approved
      
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PAIRING_REQUEST_ALREADY_PROCESSED');
    });
  });
});
