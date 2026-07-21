import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabaseClient } from '@openaidy/db';
import { DbOAuthStateStore } from './state-store';
import { startMiniMaxOAuth, getMiniMaxOAuthStatus } from './minimax';
import { type MmxLoginHandle } from './mmx-bridge';
import { type CliOAuthResult } from './cli-bridge';

// Set master key BEFORE importing anything that touches encryption.
process.env.CREDENTIALS_MASTER_KEY = 'test-m...ests';

/**
 * Tests for the MiniMax OAuth flow.
 *
 * The flow is now backed by the official `mmx-cli` subprocess
 * (we cannot hit MiniMax's auth endpoints directly — they require a
 * privileged client_id). These tests mock the mmx subprocess via
 * module-spy on `spawnMmxLogin` and verify the rest of the wiring
 * (state store, encryption, provider_credentials persistence).
 */

// Mock the mmx-bridge module so we don't actually spawn mmx
vi.mock('./mmx-bridge', () => {
  return {
    isMmxInstalled: vi.fn(async () => true),
    spawnMmxLogin: vi.fn(),
    readMmxTokens: vi.fn(() => null),
    clearMmxTokens: vi.fn(async () => undefined),
    getMmxConfigPath: vi.fn(() => '/tmp/fake-mmx/config.json'),
    getCurrentOsUser: vi.fn(() => 'tester'),
  };
});

// Import the mocked module so we can spy on the functions
import * as mmxBridge from './mmx-bridge';
const mockedMmx = vi.mocked(mmxBridge);

const dbPath = join(tmpdir(), `oauth-minimax-test-${Date.now()}.db`);
let dbConn: Awaited<ReturnType<typeof createDatabaseClient>>;
let stateStore: DbOAuthStateStore;

beforeEach(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'oauth-minimax-'));
  dbConn = await createDatabaseClient({
    kind: 'sqlite',
    sqlitePath: join(dir, 'test.db'),
  });
  stateStore = new DbOAuthStateStore(dbConn.db);
});

afterEach(async () => {
  await dbConn.close();
  rmSync(dbPath, { force: true });
  vi.clearAllMocks();
});

// ── startMiniMaxOAuth ──────────────────────────────────────────────────────

describe('startMiniMaxOAuth', () => {
  it('returns mmx_not_installed if mmx-cli is missing', async () => {
    mockedMmx.isMmxInstalled.mockResolvedValueOnce(false);
    const result = await startMiniMaxOAuth({
      stateStore,
      region: 'global',
      flowId: 'flow-1',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('mmx_not_installed');
    }
  });

  it('persists flow state and returns the verification URL', async () => {
    // Mock the spawn handle: user_code resolves immediately, done
    // never resolves within the test scope.
    const fakeHandle: MmxLoginHandle = {
      userCode: Promise.resolve('ABCD-1234'),
      verificationUrl: Promise.resolve(
        'https://platform.minimax.io/oauth-authorize?user_code=ABCD-1234&client=OpenAidy',
      ),
      done: new Promise<CliOAuthResult>(() => undefined), // never resolves in test
      cancel: vi.fn(),
    };
    mockedMmx.spawnMmxLogin.mockReturnValueOnce(fakeHandle);

    const result = await startMiniMaxOAuth({
      stateStore,
      region: 'cn',
      flowId: 'flow-cn-1',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.verificationUrl).toContain('user_code=ABCD-1234');
      expect(result.verificationUrl).toContain('client=OpenAidy');
      expect(result.flowId).toBe('flow-cn-1');
    }

    // State was persisted
    const stored = await stateStore.get('flow-cn-1');
    expect(stored).not.toBeNull();
    expect(stored!.region).toBe('cn');
  });

  it('returns an empty URL if mmx fails to print user_code within the timeout', async () => {
    // user_code rejects immediately to keep the test fast
    // (the test would otherwise wait the full 30s timeout).
    const fakeHandle: MmxLoginHandle = {
      userCode: new Promise<string>((_, rej) => {
        setImmediate(() => rej(new Error('mmx_slow')));
      }),
      verificationUrl: new Promise<string>(() => undefined),
      done: new Promise<CliOAuthResult>(() => undefined),
      cancel: vi.fn(),
    };
    mockedMmx.spawnMmxLogin.mockReturnValueOnce(fakeHandle);

    const result = await startMiniMaxOAuth({
      stateStore,
      region: 'global',
      flowId: 'flow-slow',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Empty URL — the frontend should NOT open a popup. Instead
      // it polls /status and waits for the user_code to appear
      // there (mmx is still alive in the background and will
      // print the code eventually, which the state-store updater
      // picks up).
      expect(result.verificationUrl).toBe('');
    }
  });
});

// ── getMiniMaxOAuthStatus ────────────────────────────────────────────────

describe('getMiniMaxOAuthStatus', () => {
  it('returns not_found for an unknown flowId', async () => {
    const result = await getMiniMaxOAuthStatus({
      stateStore,
      flowId: 'no-such-flow',
    });
    expect(result.ok).toBe(false);
  });

  it('returns pending when mmx has not written tokens yet', async () => {
    await stateStore.put('flow-active', {
      providerId: 'minimax',
      codeVerifier: '',
      codeChallenge: 'WXYZ-9876',
      region: 'global',
      redirectUri: '',
      createdAt: Date.now(),
    });
    mockedMmx.readMmxTokens.mockReturnValueOnce(null);

    const result = await getMiniMaxOAuthStatus({
      stateStore,
      flowId: 'flow-active',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe('pending');
      expect(result.userCode).toBe('WXYZ-9876');
      expect(result.verificationUrl).toContain('user_code=WXYZ-9876');
      expect(result.verificationUrl).toContain('client=OpenAidy');
    }
  });

  it('returns authorized when mmx has written tokens', async () => {
    await stateStore.put('flow-done', {
      providerId: 'minimax',
      codeVerifier: '',
      codeChallenge: 'LMNO-4321',
      region: 'cn',
      redirectUri: '',
      createdAt: Date.now(),
    });
    mockedMmx.readMmxTokens.mockReturnValueOnce({
      access_token: 'access_xyz',
      refresh_token: 'refresh_xyz',
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      region: 'cn',
    });

    const result = await getMiniMaxOAuthStatus({
      stateStore,
      flowId: 'flow-done',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe('authorized');
      expect(result.userCode).toBe('LMNO-4321');
    }
  });
});
