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

  it('fetches and displays providers', async () => {
    const mockProviders = {
      providers: [
        {
          id: 'openai',
          displayName: 'OpenAI',
          availableAuthMethods: [{ type: 'api_key', label: 'API Key' }],
          isConnected: true,
        },
        {
          id: 'anthropic',
          displayName: 'Anthropic',
          availableAuthMethods: [{ type: 'api_key', label: 'API Key' }],
          isConnected: false,
        },
      ],
    };

    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockProviders),
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
    expect(result.error).toContain('Failed to fetch providers');
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

  it('requires API key', async () => {
    const { providersConnectHandler } = await import('./connect.js');
    const result = await providersConnectHandler(['openai']);

    expect(result.exitCode).toBe(1);
    expect(mockClack.log.error).toHaveBeenCalledWith('API key is required.');
  });

  it('connects successfully with API key', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true }),
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
      ok: true,
      json: () => Promise.resolve({ success: false, error: 'Invalid API key' }),
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

  it('disconnects successfully', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    } as Response);

    const { providersDisconnectHandler } = await import('./disconnect.js');
    const result = await providersDisconnectHandler(['openai']);

    expect(result.exitCode).toBe(0);
    expect(mockClack.log.success).toHaveBeenCalled();
  });
});

describe('providers status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('shows help with --help flag', async () => {
    const { providersStatusHandler } = await import('./status.js');
    const result = await providersStatusHandler(['--help']);

    expect(result.exitCode).toBe(0);
    expect(mockClack.note).toHaveBeenCalled();
    const output = noteOutput();
    expect(output).toContain('Usage: openaidy providers status');
  });

  it('shows connection status', async () => {
    const mockProviders = {
      providers: [
        { id: 'openai', displayName: 'OpenAI', isConnected: true },
        { id: 'anthropic', displayName: 'Anthropic', isConnected: false },
      ],
    };

    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockProviders),
    } as Response);

    const { providersStatusHandler } = await import('./status.js');
    const result = await providersStatusHandler([]);

    expect(result.exitCode).toBe(0);
    expect(mockClack.log.success).toHaveBeenCalledWith('Connected Providers:');
    expect(mockClack.log.warning).toHaveBeenCalledWith(
      'Disconnected Providers:',
    );
  });
});

describe('providers auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('shows help with --help flag', async () => {
    const { providersAuthHandler } = await import('./auth.js');
    const result = await providersAuthHandler(['--help']);

    expect(result.exitCode).toBe(0);
    expect(mockClack.note).toHaveBeenCalled();
    const output = noteOutput();
    expect(output).toContain('Usage: openaidy providers auth');
  });

  it('requires provider ID', async () => {
    const { providersAuthHandler } = await import('./auth.js');
    const result = await providersAuthHandler([]);

    expect(result.exitCode).toBe(1);
    expect(mockClack.log.error).toHaveBeenCalledWith(
      'Provider ID is required.',
    );
  });

  it('shows auth methods for provider', async () => {
    const mockAuthMethods = {
      providerId: 'openai',
      authMethods: [
        { type: 'api_key', label: 'API Key' },
        { type: 'oauth', label: 'OAuth' },
      ],
    };

    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockAuthMethods),
    } as Response);

    const { providersAuthHandler } = await import('./auth.js');
    const result = await providersAuthHandler(['openai']);

    expect(result.exitCode).toBe(0);
    expect(mockClack.log.info).toHaveBeenCalled();
  });
});
