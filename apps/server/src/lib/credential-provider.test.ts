import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createDatabaseClient,
  ProviderCredentialsRepository,
} from '@openaidy/db';

// Set master key BEFORE importing anything that touches encryption.
process.env.CREDENTIALS_MASTER_KEY = 'test-master-key-at-least-32-chars-long';

import { getEncryptionService } from './encryption';
import {
  buildCredentialResolver,
  type TokenRefresher,
} from './credential-provider';

let dir: string;
let dbConn: Awaited<ReturnType<typeof createDatabaseClient>>;
let repo: ProviderCredentialsRepository;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'credential-provider-'));
  dbConn = await createDatabaseClient({
    kind: 'sqlite',
    sqlitePath: join(dir, 'test.db'),
  });
  repo = new ProviderCredentialsRepository(dbConn.db);
});

afterEach(async () => {
  await dbConn.close();
  rmSync(dir, { recursive: true, force: true });
  vi.clearAllMocks();
});

async function putOAuthCredential(
  providerId: string,
  tokens: { accessToken: string; refreshToken: string; expiresAt: number },
): Promise<void> {
  const encrypted = getEncryptionService().encrypt(JSON.stringify(tokens));
  await repo.upsert(providerId, 'oauth', encrypted);
}

describe('buildCredentialResolver', () => {
  it('returns the bare key for an api_key row, untouched', async () => {
    const encrypted = getEncryptionService().encrypt('sk-test-123');
    await repo.upsert('openai', 'api_key', encrypted);

    const resolver = buildCredentialResolver(dbConn.db)!;
    expect(await resolver('openai')).toBe('sk-test-123');
  });

  it('returns null for an unconnected provider', async () => {
    const resolver = buildCredentialResolver(dbConn.db)!;
    expect(await resolver('does-not-exist')).toBeNull();
  });

  it('returns the access token for an oauth row with plenty of time left', async () => {
    await putOAuthCredential('anthropic', {
      accessToken: 'access_fresh',
      refreshToken: 'refresh_fresh',
      expiresAt: Date.now() + 3600_000,
    });

    const refresher: TokenRefresher = vi.fn();
    const resolver = buildCredentialResolver(dbConn.db, {
      refreshers: { anthropic: refresher },
    })!;

    expect(await resolver('anthropic')).toBe('access_fresh');
    expect(refresher).not.toHaveBeenCalled();
  });

  it('transparently refreshes a near-expiry token and persists the result', async () => {
    await putOAuthCredential('anthropic', {
      accessToken: 'access_old',
      refreshToken: 'refresh_old',
      expiresAt: Date.now() + 1_000, // inside the refresh margin
    });

    const refresher: TokenRefresher = vi.fn(async () => ({
      accessToken: 'access_new',
      refreshToken: 'refresh_new',
      expiresAt: Date.now() + 3600_000,
    }));
    const resolver = buildCredentialResolver(dbConn.db, {
      refreshers: { anthropic: refresher },
    })!;

    expect(await resolver('anthropic')).toBe('access_new');
    expect(refresher).toHaveBeenCalledWith('refresh_old');

    // Persisted to the DB, not just returned in-memory.
    const row = await repo.findByProviderId('anthropic');
    const decrypted = JSON.parse(
      getEncryptionService().decrypt(row!.encryptedCredentials),
    );
    expect(decrypted.accessToken).toBe('access_new');

    // Second call hits the in-process cache, not the refresher again.
    expect(await resolver('anthropic')).toBe('access_new');
    expect(refresher).toHaveBeenCalledTimes(1);
  });

  it('marks the credential as errored and returns null when refresh fails', async () => {
    await putOAuthCredential('anthropic', {
      accessToken: 'access_old',
      refreshToken: 'refresh_old',
      expiresAt: Date.now() + 1_000,
    });

    const refresher: TokenRefresher = vi.fn(async () => null);
    const resolver = buildCredentialResolver(dbConn.db, {
      refreshers: { anthropic: refresher },
    })!;

    expect(await resolver('anthropic')).toBeNull();

    const row = await repo.findByProviderId('anthropic');
    expect(row!.status).toBe('error');
  });

  it('invalidate() drops the cache so the next resolve re-reads the DB', async () => {
    await putOAuthCredential('anthropic', {
      accessToken: 'access_1',
      refreshToken: 'refresh_1',
      expiresAt: Date.now() + 3600_000,
    });

    const resolver = buildCredentialResolver(dbConn.db)!;
    expect(await resolver('anthropic')).toBe('access_1');

    await putOAuthCredential('anthropic', {
      accessToken: 'access_2',
      refreshToken: 'refresh_2',
      expiresAt: Date.now() + 3600_000,
    });
    // Still cached — the write above didn't go through this resolver.
    expect(await resolver('anthropic')).toBe('access_1');

    resolver.invalidate('anthropic');
    expect(await resolver('anthropic')).toBe('access_2');
  });

  describe('resolveAuthMethod', () => {
    it('reports the auth method of a connected credential', async () => {
      await repo.upsert(
        'openai',
        'api_key',
        getEncryptionService().encrypt('sk-test'),
      );
      await putOAuthCredential('anthropic', {
        accessToken: 'a',
        refreshToken: 'r',
        expiresAt: Date.now() + 3600_000,
      });

      const resolver = buildCredentialResolver(dbConn.db)!;
      expect(await resolver.resolveAuthMethod('openai')).toBe('api_key');
      expect(await resolver.resolveAuthMethod('anthropic')).toBe('oauth');
    });

    it('returns null for a provider with no stored credential', async () => {
      const resolver = buildCredentialResolver(dbConn.db)!;
      expect(await resolver.resolveAuthMethod('does-not-exist')).toBeNull();
    });
  });
});
