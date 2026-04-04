/**
 * Devices List Command Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createDevicesListHandler } from './list.js';
import type { PairingContext, PairingRequestData } from '@openaidy/control-plane';

describe('Devices List Command', () => {
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

  let mockRequests: PairingRequestData[];
  let mockContext: PairingContext;

  beforeEach(() => {
    mockRequests = [
      createRequest({ requestId: 'req-1', status: 'pending', deviceName: 'Android Phone' }),
      createRequest({ requestId: 'req-2', status: 'pending', deviceName: 'iPhone' }),
      createRequest({ requestId: 'req-3', status: 'approved', deviceName: 'Desktop' }),
      createRequest({ requestId: 'req-4', status: 'denied', deviceName: 'Unknown Device' }),
    ];

    mockContext = {
      pairingService: {
        getPendingRequests: () => mockRequests.filter(r => r.status === 'pending'),
        getAllRequests: () => mockRequests,
        getRequest: (id) => mockRequests.find(r => r.requestId === id),
        approveRequest: async () => null,
        denyRequest: () => null,
      },
      actor: 'cli-test',
    };
  });

  describe('with no context', () => {
    const handler = createDevicesListHandler();

    it('returns empty state when no context available', async () => {
      const result = await handler([]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('No pending');
    });

    it('shows help with --help flag', async () => {
      const result = await handler(['--help']);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('Usage:');
      expect(result.output).toContain('devices list');
    });

    it('shows help with -h flag', async () => {
      const result = await handler(['-h']);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('Usage:');
    });
  });

  describe('with mock context', () => {
    const getContext = () => mockContext;
    const handler = createDevicesListHandler(getContext);

    it('lists pending requests by default', async () => {
      const result = await handler([]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('req-1');
      expect(result.output).toContain('req-2');
      expect(result.output).not.toContain('req-3'); // approved
    });

    it('filters by status with --status flag', async () => {
      const result = await handler(['--status', 'approved']);
      expect(result.exitCode).toBe(0);
      expect(result.output).not.toContain('req-1'); // pending
      expect(result.output).toContain('req-3'); // approved
      expect(result.output).toContain('Approved');
    });

    it('shows all requests with --status all', async () => {
      const result = await handler(['--status', 'all']);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('req-1');
      expect(result.output).toContain('req-3');
      expect(result.output).toContain('req-4');
      expect(result.output).toContain('All Device Pairing');
    });

    it('applies --limit flag', async () => {
      const result = await handler(['--limit', '1']);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('req-1');
      expect(result.output).not.toContain('req-2');
    });

    it('shows empty state when no pending requests', async () => {
      mockRequests = mockRequests.filter(r => r.status !== 'pending');
      const result = await handler([]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('No pending');
    });

    it('shows empty state when filtering for status with no matches', async () => {
      mockRequests = mockRequests.filter(r => r.status !== 'expired');
      const result = await handler(['--status', 'expired']);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('No expired');
    });
  });

  describe('error handling', () => {
    it('handles workflow errors gracefully', async () => {
      const errorContext: PairingContext = {
        pairingService: {
          getPendingRequests: () => {
            throw new Error('Service unavailable');
          },
          getAllRequests: () => {
            throw new Error('Service unavailable');
          },
          getRequest: () => undefined,
          approveRequest: async () => null,
          denyRequest: () => null,
        },
        actor: 'cli-test',
      };

      const handler = createDevicesListHandler(() => errorContext);
      const result = await handler([]);

      expect(result.exitCode).toBe(1);
      expect(result.error).toContain('Error:');
    });
  });
});
