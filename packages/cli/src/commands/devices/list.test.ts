/**
 * Devices List Command Tests
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

import { createDevicesListHandler } from './list.js';
import type {
  PairingContext,
  PairingRequestData,
} from '@openaidy/control-plane';

describe('Devices List Command', () => {
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

  let mockRequests: PairingRequestData[];
  let mockContext: PairingContext;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClack.spinner.mockReturnValue({ start: vi.fn(), stop: vi.fn() });

    mockRequests = [
      createRequest({
        requestId: 'req-1',
        status: 'pending',
        deviceName: 'Android Phone',
      }),
      createRequest({
        requestId: 'req-2',
        status: 'pending',
        deviceName: 'iPhone',
      }),
      createRequest({
        requestId: 'req-3',
        status: 'approved',
        deviceName: 'Desktop',
      }),
      createRequest({
        requestId: 'req-4',
        status: 'denied',
        deviceName: 'Unknown Device',
      }),
    ];

    mockContext = {
      pairingService: {
        getPendingRequests: () =>
          mockRequests.filter((r) => r.status === 'pending'),
        getAllRequests: () => mockRequests,
        getRequest: (id) => mockRequests.find((r) => r.requestId === id),
        approveRequest: async () => null,
        denyRequest: () => null,
      },
      actor: 'cli-test',
    };
  });

  describe('with no context', () => {
    const handler = createDevicesListHandler();

    it('returns exit 0 and shows empty state when no context available', async () => {
      const result = await handler([]);
      expect(result.exitCode).toBe(0);
      expect(mockClack.note).toHaveBeenCalledWith(
        expect.stringContaining('No pending'),
        expect.any(String),
      );
    });

    it('shows help with --help flag', async () => {
      const result = await handler(['--help']);
      expect(result.exitCode).toBe(0);
      expect(mockClack.note).toHaveBeenCalledWith(
        expect.stringContaining('devices list'),
        expect.any(String),
      );
    });

    it('shows help with -h flag', async () => {
      const result = await handler(['-h']);
      expect(result.exitCode).toBe(0);
      expect(mockClack.note).toHaveBeenCalledWith(
        expect.stringContaining('Usage:'),
        expect.any(String),
      );
    });
  });

  describe('with mock context', () => {
    it('lists pending requests by default', async () => {
      const handler = createDevicesListHandler(() => mockContext);
      const result = await handler([]);
      expect(result.exitCode).toBe(0);
      expect(mockClack.note).toHaveBeenCalledWith(
        expect.stringContaining('req-1'),
        expect.any(String),
      );
      expect(mockClack.note).toHaveBeenCalledWith(
        expect.stringContaining('req-2'),
        expect.any(String),
      );
      expect(mockClack.note).toHaveBeenCalledWith(
        expect.not.stringContaining('req-3'),
        expect.any(String),
      );
    });

    it('filters by status with --status approved', async () => {
      const handler = createDevicesListHandler(() => mockContext);
      const result = await handler(['--status', 'approved']);
      expect(result.exitCode).toBe(0);
      expect(mockClack.note).toHaveBeenCalledWith(
        expect.stringContaining('req-3'),
        expect.stringContaining('Approved'),
      );
    });

    it('shows all requests with --status all', async () => {
      const handler = createDevicesListHandler(() => mockContext);
      const result = await handler(['--status', 'all']);
      expect(result.exitCode).toBe(0);
      expect(mockClack.note).toHaveBeenCalledWith(
        expect.stringContaining('req-4'),
        expect.stringContaining('All'),
      );
    });

    it('applies --limit flag', async () => {
      const handler = createDevicesListHandler(() => mockContext);
      const result = await handler(['--limit', '1']);
      expect(result.exitCode).toBe(0);
      expect(mockClack.note).toHaveBeenCalledWith(
        expect.stringContaining('req-1'),
        expect.any(String),
      );
      expect(mockClack.note).toHaveBeenCalledWith(
        expect.not.stringContaining('req-2'),
        expect.any(String),
      );
    });

    it('shows empty state when no pending requests', async () => {
      mockRequests = mockRequests.filter((r) => r.status !== 'pending');
      const handler = createDevicesListHandler(() => mockContext);
      const result = await handler([]);
      expect(result.exitCode).toBe(0);
      expect(mockClack.note).toHaveBeenCalledWith(
        expect.stringContaining('No pending'),
        expect.any(String),
      );
    });

    it('shows empty state when filtering for status with no matches', async () => {
      mockRequests = mockRequests.filter((r) => r.status !== 'expired');
      const handler = createDevicesListHandler(() => mockContext);
      const result = await handler(['--status', 'expired']);
      expect(result.exitCode).toBe(0);
      expect(mockClack.note).toHaveBeenCalledWith(
        expect.stringContaining('No expired'),
        expect.any(String),
      );
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
      expect(mockClack.log.error).toHaveBeenCalledWith(
        expect.stringContaining('Error:'),
      );
    });
  });
});
