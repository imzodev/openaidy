/**
 * MCP Import Command Tests
 *
 * Mocks @clack/prompts, admin-token, node:fs/promises and global fetch so the
 * handler can be exercised without a real server or file system.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockClack = vi.hoisted(() => ({
  log: { error: vi.fn(), success: vi.fn() },
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

const mockReadFile = vi.hoisted(() => vi.fn());
vi.mock('node:fs/promises', () => ({ readFile: mockReadFile }));

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

const { mcpImportHandler } = await import('./import.js');

const GITHUB_CONFIG = JSON.stringify({
  mcpServers: {
    github: {
      type: 'http',
      url: 'https://api.githubcopilot.com/mcp/',
      headers: { Authorization: 'Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}' },
    },
  },
});

describe('mcp import', () => {
  it('shows help with --help and exits 0', async () => {
    const result = await mcpImportHandler(['--help']);
    expect(result.exitCode).toBe(0);
    expect(mockClack.note).toHaveBeenCalled();
  });

  it('posts the config to /api/mcp/servers/import and exits 0', async () => {
    mockReadFile.mockResolvedValue(GITHUB_CONFIG);
    global.fetch = mockFetchJson({
      servers: [
        { id: 'github', transport: 'http', connected: true, toolCount: 3 },
      ],
    });

    const result = await mcpImportHandler(['./mcp.json']);

    expect(result.exitCode).toBe(0);
    const [url, init] = (
      global.fetch as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3001/api/mcp/servers/import');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.mcpServers.github.type).toBe('http');
  });

  it('accepts a bare map without the mcpServers wrapper', async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify({ github: { type: 'http', url: 'https://e.com/mcp' } }),
    );
    global.fetch = mockFetchJson({
      servers: [
        { id: 'github', transport: 'http', connected: false, toolCount: 0 },
      ],
    });

    const result = await mcpImportHandler(['./mcp.json']);
    expect(result.exitCode).toBe(0);
    const [, init] = (
      global.fetch as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls[0] as [string, RequestInit];
    // Wrapped into { mcpServers } before sending.
    expect(JSON.parse(init.body as string).mcpServers.github).toBeDefined();
  });

  it('exits 2 on invalid JSON', async () => {
    mockReadFile.mockResolvedValue('{ not json');
    const result = await mcpImportHandler(['./mcp.json']);
    expect(result.exitCode).toBe(2);
  });

  it('exits 2 when the config is not an object map', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify(['a', 'b']));
    const result = await mcpImportHandler(['./mcp.json']);
    expect(result.exitCode).toBe(2);
  });

  it('exits 1 with the server message when the import is rejected', async () => {
    mockReadFile.mockResolvedValue(GITHUB_CONFIG);
    global.fetch = mockFetchJson(
      { error: 'CONFLICT', message: 'MCP server(s) already exist: github' },
      409,
    );

    const result = await mcpImportHandler(['./mcp.json']);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain('already exist');
  });

  it('exits 1 when not authenticated', async () => {
    mockReadFile.mockResolvedValue(GITHUB_CONFIG);
    mockReadAdminToken.mockResolvedValueOnce({
      ok: false,
      error: 'No admin token found',
    });
    const result = await mcpImportHandler(['./mcp.json']);
    expect(result.exitCode).toBe(1);
    expect(result.error).toBe('No admin token found');
  });
});
