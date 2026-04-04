/**
 * Device Formatter Tests
 */

import { describe, it, expect } from 'vitest';
import {
  formatRequest,
  formatRequestList,
  formatEmptyState,
  formatRequestsByStatus,
  sortRequestsByDate,
  getTimeUntilExpiration,
  formatRequestWithExpiry,
} from './devices.js';
import type { PairingRequestData } from '@openaidy/control-plane';

describe('Device Formatters', () => {
  const createRequest = (overrides?: Partial<PairingRequestData>): PairingRequestData => ({
    requestId: 'req-123',
    pairingCode: '654321',
    deviceName: 'Test Device',
    deviceType: 'android',
    capabilities: ['chat', 'files'],
    status: 'pending',
    requestedAt: Date.now() - 60000,
    expiresAt: Date.now() + 300000,
    ...overrides,
  });

  describe('formatRequest', () => {
    it('formats a single request with all fields', () => {
      const req = createRequest();
      const output = formatRequest(req);

      expect(output).toContain('Request ID: req-123');
      expect(output).toContain('Device:     Test Device (android)');
      expect(output).toContain('Code:       654321');
      expect(output).toContain('Status:     pending');
      expect(output).toContain('Scopes:     chat, files');
    });

    it('includes created and expires timestamps', () => {
      const req = createRequest({
        requestedAt: 1700000000000,
        expiresAt: 1700000300000,
      });
      const output = formatRequest(req);

      expect(output).toContain('Created:');
      expect(output).toContain('Expires:');
    });
  });

  describe('formatRequestList', () => {
    it('formats empty list with custom title', () => {
      const output = formatRequestList([], 'Custom Title');
      expect(output).toContain('No custom title');
    });

    it('formats list with requests', () => {
      const requests = [
        createRequest({ requestId: 'req-1', deviceName: 'Device 1' }),
        createRequest({ requestId: 'req-2', deviceName: 'Device 2' }),
      ];
      const output = formatRequestList(requests);

      expect(output).toContain('Device 1');
      expect(output).toContain('Device 2');
      expect(output).toContain('Total: 2 request(s)');
    });

    it('uses default title', () => {
      const output = formatRequestList([createRequest()]);
      expect(output).toContain('Pending Device Pairing Requests');
    });
  });

  describe('formatEmptyState', () => {
    it('returns empty state message', () => {
      const output = formatEmptyState();
      expect(output).toBe('No pending device pairing requests.');
    });
  });

  describe('formatRequestsByStatus', () => {
    it('filters by pending status', () => {
      const requests = [
        createRequest({ requestId: 'req-1', status: 'pending' }),
        createRequest({ requestId: 'req-2', status: 'approved' }),
      ];
      const output = formatRequestsByStatus(requests, 'pending');

      expect(output).toContain('req-1');
      expect(output).not.toContain('req-2');
      expect(output).toContain('Pending Device Pairing Requests');
    });

    it('filters by approved status', () => {
      const requests = [
        createRequest({ requestId: 'req-1', status: 'pending' }),
        createRequest({ requestId: 'req-2', status: 'approved' }),
      ];
      const output = formatRequestsByStatus(requests, 'approved');

      expect(output).not.toContain('req-1');
      expect(output).toContain('req-2');
      expect(output).toContain('Approved Device Pairing Requests');
    });
  });

  describe('sortRequestsByDate', () => {
    it('sorts by requestedAt descending (newest first)', () => {
      const requests = [
        createRequest({ requestId: 'old', requestedAt: 1000 }),
        createRequest({ requestId: 'new', requestedAt: 3000 }),
        createRequest({ requestId: 'mid', requestedAt: 2000 }),
      ];
      const sorted = sortRequestsByDate(requests);

      expect(sorted[0].requestId).toBe('new');
      expect(sorted[1].requestId).toBe('mid');
      expect(sorted[2].requestId).toBe('old');
    });

    it('does not mutate original array', () => {
      const requests = [
        createRequest({ requestId: 'old', requestedAt: 1000 }),
        createRequest({ requestId: 'new', requestedAt: 3000 }),
      ];
      const originalOrder = requests.map(r => r.requestId);
      sortRequestsByDate(requests);
      const afterOrder = requests.map(r => r.requestId);

      expect(originalOrder).toEqual(afterOrder);
    });
  });

  describe('getTimeUntilExpiration', () => {
    it('returns "expired" for past times', () => {
      const result = getTimeUntilExpiration(Date.now() - 1000);
      expect(result).toBe('expired');
    });

    it('returns seconds only for less than a minute', () => {
      const result = getTimeUntilExpiration(Date.now() + 30000);
      expect(result).toMatch(/^\d+s$/);
    });

    it('returns minutes and seconds for more than a minute', () => {
      const result = getTimeUntilExpiration(Date.now() + 90000);
      expect(result).toMatch(/^\d+m \d+s$/);
    });
  });

  describe('formatRequestWithExpiry', () => {
    it('includes expiry countdown', () => {
      const req = createRequest({
        expiresAt: Date.now() + 120000, // 2 minutes
      });
      const output = formatRequestWithExpiry(req);

      expect(output).toContain('Expires in:');
      expect(output).toContain('Request ID: req-123');
    });
  });
});
