/**
 * Devices Deny Command Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockClack } = vi.hoisted(() => ({
  mockClack: {
    log: { error: vi.fn() },
    note: vi.fn(),
    outro: vi.fn(),
    spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
  },
}));

vi.mock('@clack/prompts', () => mockClack);

import { createDevicesDenyHandler } from './deny.js';
import type {
  PairingContext,
  PairingRequestData,
} from '@openaidy/control-plane';

describe('Devices Deny Command', () => {
  const createRequest = (
    overrides?: Partial<PairingRequestData>,
  ): PairingRequestData => ({
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
    vi.clearAllMocks();
    mockClack.spinner.mockReturnValue({ start: vi.fn(), stop: vi.fn() });

    mockRequests = new Map();
    mockRequests.set(
      'req-1',
      createRequest({ requestId: 'req-1', status: 'pending' }),
    );
    mockRequests.set(
      'req-2',
      createRequest({ requestId: 'req-2', status: 'approved' }),
    );
    mockRequests.set(
      'req-3',
      createRequest({
        requestId: 'req-3',
        status: 'expired',
        expiresAt: Date.now() - 1000,
      }),
    );

    mockContext = {
      pairingService: {
        getPendingRequests: () =>
          Array.from(mockRequests.values()).filter(
            (r) => r.status === 'pending',
          ),
        getAllRequests: () => Array.from(mockRequests.values()),
        getRequest: (id) => mockRequests.get(id),
        approveRequest: async () => null,
        denyRequest: (id, by) => {
          const req = mockRequests.get(id);
          if (!req || req.status !== 'pending') return null;
          req.status = 'denied';
          req.deniedAt = Date.now();
          req.deniedBy = by;
          return req;
        },
      },
      actor: 'cli-test',
    };
  });

  describe('with no context', () => {
    it('returns exit 1 and logs error when no context available', async () => {
      const handler = createDevicesDenyHandler();
      const result = await handler(['req-1']);
      expect(result.exitCode).toBe(1);
      expect(result.error).toContain('No pairing service');
      expect(mockClack.log.error).toHaveBeenCalledWith(
        expect.stringContaining('No pairing service'),
      );
    });

    it('shows help with --help flag via p.note', async () => {
      const handler = createDevicesDenyHandler();
      const result = await handler(['--help']);
      expect(result.exitCode).toBe(0);
      expect(mockClack.note).toHaveBeenCalledWith(
        expect.stringContaining('devices deny'),
        expect.any(String),
      );
    });

    it('shows help with -h flag', async () => {
      const handler = createDevicesDenyHandler();
      const result = await handler(['-h']);
      expect(result.exitCode).toBe(0);
      expect(mockClack.note).toHaveBeenCalledWith(
        expect.stringContaining('Usage:'),
        expect.any(String),
      );
    });
  });

  describe('with mock context', () => {
    it('returns exit 1 when missing request-id', async () => {
      const handler = createDevicesDenyHandler(() => mockContext);
      const result = await handler([]);
      expect(result.exitCode).toBe(1);
      expect(result.error).toContain('Missing required argument');
      expect(mockClack.log.error).toHaveBeenCalled();
    });

    it('denies pending request and calls p.outro', async () => {
      const handler = createDevicesDenyHandler(() => mockContext);
      const result = await handler(['req-1']);
      expect(result.exitCode).toBe(0);
      expect(mockClack.outro).toHaveBeenCalledWith(
        expect.stringContaining('Test Device'),
      );
      expect(mockClack.outro).toHaveBeenCalledWith(
        expect.stringContaining('denied'),
      );
      expect(mockClack.note).toHaveBeenCalledWith(
        expect.stringContaining('req-1'),
        expect.any(String),
      );
    });

    it('returns exit 1 for non-existent request', async () => {
      const handler = createDevicesDenyHandler(() => mockContext);
      const result = await handler(['nonexistent']);
      expect(result.exitCode).toBe(1);
      expect(result.error).toContain('not found');
      expect(mockClack.log.error).toHaveBeenCalled();
    });

    it('returns exit 1 for already approved request', async () => {
      const handler = createDevicesDenyHandler(() => mockContext);
      const result = await handler(['req-2']);
      expect(result.exitCode).toBe(1);
      expect(result.error).toMatch(/already|processed/i);
    });

    it('returns exit 1 for expired request', async () => {
      const handler = createDevicesDenyHandler(() => mockContext);
      const result = await handler(['req-3']);
      expect(result.exitCode).toBe(1);
      expect(result.error).toMatch(/expired|not found/i);
    });
  });

  describe('error handling', () => {
    it('handles workflow errors gracefully', async () => {
      const errorContext: PairingContext = {
        pairingService: {
          getPendingRequests: () => [],
          getAllRequests: () => [],
          getRequest: () => undefined,
          approveRequest: async () => null,
          denyRequest: () => {
            throw new Error('Service unavailable');
          },
        },
        actor: 'cli-test',
      };

      const handler = createDevicesDenyHandler(() => errorContext);
      const result = await handler(['req-1']);

      expect(result.exitCode).toBe(1);
      expect(result.error).toContain('Error:');
      expect(mockClack.log.error).toHaveBeenCalledWith(
        expect.stringContaining('Error:'),
      );
    });
  });
});
