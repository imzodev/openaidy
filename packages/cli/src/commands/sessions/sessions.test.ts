/**
 * Sessions Command Integration Tests
 *
 * Tests sessions command handlers by mocking:
 * - The admin-token module (avoids file-system setup)
 * - The global fetch call (avoids real HTTP)
 * - @clack/prompts (captures terminal output)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// 1. Mock @clack/prompts
// ---------------------------------------------------------------------------

const mockClack = vi.hoisted(() => ({
  log: { error: vi.fn(), success: vi.fn() },
  note: vi.fn(),
  outro: vi.fn(),
  spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
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
// 3. Helpers
// ---------------------------------------------------------------------------

function noteOutput(): string {
  return mockClack.note.mock.calls
    .map((c: unknown[]) => c[0] as string)
    .join('\n');
}

function errorOutput(): string {
  return mockClack.log.error.mock.calls
    .map((c: unknown[]) => c[0] as string)
    .join('\n');
}

// ---------------------------------------------------------------------------
// 4. Mock fetch
// ---------------------------------------------------------------------------

function mockFetchJson(data: unknown, status = 200) {
  return vi.fn(() =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(data),
    }),
  ) as unknown as typeof fetch;
}

// ---------------------------------------------------------------------------
// 5. Set up fake env for server URL
// ---------------------------------------------------------------------------

const originalServerUrl = process.env.OPENAIDY_SERVER_URL;

beforeEach(() => {
  vi.clearAllMocks();
  mockClack.spinner.mockReturnValue({ start: vi.fn(), stop: vi.fn() });
  process.env.OPENAIDY_SERVER_URL = 'http://localhost:3001';
});

afterEach(() => {
  process.env.OPENAIDY_SERVER_URL = originalServerUrl ?? '';
});

// ---------------------------------------------------------------------------
// 6. Import handlers after mocks are set up
// ---------------------------------------------------------------------------

const { sessionsListHandler } = await import('./list.js');
const { sessionsGetHandler } = await import('./get.js');
const { sessionsCreateHandler } = await import('./create.js');
const { sessionsMessagesHandler } = await import('./messages.js');
const { sessionsRunsHandler } = await import('./runs.js');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('sessions list', () => {
  it('shows help with --help', async () => {
    const result = await sessionsListHandler(['--help']);
    expect(result.exitCode).toBe(0);
    expect(noteOutput()).toContain('openaidy sessions list');
  });

  it('lists sessions successfully', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchJson({
        items: [
          {
            id: 'sess-1',
            title: 'Session One',
            createdAt: '2026-01-01T10:00:00Z',
          },
          {
            id: 'sess-2',
            title: 'Session Two',
            createdAt: '2026-01-02T10:00:00Z',
          },
        ],
      }),
    );

    const result = await sessionsListHandler([]);

    expect(result.exitCode).toBe(0);
    expect(noteOutput()).toContain('Session One');
    expect(noteOutput()).toContain('Session Two');
    expect(noteOutput()).toContain('sess-1');
  });

  it('shows empty state when no sessions', async () => {
    vi.stubGlobal('fetch', mockFetchJson({ items: [] }));

    const result = await sessionsListHandler([]);

    expect(result.exitCode).toBe(0);
    expect(noteOutput()).toContain('No sessions found');
  });

  it('returns error when server unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))),
    );

    const result = await sessionsListHandler([]);

    expect(result.exitCode).toBe(1);
    expect(errorOutput()).toContain('ECONNREFUSED');
  });

  it('returns error when server returns non-OK', async () => {
    vi.stubGlobal('fetch', mockFetchJson({ error: 'Unauthorized' }, 401));

    const result = await sessionsListHandler([]);

    expect(result.exitCode).toBe(1);
  });

  it('respects --limit flag', async () => {
    const items = Array.from({ length: 20 }, (_, i) => ({
      id: `sess-${i}`,
      title: `Session ${i}`,
      createdAt: new Date().toISOString(),
    }));
    vi.stubGlobal('fetch', mockFetchJson({ items }));

    const result = await sessionsListHandler(['--limit', '3']);

    expect(result.exitCode).toBe(0);
    // Only 3 sessions should appear in the output
    expect(noteOutput()).toContain('sess-0');
    expect(noteOutput()).not.toContain('sess-3');
  });
});

describe('sessions get', () => {
  it('shows help with --help', async () => {
    const result = await sessionsGetHandler(['--help']);
    expect(result.exitCode).toBe(0);
    expect(noteOutput()).toContain('openaidy sessions get');
  });

  it('returns exit code 2 when session ID missing', async () => {
    const result = await sessionsGetHandler([]);
    expect(result.exitCode).toBe(2);
    expect(result.error).toContain('Session ID');
  });

  it('shows session details for valid ID', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchJson({
        id: 'sess-001',
        title: 'My Session',
        createdAt: '2026-01-01T10:00:00Z',
        updatedAt: '2026-01-01T12:00:00Z',
      }),
    );

    const result = await sessionsGetHandler(['sess-001']);

    expect(result.exitCode).toBe(0);
    expect(noteOutput()).toContain('My Session');
    expect(noteOutput()).toContain('sess-001');
  });

  it('returns exit code 1 for 404', async () => {
    vi.stubGlobal('fetch', mockFetchJson({ error: 'Session not found' }, 404));

    const result = await sessionsGetHandler(['nonexistent']);

    expect(result.exitCode).toBe(1);
    expect(result.error).toContain('Session not found');
  });
});

describe('sessions create', () => {
  it('shows help with --help', async () => {
    const result = await sessionsCreateHandler(['--help']);
    expect(result.exitCode).toBe(0);
    expect(noteOutput()).toContain('openaidy sessions create');
  });

  it('creates session with provided title', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchJson({ id: 'sess-new', title: 'My New Session' }, 201),
    );

    const result = await sessionsCreateHandler(['My New Session']);

    expect(result.exitCode).toBe(0);
    expect(mockClack.log.success).toHaveBeenCalled();
  });

  it('creates session with default title when none provided', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchJson({ id: 'sess-new', title: 'New Session' }, 201),
    );

    const result = await sessionsCreateHandler([]);

    expect(result.exitCode).toBe(0);
    const fetchCalls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls;
    const lastCall = fetchCalls[fetchCalls.length - 1] as [string, RequestInit];
    expect(JSON.parse(lastCall[1].body as string)).toEqual({
      title: 'New Session',
    });
  });

  it('returns error on server failure', async () => {
    vi.stubGlobal('fetch', mockFetchJson({ error: 'Bad Request' }, 400));

    const result = await sessionsCreateHandler(['Bad Session']);

    expect(result.exitCode).toBe(1);
  });
});

describe('sessions messages', () => {
  it('shows help with --help', async () => {
    const result = await sessionsMessagesHandler(['--help']);
    expect(result.exitCode).toBe(0);
    expect(noteOutput()).toContain('openaidy sessions messages');
  });

  it('returns exit code 2 when session ID missing', async () => {
    const result = await sessionsMessagesHandler([]);
    expect(result.exitCode).toBe(2);
  });

  it('lists messages for a session', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchJson({
        items: [
          {
            id: 'msg-1',
            role: 'user',
            content: 'Hello',
            sessionId: 'sess-001',
            sequence: 1,
            createdAt: '2026-01-01T10:00:00Z',
          },
          {
            id: 'msg-2',
            role: 'assistant',
            content: 'Hi there!',
            sessionId: 'sess-001',
            sequence: 2,
            createdAt: '2026-01-01T10:00:01Z',
          },
        ],
      }),
    );

    const result = await sessionsMessagesHandler(['sess-001']);

    expect(result.exitCode).toBe(0);
    expect(noteOutput()).toContain('Hello');
    expect(noteOutput()).toContain('[User]');
    expect(noteOutput()).toContain('[Assistant]');
    expect(noteOutput()).toContain('Hi there!');
  });

  it('shows empty state when no messages', async () => {
    vi.stubGlobal('fetch', mockFetchJson({ items: [] }));

    const result = await sessionsMessagesHandler(['sess-001']);

    expect(result.exitCode).toBe(0);
    expect(noteOutput()).toContain('No messages');
  });

  it('returns exit code 1 for 404', async () => {
    vi.stubGlobal('fetch', mockFetchJson({ error: 'Session not found' }, 404));

    const result = await sessionsMessagesHandler(['nonexistent']);

    expect(result.exitCode).toBe(1);
  });
});

describe('sessions runs', () => {
  it('shows help with --help', async () => {
    const result = await sessionsRunsHandler(['--help']);
    expect(result.exitCode).toBe(0);
    expect(noteOutput()).toContain('openaidy sessions runs');
  });

  it('returns exit code 2 when session ID missing', async () => {
    const result = await sessionsRunsHandler([]);
    expect(result.exitCode).toBe(2);
  });

  it('lists runs for a session', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchJson({
        items: [
          {
            id: 'run-1',
            status: 'succeeded',
            providerId: 'openai',
            modelId: 'gpt-4o',
            durationMs: 500,
            createdAt: '2026-01-01T10:00:00Z',
          },
          {
            id: 'run-2',
            status: 'failed',
            error: 'Rate limited',
            createdAt: '2026-01-01T10:01:00Z',
          },
        ],
      }),
    );

    const result = await sessionsRunsHandler(['sess-001']);

    expect(result.exitCode).toBe(0);
    expect(noteOutput()).toContain('✓');
    expect(noteOutput()).toContain('✗');
    expect(noteOutput()).toContain('openai');
    expect(noteOutput()).toContain('gpt-4o');
    expect(noteOutput()).toContain('500ms');
  });

  it('shows empty state when no runs', async () => {
    vi.stubGlobal('fetch', mockFetchJson({ items: [] }));

    const result = await sessionsRunsHandler(['sess-001']);

    expect(result.exitCode).toBe(0);
    expect(noteOutput()).toContain('No runs');
  });

  it('returns exit code 1 for 404', async () => {
    vi.stubGlobal('fetch', mockFetchJson({ error: 'Session not found' }, 404));

    const result = await sessionsRunsHandler(['nonexistent']);

    expect(result.exitCode).toBe(1);
  });
});
