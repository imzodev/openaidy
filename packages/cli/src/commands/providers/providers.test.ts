/**
 * Providers Command Integration Tests
 *
 * Tests provider command handlers by mocking:
 * - The admin-token module (avoids file-system setup)
 * - The global fetch call (avoids real HTTP)
 * - @clack/prompts (captures terminal output)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// 1. Mock @clack/prompts
// ---------------------------------------------------------------------------

const mockClack = vi.hoisted(() => ({
  log: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
  note: vi.fn(),
  outro: vi.fn(),
  spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
  isCancel: vi.fn(() => false),
  select: vi.fn(),
}));

vi.mock('@clack/prompts', () => mockClack);

// ---------------------------------------------------------------------------
// 2. Mock admin-token to return a fake token without touching the file system
// ---------------------------------------------------------------------------

vi.mock('../../lib/admin-token.js', () => ({
  readAdminToken: vi.fn(() =>
    Promise.resolve({ ok: true, token: 'fake-test-token' }),
  ),
}));

// ---------------------------------------------------------------------------
// 3. Mock config
// ---------------------------------------------------------------------------

vi.mock('../../lib/config.js', () => ({
  resolveCLIConfig: vi.fn(() => ({
    httpUrl: 'http://localhost:3000',
    tokenPath: '/fake/path',
  })),
}));

// ---------------------------------------------------------------------------
// 4. Helpers
// ---------------------------------------------------------------------------

function noteOutput(): string {
  return mockClack.note.mock.calls
    .map((c: unknown[]) => c[0] as string)
    .join('\n');
}

// ---------------------------------------------------------------------------
// 5. Tests
// ---------------------------------------------------------------------------

describe('providers list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('shows help with --help flag', async () => {
    const { providersListHandler } = await import('./list.js');
    const result = await providersListHandler(['--help']);

    expect(result.exitCode).toBe(0);
    expect(mockClack.note).toHaveBeenCalled();
    const output = noteOutput();
    expect(output).toContain('Usage: openaidy providers list');
  });

  it('shows help with -h flag', async () => {
    const { providersListHandler } = await import('./list.js');
    const result = await providersListHandler(['-h']);

    expect(result.exitCode).toBe(0);
    expect(mockClack.note).toHaveBeenCalled();
  });

  it('fetches and displays providers from config', async () => {
    const mockConfig = {
      config: {
        version: 1,
        defaults: {},
        providers: [
          {
            id: 'openai',
            name: 'OpenAI',
            vendorFamily: 'openai-compatible',
            apiKeyEnv: 'sk-test-key',
            models: [],
          },
          {
            id: 'anthropic',
            name: 'Anthropic',
            vendorFamily: 'anthropic',
            apiKeyEnv: '',
            models: [],
          },
        ],
        agents: [],
      },
    };

    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockConfig),
    } as Response);

    const { providersListHandler } = await import('./list.js');
    const result = await providersListHandler([]);

    expect(result.exitCode).toBe(0);
    expect(mockClack.log.info).toHaveBeenCalled();
  });

  it('handles server error', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      statusText: 'Server Error',
    } as Response);

    const { providersListHandler } = await import('./list.js');
    const result = await providersListHandler([]);

    expect(result.exitCode).toBe(1);
    expect(result.error).toContain('Failed to fetch config');
  });

  it('filters connected providers with --connected flag', async () => {
    const mockConfig = {
      config: {
        version: 1,
        defaults: {},
        providers: [
          {
            id: 'openai',
            name: 'OpenAI',
            vendorFamily: 'openai-compatible',
            apiKeyEnv: 'sk-test-key',
            models: [],
          },
        ],
        agents: [],
      },
    };

    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockConfig),
    } as Response);

    const { providersListHandler } = await import('./list.js');
    const result = await providersListHandler(['--connected']);

    expect(result.exitCode).toBe(0);
  });
});

describe('providers connect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('shows help with --help flag', async () => {
    const { providersConnectHandler } = await import('./connect.js');
    const result = await providersConnectHandler(['--help']);

    expect(result.exitCode).toBe(0);
    expect(mockClack.note).toHaveBeenCalled();
    const output = noteOutput();
    expect(output).toContain('Usage: openaidy providers connect');
  });

  it('requires provider ID', async () => {
    const { providersConnectHandler } = await import('./connect.js');
    const result = await providersConnectHandler([]);

    expect(result.exitCode).toBe(1);
    expect(mockClack.log.error).toHaveBeenCalledWith(
      'Provider ID is required.',
    );
  });

  it('rejects unknown provider ID', async () => {
    const { providersConnectHandler } = await import('./connect.js');
    const result = await providersConnectHandler(['unknown-provider']);

    expect(result.exitCode).toBe(1);
    expect(mockClack.log.error).toHaveBeenCalledWith(
      'Unknown provider: unknown-provider',
    );
  });

  it('requires API key', async () => {
    const { providersConnectHandler } = await import('./connect.js');
    const result = await providersConnectHandler(['openai']);

    expect(result.exitCode).toBe(1);
    expect(mockClack.log.error).toHaveBeenCalledWith('API key is required.');
  });

  it('connects successfully with API key', async () => {
    const mockConfig = {
      config: {
        version: 1,
        defaults: {},
        providers: [],
        agents: [],
      },
    };

    // First call: GET /config
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockConfig),
      } as Response)
      // Second call: PUT /config
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockConfig),
      } as Response);

    const { providersConnectHandler } = await import('./connect.js');
    const result = await providersConnectHandler([
      'openai',
      '--api-key',
      'sk-test',
    ]);

    expect(result.exitCode).toBe(0);
    expect(mockClack.log.success).toHaveBeenCalled();
  });

  it('handles connection failure', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      statusText: 'Server Error',
    } as Response);

    const { providersConnectHandler } = await import('./connect.js');
    const result = await providersConnectHandler([
      'openai',
      '--api-key',
      'sk-invalid',
    ]);

    expect(result.exitCode).toBe(1);
    expect(mockClack.log.error).toHaveBeenCalled();
  });

  it('updates existing provider entry', async () => {
    const mockConfig = {
      config: {
        version: 1,
        defaults: {},
        providers: [
          {
            id: 'openai',
            name: 'OpenAI',
            vendorFamily: 'openai-compatible',
            apiKeyEnv: 'old-key',
            models: [],
          },
        ],
        agents: [],
      },
    };

    // First call: GET /config
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockConfig),
      } as Response)
      // Second call: PUT /config
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockConfig),
      } as Response);

    const { providersConnectHandler } = await import('./connect.js');
    const result = await providersConnectHandler([
      'openai',
      '--api-key',
      'sk-new-key',
    ]);

    expect(result.exitCode).toBe(0);
    expect(mockClack.log.success).toHaveBeenCalled();
  });
});

describe('providers disconnect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('shows help with --help flag', async () => {
    const { providersDisconnectHandler } = await import('./disconnect.js');
    const result = await providersDisconnectHandler(['--help']);

    expect(result.exitCode).toBe(0);
    expect(mockClack.note).toHaveBeenCalled();
    const output = noteOutput();
    expect(output).toContain('Usage: openaidy providers disconnect');
  });

  it('requires provider ID', async () => {
    const { providersDisconnectHandler } = await import('./disconnect.js');
    const result = await providersDisconnectHandler([]);

    expect(result.exitCode).toBe(1);
    expect(mockClack.log.error).toHaveBeenCalledWith(
      'Provider ID is required.',
    );
  });

  it('rejects unknown provider ID', async () => {
    const { providersDisconnectHandler } = await import('./disconnect.js');
    const result = await providersDisconnectHandler(['unknown-provider']);

    expect(result.exitCode).toBe(1);
    expect(mockClack.log.error).toHaveBeenCalledWith(
      'Unknown provider: unknown-provider',
    );
  });

  it('disconnects successfully', async () => {
    const mockConfig = {
      config: {
        version: 1,
        defaults: {},
        providers: [
          {
            id: 'openai',
            name: 'OpenAI',
            vendorFamily: 'openai-compatible',
            apiKeyEnv: 'sk-test-key',
            models: [],
          },
        ],
        agents: [],
      },
    };

    // First call: GET /config
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockConfig),
      } as Response)
      // Second call: PUT /config
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockConfig),
      } as Response);

    const { providersDisconnectHandler } = await import('./disconnect.js');
    const result = await providersDisconnectHandler(['openai']);

    expect(result.exitCode).toBe(0);
    expect(mockClack.log.success).toHaveBeenCalled();
  });

  it('fails when provider not connected', async () => {
    const mockConfig = {
      config: {
        version: 1,
        defaults: {},
        providers: [
          {
            id: 'openai',
            name: 'OpenAI',
            vendorFamily: 'openai-compatible',
            apiKeyEnv: '',
            models: [],
          },
        ],
        agents: [],
      },
    };

    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockConfig),
    } as Response);

    const { providersDisconnectHandler } = await import('./disconnect.js');
    const result = await providersDisconnectHandler(['openai']);

    expect(result.exitCode).toBe(1);
    expect(mockClack.log.error).toHaveBeenCalled();
  });
});
