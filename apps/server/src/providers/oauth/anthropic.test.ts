import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createDatabaseClient,
  ProviderCredentialsRepository,
} from '@openaidy/db';
import { DbOAuthStateStore } from './state-store';
import {
  startAnthropicOAuth,
  completeAnthropicOAuth,
  refreshAnthropicToken,
} from './anthropic';

// Set master key BEFORE importing anything that touches encryption.
process.env.CREDENTIALS_MASTER_KEY = 'test-master-key-at-least-32-chars-long';

import { getEncryptionService } from '../../lib/encryption';

let dir: string;
let dbConn: Awaited<ReturnType<typeof createDatabaseClient>>;
let stateStore: DbOAuthStateStore;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'oauth-anthropic-'));
  dbConn = await createDatabaseClient({
    kind: 'sqlite',
    sqlitePath: join(dir, 'test.db'),
  });
  stateStore = new DbOAuthStateStore(dbConn.db);
});

afterEach(async () => {
  await dbConn.close();
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function mockFetchOnce(status: number, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    })),
  );
}

// ── startAnthropicOAuth ──────────────────────────────────────────────────

describe('startAnthropicOAuth', () => {
  it('persists a PKCE state row and returns a well-formed authorization URL', async () => {
    const result = await startAnthropicOAuth({ stateStore });

    const url = new URL(result.authorizationUrl);
    expect(url.origin + url.pathname).toBe('https://claude.ai/oauth/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe(
      '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
    );
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBe(result.state);
    expect(url.searchParams.get('code_challenge')).toBeTruthy();

    const stored = await stateStore.get(result.state);
    expect(stored).not.toBeNull();
    expect(stored!.providerId).toBe('anthropic');
    expect(stored!.codeVerifier).toBeTruthy();
    expect(stored!.codeChallenge).toBe(url.searchParams.get('code_challenge'));
  });

  it('generates a unique state and verifier on each call', async () => {
    const a = await startAnthropicOAuth({ stateStore });
    const b = await startAnthropicOAuth({ stateStore });
    expect(a.state).not.toBe(b.state);
  });
});

// ── completeAnthropicOAuth ───────────────────────────────────────────────

describe('completeAnthropicOAuth', () => {
  it('fails cleanly for an unknown/expired state', async () => {
    const result = await completeAnthropicOAuth({
      stateStore,
      db: dbConn.db,
      code: 'some-code',
      state: 'no-such-state',
    });
    expect(result.success).toBe(false);
  });

  it('exchanges the code and persists an oauth credential row', async () => {
    const { state } = await startAnthropicOAuth({ stateStore });

    mockFetchOnce(200, {
      access_token: 'access_123',
      refresh_token: 'refresh_123',
      expires_in: 3600,
      scope: 'user:inference',
    });

    const onCredentialPersisted = vi.fn();
    const result = await completeAnthropicOAuth({
      stateStore,
      db: dbConn.db,
      code: 'auth-code',
      state,
      onCredentialPersisted,
    });

    expect(result.success).toBe(true);
    expect(onCredentialPersisted).toHaveBeenCalledWith('anthropic');

    const repo = new ProviderCredentialsRepository(dbConn.db);
    const row = await repo.findByProviderId('anthropic');
    expect(row).not.toBeNull();
    expect(row!.authMethod).toBe('oauth');
    expect(row!.status).toBe('connected');

    const decrypted = JSON.parse(
      getEncryptionService().decrypt(row!.encryptedCredentials),
    );
    expect(decrypted.accessToken).toBe('access_123');
    expect(decrypted.refreshToken).toBe('refresh_123');
    expect(typeof decrypted.expiresAt).toBe('number');
  });

  it('consumes the state so it cannot be replayed', async () => {
    const { state } = await startAnthropicOAuth({ stateStore });
    mockFetchOnce(200, {
      access_token: 'access_1',
      refresh_token: 'refresh_1',
      expires_in: 3600,
    });

    await completeAnthropicOAuth({
      stateStore,
      db: dbConn.db,
      code: 'c1',
      state,
    });

    mockFetchOnce(200, {
      access_token: 'access_2',
      refresh_token: 'refresh_2',
      expires_in: 3600,
    });
    const replay = await completeAnthropicOAuth({
      stateStore,
      db: dbConn.db,
      code: 'c2',
      state,
    });
    expect(replay.success).toBe(false);
  });

  it('reports failure when the token endpoint rejects the code', async () => {
    const { state } = await startAnthropicOAuth({ stateStore });
    mockFetchOnce(400, { error: 'invalid_grant' });

    const result = await completeAnthropicOAuth({
      stateStore,
      db: dbConn.db,
      code: 'bad-code',
      state,
    });
    expect(result.success).toBe(false);
  });
});

// ── refreshAnthropicToken ─────────────────────────────────────────────────

describe('refreshAnthropicToken', () => {
  it('returns new tokens on a successful refresh', async () => {
    mockFetchOnce(200, {
      access_token: 'new_access',
      refresh_token: 'new_refresh',
      expires_in: 3600,
    });

    const tokens = await refreshAnthropicToken({ refreshToken: 'old_refresh' });
    expect(tokens).not.toBeNull();
    expect(tokens!.accessToken).toBe('new_access');
    expect(tokens!.refreshToken).toBe('new_refresh');
  });

  it('falls back to the existing refresh token when none is returned', async () => {
    mockFetchOnce(200, { access_token: 'new_access', expires_in: 3600 });

    const tokens = await refreshAnthropicToken({ refreshToken: 'old_refresh' });
    expect(tokens!.refreshToken).toBe('old_refresh');
  });

  it('returns null when the refresh request fails', async () => {
    mockFetchOnce(401, { error: 'invalid_grant' });

    const tokens = await refreshAnthropicToken({ refreshToken: 'stale' });
    expect(tokens).toBeNull();
  });

  it('returns null when fetch throws', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );

    const tokens = await refreshAnthropicToken({ refreshToken: 'x' });
    expect(tokens).toBeNull();
  });
});
