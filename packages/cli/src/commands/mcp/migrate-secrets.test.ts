/**
 * Tests for `openaidy mcp migrate-secrets` (issue #401).
 *
 * Mocks @clack/prompts, admin-token, and global fetch so the handler can
 * be exercised without a real server.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockClack = vi.hoisted(() => ({
  log: {
    error: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    message: vi.fn(),
  },
  note: vi.fn(),
  spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
}));
vi.mock('@clack/prompts', () => mockClack);

const mockReadAdminToken = vi.hoisted(() =>
  vi.fn(() => Promise.resolve({ ok: true, token: 'fake-token' })),
);
vi.mock('../../lib/admin-token.js', () => ({
  readAdminToken: mockReadAdminToken,
}));

function mockFetchJson(data: unknown, status = 200) {
  return vi.fn(() =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      statusText: 'STATUS',
      json: () => Promise.resolve(data),
    }),
  ) as unknown as typeof fetch;
}

const originalServerUrl = process.env.OPENAIDY_SERVER_URL;

beforeEach(() => {
  vi.clearAllMocks();
  mockClack.spinner.mockReturnValue({ start: vi.fn(), stop: vi.fn() });
  mockReadAdminToken.mockResolvedValue({ ok: true, token: 'fake-token' });
  process.env.OPENAIDY_SERVER_URL = 'http://localhost:3001';
});

afterEach(() => {
  process.env.OPENAIDY_SERVER_URL = originalServerUrl ?? '';
});

const { mcpMigrateSecretsHandler } = await import('./migrate-secrets.js');

describe('mcp migrate-secrets', () => {
  it('shows help with --help and exits 0', async () => {
    const result = await mcpMigrateSecretsHandler(['--help']);
    expect(result.exitCode).toBe(0);
    expect(mockClack.note).toHaveBeenCalled();
  });

  it('posts to /api/mcp/servers/migrate-secrets with dryRun:false and exits 0', async () => {
    const fetchMock = mockFetchJson({
      scanned: 2,
      migrated: 1,
      serversTouched: ['legacy'],
      errors: [],
      dryRun: false,
    });
    global.fetch = fetchMock;

    const result = await mcpMigrateSecretsHandler([]);

    expect(result.exitCode).toBe(0);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3001/api/mcp/servers/migrate-secrets');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ dryRun: false });
  });

  it('passes dryRun: true when --dry-run is supplied', async () => {
    const fetchMock = mockFetchJson({
      scanned: 2,
      migrated: 1,
      serversTouched: ['legacy'],
      errors: [],
      dryRun: true,
    });
    global.fetch = fetchMock;

    const result = await mcpMigrateSecretsHandler(['--dry-run']);

    expect(result.exitCode).toBe(0);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ dryRun: true });
  });

  it('returns exitCode 0 with a no-op message when nothing to migrate', async () => {
    global.fetch = mockFetchJson({
      scanned: 2,
      migrated: 0,
      serversTouched: [],
      errors: [],
      dryRun: false,
    });
    const result = await mcpMigrateSecretsHandler([]);
    expect(result.exitCode).toBe(0);
  });

  it('returns exitCode 1 when the server reports per-server errors', async () => {
    global.fetch = mockFetchJson({
      scanned: 2,
      migrated: 1,
      serversTouched: ['legacy'],
      errors: [{ serverId: 'broken', message: 'something went wrong' }],
      dryRun: false,
    });
    const result = await mcpMigrateSecretsHandler([]);
    expect(result.exitCode).toBe(1);
  });

  it('returns exitCode 1 with an error message when fetch rejects', async () => {
    global.fetch = vi.fn(() =>
      Promise.reject(new Error('ECONNREFUSED')),
    ) as unknown as typeof fetch;
    const result = await mcpMigrateSecretsHandler([]);
    expect(result.exitCode).toBe(1);
    expect(mockClack.log.error).toHaveBeenCalled();
  });

  it('returns exitCode 1 when the admin token cannot be read', async () => {
    mockReadAdminToken.mockResolvedValueOnce({
      ok: false,
      error: 'No admin token at /etc/openaidy/bootstrap-admin.json',
    });
    const result = await mcpMigrateSecretsHandler([]);
    expect(result.exitCode).toBe(1);
  });

  it('returns exitCode 1 when the server returns a non-2xx response', async () => {
    global.fetch = mockFetchJson(
      { error: 'INTERNAL_ERROR', message: 'boom' },
      500,
    );
    const result = await mcpMigrateSecretsHandler([]);
    expect(result.exitCode).toBe(1);
    expect(mockClack.log.error).toHaveBeenCalled();
  });
});
