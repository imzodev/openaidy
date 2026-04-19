/**
 * Tokens Create Command Tests
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

import { tokensCreateHandler } from './create.js';

const ADMIN_TOKEN_FILE = JSON.stringify({
  clientId: 'admin-123',
  token: 'jwt-admin-token',
  scopes: ['*'],
  createdAt: '2026-01-01T00:00:00Z',
  expiresAt: '2027-01-01T00:00:00Z',
});

const CREATE_RESPONSE = {
  key: {
    id: 'aaa-bbb-ccc',
    name: 'CI Pipeline',
    keyPrefix: 'oat_aabb',
    scopes: ['sessions.read', 'sessions.stream'],
    createdAt: '2026-04-19T00:00:00Z',
    expiresAt: null,
  },
  rawKey:
    'oat_aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899',
};

function mockCreated(body: unknown) {
  return Promise.resolve({
    ok: true,
    status: 201,
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

describe('tokens create', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('--help', () => {
    it('shows help with --help', async () => {
      const result = await tokensCreateHandler(['--help']);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('Usage:');
      expect(result.output).toContain('--name');
      expect(result.output).toContain('--scopes');
    });

    it('shows available scopes in help', async () => {
      const result = await tokensCreateHandler(['--help']);
      expect(result.output).toContain('sessions.read');
      expect(result.output).toContain('*');
    });
  });

  describe('argument validation', () => {
    it('returns exit 2 when --name is missing', async () => {
      const result = await tokensCreateHandler(['--scopes', 'sessions.read']);
      expect(result.exitCode).toBe(2);
      expect(result.error).toContain('--name');
    });

    it('returns exit 2 when --scopes is missing', async () => {
      const result = await tokensCreateHandler(['--name', 'My Token']);
      expect(result.exitCode).toBe(2);
      expect(result.error).toContain('--scopes');
    });

    it('returns exit 2 when both are missing', async () => {
      const result = await tokensCreateHandler([]);
      expect(result.exitCode).toBe(2);
    });
  });

  describe('missing admin token', () => {
    it('returns exit 1 when token file is missing', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'));
      const result = await tokensCreateHandler([
        '--name',
        'Test',
        '--scopes',
        '*',
      ]);
      expect(result.exitCode).toBe(1);
      expect(result.error).toContain('Bootstrap admin token not found');
    });
  });

  describe('server unreachable', () => {
    it('returns exit 1 with helpful message', async () => {
      mockReadFile.mockResolvedValue(ADMIN_TOKEN_FILE);
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
      const result = await tokensCreateHandler([
        '--name',
        'Test',
        '--scopes',
        'sessions.read',
      ]);
      expect(result.exitCode).toBe(1);
      expect(result.error).toContain('Cannot reach server');
    });
  });

  describe('server error', () => {
    it('returns exit 1 on 400', async () => {
      mockReadFile.mockResolvedValue(ADMIN_TOKEN_FILE);
      mockFetch.mockReturnValue(mockErrorResponse(400, 'name is required'));
      const result = await tokensCreateHandler([
        '--name',
        'Test',
        '--scopes',
        'sessions.read',
      ]);
      expect(result.exitCode).toBe(1);
      expect(result.error).toContain('400');
    });
  });

  describe('successful create', () => {
    it('shows raw token in output', async () => {
      mockReadFile.mockResolvedValue(ADMIN_TOKEN_FILE);
      mockFetch.mockReturnValue(mockCreated(CREATE_RESPONSE));
      const result = await tokensCreateHandler([
        '--name',
        'CI Pipeline',
        '--scopes',
        'sessions.read,sessions.stream',
      ]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain(CREATE_RESPONSE.rawKey);
      expect(result.output).toContain('CI Pipeline');
      expect(result.output).toContain('shown once');
    });

    it('shows token name, id and scopes', async () => {
      mockReadFile.mockResolvedValue(ADMIN_TOKEN_FILE);
      mockFetch.mockReturnValue(mockCreated(CREATE_RESPONSE));
      const result = await tokensCreateHandler([
        '--name',
        'CI Pipeline',
        '--scopes',
        'sessions.read',
      ]);
      expect(result.output).toContain('aaa-bbb-ccc');
      expect(result.output).toContain('sessions.read');
    });

    it('sends correct JSON body to server', async () => {
      mockReadFile.mockResolvedValue(ADMIN_TOKEN_FILE);
      mockFetch.mockReturnValue(mockCreated(CREATE_RESPONSE));
      await tokensCreateHandler([
        '--name',
        'CI Pipeline',
        '--scopes',
        'sessions.read,sessions.stream',
      ]);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3001/api/access-tokens',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Bearer jwt-admin-token',
          }),
          body: JSON.stringify({
            name: 'CI Pipeline',
            scopes: ['sessions.read', 'sessions.stream'],
          }),
        }),
      );
    });

    it('accepts -n as short form for --name', async () => {
      mockReadFile.mockResolvedValue(ADMIN_TOKEN_FILE);
      mockFetch.mockReturnValue(mockCreated(CREATE_RESPONSE));
      const result = await tokensCreateHandler([
        '-n',
        'Short Name',
        '--scopes',
        '*',
      ]);
      expect(result.exitCode).toBe(0);
    });

    it('includes expiresAt in request when --expires is given', async () => {
      mockReadFile.mockResolvedValue(ADMIN_TOKEN_FILE);
      mockFetch.mockReturnValue(mockCreated(CREATE_RESPONSE));
      await tokensCreateHandler([
        '--name',
        'Temp',
        '--scopes',
        'sessions.read',
        '--expires',
        '2026-12-31',
      ]);
      const body = JSON.parse(
        (mockFetch.mock.calls[0][1] as RequestInit).body as string,
      );
      expect(body.expiresAt).toBe('2026-12-31');
    });

    it('omits expiresAt when --expires is not given', async () => {
      mockReadFile.mockResolvedValue(ADMIN_TOKEN_FILE);
      mockFetch.mockReturnValue(mockCreated(CREATE_RESPONSE));
      await tokensCreateHandler([
        '--name',
        'No Expiry',
        '--scopes',
        'sessions.read',
      ]);
      const body = JSON.parse(
        (mockFetch.mock.calls[0][1] as RequestInit).body as string,
      );
      expect(body).not.toHaveProperty('expiresAt');
    });
  });
});
