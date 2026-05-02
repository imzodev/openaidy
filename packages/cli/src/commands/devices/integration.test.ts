/**
 * CLI Integration Tests
 *
 * Comprehensive tests for CLI command integration with control-plane workflows.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { mockClack } = vi.hoisted(() => ({
  mockClack: {
    log: { error: vi.fn() },
    note: vi.fn(),
    outro: vi.fn(),
    spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
  },
}));

vi.mock('@clack/prompts', () => mockClack);

import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDevicesListHandler } from './list.js';
import { createDevicesApproveHandler } from './approve.js';
import { createDevicesDenyHandler } from './deny.js';
import type {
  PairingContext,
  PairingRequestData,
} from '@openaidy/control-plane';

/** Return the concatenated text from all p.note() calls */
function noteOutput(): string {
  return mockClack.note.mock.calls.map((c: unknown[]) => c[0]).join('\n');
}
/** Return the concatenated text from all p.outro() calls */
function outroOutput(): string {
  return mockClack.outro.mock.calls.map((c: unknown[]) => c[0]).join('\n');
}

describe('CLI Integration', () => {
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
  let tempDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockClack.spinner.mockReturnValue({ start: vi.fn(), stop: vi.fn() });
    tempDir = join(tmpdir(), `cli-integration-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });

    mockRequests = new Map();
    mockContext = {
      pairingService: {
        getPendingRequests: () =>
          Array.from(mockRequests.values()).filter(
            (r) => r.status === 'pending',
          ),
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
        denyRequest: (id, by) => {
          const req = mockRequests.get(id);
          if (!req || req.status !== 'pending') return null;
          req.status = 'denied';
          req.deniedAt = Date.now();
          req.deniedBy = by;
          return req;
        },
      },
      actor: 'cli-integration-test',
    };
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('Full Device Workflow', () => {
    it('lists, approves, and confirms approved status', async () => {
      const getContext = () => mockContext;
      const listHandler = createDevicesListHandler(getContext);
      const approveHandler = createDevicesApproveHandler(getContext);

      // Setup: Add pending request
      mockRequests.set(
        'req-1',
        createRequest({ requestId: 'req-1', status: 'pending' }),
      );

      // Step 1: List pending requests
      const listResult = await listHandler(['--status', 'pending']);
      expect(listResult.exitCode).toBe(0);
      expect(noteOutput()).toContain('req-1');

      // Step 2: Approve the request
      mockClack.note.mockClear();
      mockClack.outro.mockClear();
      const approveResult = await approveHandler(['req-1']);
      expect(approveResult.exitCode).toBe(0);
      expect(outroOutput()).toContain('approved');

      // Step 3: List approved requests
      mockClack.note.mockClear();
      const approvedList = await listHandler(['--status', 'approved']);
      expect(approvedList.exitCode).toBe(0);
      expect(noteOutput()).toContain('req-1');
    });

    it('lists, denies, and confirms denied status', async () => {
      const getContext = () => mockContext;
      const listHandler = createDevicesListHandler(getContext);
      const denyHandler = createDevicesDenyHandler(getContext);

      // Setup: Add pending request
      mockRequests.set(
        'req-2',
        createRequest({ requestId: 'req-2', status: 'pending' }),
      );

      // Step 1: List pending requests
      const listResult = await listHandler(['--status', 'pending']);
      expect(listResult.exitCode).toBe(0);
      expect(noteOutput()).toContain('req-2');

      // Step 2: Deny the request
      mockClack.note.mockClear();
      mockClack.outro.mockClear();
      const denyResult = await denyHandler(['req-2']);
      expect(denyResult.exitCode).toBe(0);
      expect(outroOutput()).toContain('denied');

      // Step 3: List denied requests
      mockClack.note.mockClear();
      const deniedList = await listHandler(['--status', 'denied']);
      expect(deniedList.exitCode).toBe(0);
      expect(noteOutput()).toContain('req-2');
    });

    it('handles multiple requests with filtering', async () => {
      const getContext = () => mockContext;
      const handler = createDevicesListHandler(getContext);

      // Setup: Add multiple requests with different statuses
      mockRequests.set(
        'req-1',
        createRequest({
          requestId: 'req-1',
          status: 'pending',
          deviceName: 'Phone 1',
        }),
      );
      mockRequests.set(
        'req-2',
        createRequest({
          requestId: 'req-2',
          status: 'pending',
          deviceName: 'Phone 2',
        }),
      );
      mockRequests.set(
        'req-3',
        createRequest({
          requestId: 'req-3',
          status: 'approved',
          deviceName: 'Desktop',
        }),
      );
      mockRequests.set(
        'req-4',
        createRequest({
          requestId: 'req-4',
          status: 'denied',
          deviceName: 'Unknown',
        }),
      );

      // List all
      const allResult = await handler(['--status', 'all']);
      expect(allResult.exitCode).toBe(0);
      expect(noteOutput()).toContain('Phone 1');
      expect(noteOutput()).toContain('Phone 2');
      expect(noteOutput()).toContain('Desktop');
      expect(noteOutput()).toContain('Unknown');

      // List pending only
      mockClack.note.mockClear();
      const pendingResult = await handler(['--status', 'pending']);
      expect(pendingResult.exitCode).toBe(0);
      expect(noteOutput()).toContain('Phone 1');
      expect(noteOutput()).toContain('Phone 2');
      expect(noteOutput()).not.toContain('Desktop');
    });

    it('applies limit to results', async () => {
      const getContext = () => mockContext;
      const handler = createDevicesListHandler(getContext);

      // Setup: Add many requests with different timestamps
      const now = Date.now();
      for (let i = 1; i <= 10; i++) {
        mockRequests.set(
          `req-${i}`,
          createRequest({
            requestId: `req-${i}`,
            status: 'pending',
            deviceName: `Device ${i}`,
            requestedAt: now - i * 1000, // Older as i increases
          }),
        );
      }

      const result = await handler(['--status', 'pending', '--limit', '3']);
      expect(result.exitCode).toBe(0);
      const text = noteOutput();
      // Results are sorted by date desc (newest first), so Device 1 should be first
      expect(text).toContain('Device 1');
      // Should only show 3 devices
      const deviceMatches = text.match(/Request ID: req-/g) || [];
      expect(deviceMatches.length).toBeLessThanOrEqual(3);
    });
  });

  describe('Error State Transitions', () => {
    it('cannot approve an already approved request', async () => {
      const getContext = () => mockContext;
      const approveHandler = createDevicesApproveHandler(getContext);

      mockRequests.set(
        'req-1',
        createRequest({ requestId: 'req-1', status: 'approved' }),
      );

      const result = await approveHandler(['req-1']);
      expect(result.exitCode).toBe(1);
      expect(result.error).toMatch(/already|processed/i);
    });

    it('cannot deny an already denied request', async () => {
      const getContext = () => mockContext;
      const denyHandler = createDevicesDenyHandler(getContext);

      mockRequests.set(
        'req-1',
        createRequest({ requestId: 'req-1', status: 'denied' }),
      );

      const result = await denyHandler(['req-1']);
      expect(result.exitCode).toBe(1);
      expect(result.error).toMatch(/already|processed/i);
    });

    it('cannot approve an expired request', async () => {
      const getContext = () => mockContext;
      const approveHandler = createDevicesApproveHandler(getContext);

      mockRequests.set(
        'req-1',
        createRequest({
          requestId: 'req-1',
          status: 'expired',
          expiresAt: Date.now() - 1000,
        }),
      );

      const result = await approveHandler(['req-1']);
      expect(result.exitCode).toBe(1);
      expect(result.error).toMatch(/expired|not found/i);
    });

    it('handles non-existent request approval', async () => {
      const getContext = () => mockContext;
      const approveHandler = createDevicesApproveHandler(getContext);

      const result = await approveHandler(['nonexistent']);
      expect(result.exitCode).toBe(1);
      expect(result.error).toContain('not found');
    });

    it('handles non-existent request denial', async () => {
      const getContext = () => mockContext;
      const denyHandler = createDevicesDenyHandler(getContext);

      const result = await denyHandler(['nonexistent']);
      expect(result.exitCode).toBe(1);
      expect(result.error).toContain('not found');
    });
  });

  describe('Scope Override', () => {
    it('approves with custom scopes', async () => {
      const getContext = () => mockContext;
      const approveHandler = createDevicesApproveHandler(getContext);

      mockRequests.set(
        'req-1',
        createRequest({
          requestId: 'req-1',
          capabilities: ['chat', 'files', 'notifications'],
        }),
      );

      const result = await approveHandler(['req-1', '--scopes', 'chat,files']);
      expect(result.exitCode).toBe(0);
      expect(outroOutput()).toContain('approved');

      // Verify scopes were overridden
      const approved = mockRequests.get('req-1');
      expect(approved?.scopes).toEqual(['chat', 'files']);
    });
  });

  describe('Empty State Handling', () => {
    it('shows empty state for no pending requests', async () => {
      const getContext = () => mockContext;
      const handler = createDevicesListHandler(getContext);

      const result = await handler(['--status', 'pending']);
      expect(result.exitCode).toBe(0);
      expect(noteOutput()).toContain('No pending');
    });

    it('shows status-specific empty state', async () => {
      const getContext = () => mockContext;
      const handler = createDevicesListHandler(getContext);

      const result = await handler(['--status', 'approved']);
      expect(result.exitCode).toBe(0);
      expect(noteOutput()).toContain('No approved');
    });
  });

  describe('Help Consistency', () => {
    it('all device commands have consistent help format', async () => {
      const listHandler = createDevicesListHandler();
      const approveHandler = createDevicesApproveHandler();
      const denyHandler = createDevicesDenyHandler();

      await Promise.all([
        listHandler(['--help']),
        approveHandler(['--help']),
        denyHandler(['--help']),
      ]);

      // All should show Usage via p.note
      expect(mockClack.note).toHaveBeenCalledTimes(3);
      const allNotes = mockClack.note.mock.calls.map(
        (c: unknown[]) => c[0] as string,
      );
      for (const text of allNotes) {
        expect(text).toContain('Usage:');
        expect(text).toContain('Examples:');
      }
    });
  });
});
