/**
 * Devices Approve Command Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createDevicesApproveHandler } from './approve.js';
import type { PairingContext, PairingRequestData } from '@openaidy/control-plane';

describe('Devices Approve Command', () => {
  const createRequest = (overrides?: Partial<PairingRequestData>): PairingRequestData => ({
    requestId: 'req-1',
    pairingCode: '123456',
    deviceName: 'Test Device',
    deviceType: 'android',
    capabilities: ['chat', 'files'],
    status: 'pending',
    requestedAt: Date.now() - 60000,
    expiresAt: Date.now() + 300000,
    ...overrides,
  });

  let mockRequests: Map<string, PairingRequestData>;
  let mockContext: PairingContext;

  beforeEach(() => {
    mockRequests = new Map();
    mockRequests.set('req-1', createRequest({ requestId: 'req-1', status: 'pending' }));
    mockRequests.set('req-2', createRequest({ requestId: 'req-2', status: 'approved' }));
    mockRequests.set('req-3', createRequest({ requestId: 'req-3', status: 'expired', expiresAt: Date.now() - 1000 }));

    mockContext = {
      pairingService: {
        getPendingRequests: () => Array.from(mockRequests.values()).filter(r => r.status === 'pending'),
        getAllRequests: () => Array.from(mockRequests.values()),
        getRequest: (id) => mockRequests.get(id),
        approveRequest: async (id, by, scopes) => {
          const req = mockRequests.get(id);
          if (!req || req.status !== 'pending') return null;
          req.status = 'approved';
          req.approvedAt = Date.now();
          req.approvedBy = by;
          req.scopes = scopes || req.capabilities;
          return req;
        },
        denyRequest: () => null,
      },
      actor: 'cli-test',
    };
  });

  describe('with no context', () => {
    const handler = createDevicesApproveHandler();

    it('returns error when no context available', async () => {
      const result = await handler(['req-1']);
      expect(result.exitCode).toBe(1);
      expect(result.error).toContain('No pairing service');
    });

    it('shows help with --help flag', async () => {
      const result = await handler(['--help']);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('Usage:');
      expect(result.output).toContain('devices approve');
    });

    it('shows help with -h flag', async () => {
      const result = await handler(['-h']);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('Usage:');
    });
  });

  describe('with mock context', () => {
    const getContext = () => mockContext;
    const handler = createDevicesApproveHandler(getContext);

    it('returns error when missing request-id', async () => {
      const result = await handler([]);
      expect(result.exitCode).toBe(1);
      expect(result.error).toContain('Missing required argument');
    });

    it('approves pending request', async () => {
      const result = await handler(['req-1']);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('APPROVED');
      expect(result.output).toContain('req-1');
      expect(result.output).toContain('Test Device');
    });

    it('returns error for non-existent request', async () => {
      const result = await handler(['nonexistent']);
      expect(result.exitCode).toBe(1);
      expect(result.error).toContain('not found');
    });

    it('returns error for already approved request', async () => {
      const result = await handler(['req-2']);
      expect(result.exitCode).toBe(1);
      expect(result.error).toMatch(/already|processed/i);
    });

    it('returns error for expired request', async () => {
      const result = await handler(['req-3']);
      expect(result.exitCode).toBe(1);
      expect(result.error).toMatch(/expired|not found/i);
    });

    it('accepts --scopes option', async () => {
      const result = await handler(['req-1', '--scopes', 'chat,files']);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('APPROVED');
    });
  });

  describe('error handling', () => {
    it('handles workflow errors gracefully', async () => {
      const errorContext: PairingContext = {
        pairingService: {
          getPendingRequests: () => [],
          getAllRequests: () => [],
          getRequest: () => undefined,
          approveRequest: async () => {
            throw new Error('Service unavailable');
          },
          denyRequest: () => null,
        },
        actor: 'cli-test',
      };

      const handler = createDevicesApproveHandler(() => errorContext);
      const result = await handler(['req-1']);

      expect(result.exitCode).toBe(1);
      expect(result.error).toContain('Error:');
    });
  });
});
