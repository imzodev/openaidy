import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabaseClient } from '@openaidy/db';
import { DbOAuthStateStore } from './state-store';
import {
  startMiniMaxOAuth,
  exchangeMiniMaxCode,
  refreshMiniMaxToken,
} from './minimax';

/**
 * Unit tests for the MiniMax OAuth helpers.
 *
 * The HTTP layer (fetch to api.minimax.io) is stubbed per test so we
 * don't need network access. The state store and DB use a real tmpfile
 * SQLite so we exercise the real persistence path.
 */

// Set the master key BEFORE importing anything that touches encryption.
process.env.CREDENTIALS_MASTER_KEY =
  'test-master-key-must-be-at-least-32-chars-long-for-tests';

const dbPath = join(tmpdir(), `oauth-minimax-test-${Date.now()}.db`);
let dbConn: Awaited<ReturnType<typeof createDatabaseClient>>;
let stateStore: DbOAuthStateStore;

beforeEach(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'oauth-minimax-'));
  // We rely on the encrypted credential storage writing to a tmpfile too,
  // but it lives in the same conn, so the path here is only for the
  // state store.
  dbConn = await createDatabaseClient({
    kind: 'sqlite',
    sqlitePath: join(dir, 'test.db'),
  });
  stateStore = new DbOAuthStateStore(dbConn.db);
});

afterEach(async () => {
  await dbConn.close();
  rmSync(dbPath, { force: true });
});

// ── startMiniMaxOAuth ──────────────────────────────────────────────────────

describe('startMiniMaxOAuth', () => {
  it('generates an authorization URL with PKCE challenge', async () => {
    const { authorizationUrl, state } = await startMiniMaxOAuth({
      stateStore,
      region: 'global',
      redirectUri: 'http://localhost:3001/callback',
    });

    const url = new URL(authorizationUrl);
    expect(url.host).toBe('api.minimax.io');
    expect(url.pathname).toBe('/oauth/authorize');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    expect(url.searchParams.get('state')).toBe(state);
    expect(url.searchParams.get('redirect_uri')).toBe(
      'http://localhost:3001/callback',
    );
    expect(url.searchParams.get('scope')).toContain('model:read');
  });

  it('uses the China endpoint when region=cn', async () => {
    const { authorizationUrl } = await startMiniMaxOAuth({
      stateStore,
      region: 'cn',
      redirectUri: 'http://localhost:3001/callback',
    });

    const url = new URL(authorizationUrl);
    expect(url.host).toBe('api.minimaxi.com');
  });

  it('persists the verifier in the state store', async () => {
    const { state, authorizationUrl } = await startMiniMaxOAuth({
      stateStore,
      region: 'global',
      redirectUri: 'http://localhost:3001/callback',
    });

    const url = new URL(authorizationUrl);
    const challengeInUrl = url.searchParams.get('code_challenge')!;
    const stored = await stateStore.get(state);
    expect(stored).not.toBeNull();
    expect(stored!.codeChallenge).toBe(challengeInUrl);
    expect(stored!.region).toBe('global');
  });
});

// ── exchangeMiniMaxCode ────────────────────────────────────────────────────

describe('exchangeMiniMaxCode', () => {
  it('returns invalid_or_expired_state for unknown state', async () => {
    const result = await exchangeMiniMaxCode({
      stateStore,
      state: 'nope',
      code: 'code',
      db: dbConn.db,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('invalid_or_expired_state');
    }
  });

  it('exchanges the code and persists encrypted tokens', async () => {
    // 1. Start a flow to get a state + verifier
    const { state } = await startMiniMaxOAuth({
      stateStore,
      region: 'global',
      redirectUri: 'http://localhost:3001/callback',
    });

    // 2. Mock the token endpoint
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: 'access_xyz',
          refresh_token: 'refresh_xyz',
          expires_in: 3600,
          user: { email: 'user@example.com' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    // 3. Exchange
    const result = await exchangeMiniMaxCode({
      stateStore,
      state,
      code: 'auth_code_123',
      db: dbConn.db,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.region).toBe('global');
      expect(result.userHint).toBe('user@example.com');
    }

    // 4. fetch was called with the right URL
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.minimax.io/oauth/token');
    const body = (init as RequestInit).body as URLSearchParams;
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('auth_code_123');
    expect(body.get('code_verifier')).toBeTruthy();
    expect(body.get('redirect_uri')).toBe('http://localhost:3001/callback');

    // 5. State is cleaned up
    const after = await stateStore.get(state);
    expect(after).toBeNull();

    vi.unstubAllGlobals();
  });

  it('returns token_exchange_failed when the provider rejects the code', async () => {
    const { state } = await startMiniMaxOAuth({
      stateStore,
      region: 'global',
      redirectUri: 'http://localhost:3001/callback',
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('invalid_grant', { status: 400 })),
    );

    const result = await exchangeMiniMaxCode({
      stateStore,
      state,
      code: 'bad_code',
      db: dbConn.db,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/token_exchange_failed: 400/);
    }
    vi.unstubAllGlobals();
  });

  it('returns token_exchange_missing_tokens on a partial response', async () => {
    const { state } = await startMiniMaxOAuth({
      stateStore,
      region: 'global',
      redirectUri: 'http://localhost:3001/callback',
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ access_token: 'only_access' }), // no refresh_token
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    const result = await exchangeMiniMaxCode({
      stateStore,
      state,
      code: 'code',
      db: dbConn.db,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('token_exchange_missing_tokens');
    }
    vi.unstubAllGlobals();
  });
});

// ── refreshMiniMaxToken ────────────────────────────────────────────────────

describe('refreshMiniMaxToken', () => {
  it('returns null when the provider rejects the refresh', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('invalid_grant', { status: 400 })),
    );

    const result = await refreshMiniMaxToken({
      db: dbConn.db,
      refreshToken: 'expired',
      region: 'global',
    });
    expect(result).toBeNull();
    vi.unstubAllGlobals();
  });

  it('returns fresh tokens on success and re-persists them', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            access_token: 'new_access',
            refresh_token: 'new_refresh',
            expires_in: 7200,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    const result = await refreshMiniMaxToken({
      db: dbConn.db,
      refreshToken: 'old_refresh',
      region: 'global',
    });

    expect(result).not.toBeNull();
    expect(result!.accessToken).toBe('new_access');
    expect(result!.refreshToken).toBe('new_refresh');
    expect(result!.expiresAt).toBeGreaterThan(Date.now());
    vi.unstubAllGlobals();
  });
});
