/**
 * Tokens List Command Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockReadFile, mockFetch, mockClack } = vi.hoisted(() => ({
  mockReadFile: vi.fn(),
  mockFetch: vi.fn(),
  mockClack: {
    note: vi.fn(),
    log: { error: vi.fn() },
  },
}));

vi.mock('node:fs/promises', () => ({ readFile: mockReadFile }));
vi.mock('@clack/prompts', () => mockClack);
vi.mock('../../../lib/config.js', () => ({
  resolveCLIConfig: () => ({
    httpUrl: 'http://localhost:3001',
    wsUrl: 'ws://localhost:3001/ws',
    tokenPath: '/tmp/test-bootstrap-admin.json',
    jwtSecret: 'test-secret',
    bootstrapAdminEnabled: true,
  }),
}));

// Stub global fetch
globalThis.fetch = mockFetch;

import { tokensListHandler } from './list.js';

const ADMIN_TOKEN_FILE = JSON.stringify({
  clientId: 'admin-123',
  token: 'jwt-admin-token',
  scopes: ['*'],
  createdAt: '2026-01-01T00:00:00Z',
  expiresAt: '2027-01-01T00:00:00Z',
});

const ACTIVE_TOKEN = {
  id: 'aaa-bbb-ccc',
  name: 'CI Pipeline',
  keyPrefix: 'oat_aabb',
  scopes: ['sessions.read', 'sessions.stream'],
  createdAt: '2026-04-01T00:00:00Z',
  lastUsedAt: '2026-04-19T00:00:00Z',
  expiresAt: null,
  revoked: false,
};

const REVOKED_TOKEN = {
  id: 'ddd-eee-fff',
  name: 'Old Key',
  keyPrefix: 'oat_ddee',
  scopes: ['*'],
  createdAt: '2026-01-01T00:00:00Z',
  lastUsedAt: null,
  expiresAt: null,
  revoked: true,
};

function mockOkResponse(body: unknown) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  } as Response);
}

function mockErrorResponse(status: number, error: string) {
  return Promise.resolve({
    ok: false,
    status,
    statusText: error,
    json: () => Promise.resolve({ error }),
  } as Response);
}

describe('tokens list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('--help', () => {
    it('shows help with --help', async () => {
      const result = await tokensListHandler(['--help']);
      expect(result.exitCode).toBe(0);
      expect(mockClack.note).toHaveBeenCalledWith(
        expect.stringContaining('Usage:'),
        expect.any(String),
      );
      expect(mockClack.note).toHaveBeenCalledWith(
        expect.stringContaining('tokens list'),
        expect.any(String),
      );
    });

    it('shows help with -h', async () => {
      const result = await tokensListHandler(['-h']);
      expect(result.exitCode).toBe(0);
      expect(mockClack.note).toHaveBeenCalledWith(
        expect.stringContaining('Usage:'),
        expect.any(String),
      );
    });
  });

  describe('missing admin token', () => {
    it('returns exit 1 when token file is missing', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'));
      const result = await tokensListHandler([]);
      expect(result.exitCode).toBe(1);
      expect(result.error).toContain('Bootstrap admin token not found');
    });
  });

  describe('server unreachable', () => {
    it('returns exit 1 with helpful message', async () => {
      mockReadFile.mockResolvedValue(ADMIN_TOKEN_FILE);
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
      const result = await tokensListHandler([]);
      expect(result.exitCode).toBe(1);
      expect(result.error).toContain('Cannot reach server');
      expect(result.error).toContain('Make sure the server is running');
    });
  });

  describe('server error', () => {
    it('returns exit 1 on 401', async () => {
      mockReadFile.mockResolvedValue(ADMIN_TOKEN_FILE);
      mockFetch.mockReturnValue(mockErrorResponse(401, 'Unauthorized'));
      const result = await tokensListHandler([]);
      expect(result.exitCode).toBe(1);
      expect(result.error).toContain('401');
    });
  });

  describe('successful list', () => {
    function noteOutput(): string {
      return mockClack.note.mock.calls.map((c: unknown[]) => c[0]).join('\n');
    }

    it('shows active and revoked tokens', async () => {
      mockReadFile.mockResolvedValue(ADMIN_TOKEN_FILE);
      mockFetch.mockReturnValue(
        mockOkResponse({ keys: [ACTIVE_TOKEN, REVOKED_TOKEN] }),
      );
      const result = await tokensListHandler([]);
      expect(result.exitCode).toBe(0);
      expect(noteOutput()).toContain('CI Pipeline');
      expect(noteOutput()).toContain('oat_aabb');
      expect(noteOutput()).toContain('sessions.read');
      expect(noteOutput()).toContain('Old Key');
      expect(noteOutput()).toContain('[revoked]');
    });

    it('uses Bearer token in Authorization header', async () => {
      mockReadFile.mockResolvedValue(ADMIN_TOKEN_FILE);
      mockFetch.mockReturnValue(mockOkResponse({ keys: [] }));
      await tokensListHandler([]);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3001/api/access-tokens',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer jwt-admin-token',
          }),
        }),
      );
    });

    it('shows empty state when no tokens exist', async () => {
      mockReadFile.mockResolvedValue(ADMIN_TOKEN_FILE);
      mockFetch.mockReturnValue(mockOkResponse({ keys: [] }));
      const result = await tokensListHandler([]);
      expect(result.exitCode).toBe(0);
      expect(noteOutput()).toContain('No access tokens found');
    });

    it('does not expose key hash or raw token', async () => {
      mockReadFile.mockResolvedValue(ADMIN_TOKEN_FILE);
      mockFetch.mockReturnValue(mockOkResponse({ keys: [ACTIVE_TOKEN] }));
      await tokensListHandler([]);
      expect(noteOutput()).not.toContain('keyHash');
      expect(noteOutput()).not.toMatch(/oat_[a-f0-9]{60,}/);
    });
  });
});
