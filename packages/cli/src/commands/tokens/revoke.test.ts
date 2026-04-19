/**
 * Tokens Revoke Command Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockReadFile, mockFetch } = vi.hoisted(() => ({
  mockReadFile: vi.fn(),
  mockFetch: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({ readFile: mockReadFile }));
vi.mock('../../../lib/config.js', () => ({
  resolveCLIConfig: () => ({
    httpUrl: 'http://localhost:3001',
    wsUrl: 'ws://localhost:3001/ws',
    tokenPath: '/tmp/test-bootstrap-admin.json',
    jwtSecret: 'test-secret',
    bootstrapAdminEnabled: true,
  }),
}));

globalThis.fetch = mockFetch;

import { tokensRevokeHandler } from './revoke.js';

const ADMIN_TOKEN_FILE = JSON.stringify({
  clientId: 'admin-123',
  token: 'jwt-admin-token',
  scopes: ['*'],
  createdAt: '2026-01-01T00:00:00Z',
  expiresAt: '2027-01-01T00:00:00Z',
});

const TOKEN_ID = 'aaa-bbb-ccc-ddd';

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

describe('tokens revoke', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('--help', () => {
    it('shows help with --help', async () => {
      const result = await tokensRevokeHandler(['--help']);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('Usage:');
      expect(result.output).toContain('tokens revoke');
      expect(result.output).toContain('<id>');
    });

    it('shows help with -h', async () => {
      const result = await tokensRevokeHandler(['-h']);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('Usage:');
    });
  });

  describe('argument validation', () => {
    it('returns exit 2 when id is missing', async () => {
      const result = await tokensRevokeHandler([]);
      expect(result.exitCode).toBe(2);
      expect(result.error).toContain('Missing argument');
    });

    it('returns exit 2 when first arg looks like a flag', async () => {
      const result = await tokensRevokeHandler(['--id']);
      expect(result.exitCode).toBe(2);
    });
  });

  describe('missing admin token', () => {
    it('returns exit 1 when token file is missing', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'));
      const result = await tokensRevokeHandler([TOKEN_ID]);
      expect(result.exitCode).toBe(1);
      expect(result.error).toContain('Bootstrap admin token not found');
    });
  });

  describe('server unreachable', () => {
    it('returns exit 1 with helpful message', async () => {
      mockReadFile.mockResolvedValue(ADMIN_TOKEN_FILE);
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
      const result = await tokensRevokeHandler([TOKEN_ID]);
      expect(result.exitCode).toBe(1);
      expect(result.error).toContain('Cannot reach server');
    });
  });

  describe('server errors', () => {
    it('returns exit 1 with message on 404', async () => {
      mockReadFile.mockResolvedValue(ADMIN_TOKEN_FILE);
      mockFetch.mockReturnValue(mockErrorResponse(404, 'Not Found'));
      const result = await tokensRevokeHandler([TOKEN_ID]);
      expect(result.exitCode).toBe(1);
      expect(result.error).toContain('Token not found');
      expect(result.error).toContain(TOKEN_ID);
    });

    it('returns exit 1 on other server errors', async () => {
      mockReadFile.mockResolvedValue(ADMIN_TOKEN_FILE);
      mockFetch.mockReturnValue(
        mockErrorResponse(500, 'Internal Server Error'),
      );
      const result = await tokensRevokeHandler([TOKEN_ID]);
      expect(result.exitCode).toBe(1);
      expect(result.error).toContain('500');
    });
  });

  describe('successful revoke', () => {
    it('prints confirmation with name and id', async () => {
      mockReadFile.mockResolvedValue(ADMIN_TOKEN_FILE);
      mockFetch.mockReturnValue(
        mockOkResponse({ key: { id: TOKEN_ID, name: 'CI Pipeline' } }),
      );
      const result = await tokensRevokeHandler([TOKEN_ID]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('CI Pipeline');
      expect(result.output).toContain(TOKEN_ID);
    });

    it('sends DELETE to correct URL with auth header', async () => {
      mockReadFile.mockResolvedValue(ADMIN_TOKEN_FILE);
      mockFetch.mockReturnValue(
        mockOkResponse({ key: { id: TOKEN_ID, name: 'Test' } }),
      );
      await tokensRevokeHandler([TOKEN_ID]);
      expect(mockFetch).toHaveBeenCalledWith(
        `http://localhost:3001/api/access-tokens/${TOKEN_ID}`,
        expect.objectContaining({
          method: 'DELETE',
          headers: expect.objectContaining({
            Authorization: 'Bearer jwt-admin-token',
          }),
        }),
      );
    });
  });
});
