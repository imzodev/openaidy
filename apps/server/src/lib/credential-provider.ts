/**
 * Provider Credential Resolver
 *
 * Builds a callback that resolves the current credential for a
 * provider at request time. Used by the OpenAI-compatible adapter
 * to set a fresh `Authorization: Bearer …` header on every outgoing
 * request, so providers authenticated via the OAuth/API-key connect
 * flows (which persist the credential to `provider_credentials`
 * after server startup) actually reach the upstream API.
 *
 * Credentials are memoised in-process: the first request for a
 * given provider hits the DB, subsequent requests use the cached
 * value. The cache is invalidated explicitly via
 * `invalidateCredential()` whenever the credential is written or
 * the connection is dropped — credentials don't change on their
 * own except via the refresh below, so a TTL would just add a
 * window where a freshly-changed credential is ignored.
 *
 * - `api_key` rows store the bare key as ciphertext → returned as-is
 * - `oauth` / `device_code` rows store a JSON object with
 *   `{ accessToken, refreshToken, expiresAt, ... }` → `accessToken`
 *   is returned, transparently refreshed first if it's about to
 *   expire and a `TokenRefresher` was registered for that provider
 *   (see the `refreshers` option)
 *
 * Returns `null` ("no override — use the SDK default") when no row
 * exists for the provider, the row is in a non-connected state, or
 * the cached lookup failed previously.
 */

import {
  ProviderCredentialsRepository,
  type DatabaseClient,
} from '@openaidy/db';
import { getEncryptionService } from './encryption';
import { createLogger } from './logger';
import type {
  AuthMethodProvider,
  AuthMethodType,
  CredentialInvalidator,
  CredentialProvider,
} from '@openaidy/shared-types';

const log = createLogger('credential-provider');

/** Refresh an expiring OAuth/device-code token for one provider. */
export type TokenRefresher = (refreshToken: string) => Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
} | null>;

/**
 * Refresh an access token this far ahead of its expiry, so a chat
 * call that's already in flight doesn't race a token that expires
 * mid-request.
 */
const REFRESH_MARGIN_MS = 60_000;

export type CredentialResolver = CredentialProvider & {
  /**
   * Drop the cached credential for a provider so the next request
   * re-reads it from the DB. Call this whenever a credential is
   * upserted, refreshed, or its connection is torn down.
   */
  invalidate: (providerId: string) => void;
  /**
   * Which auth method (`api_key` / `oauth` / `device_code`) the
   * provider's stored credential was connected with. Needed by
   * adapters (Anthropic) that send a different request shape for
   * an OAuth bearer token than for an API key — `resolve()` alone
   * only returns the token value, not how it was obtained.
   */
  resolveAuthMethod: AuthMethodProvider;
};

export function buildCredentialResolver(
  db: DatabaseClient | undefined,
  options: { refreshers?: Record<string, TokenRefresher> } = {},
): CredentialResolver | undefined {
  if (!db) {
    return undefined;
  }

  const credentialsRepo = new ProviderCredentialsRepository(db);
  const encryption = getEncryptionService();
  const cache = new Map<string, string | null>();
  const refreshers = options.refreshers ?? {};

  const resolve = async (providerId: string): Promise<string | null> => {
    if (cache.has(providerId)) {
      return cache.get(providerId) ?? null;
    }
    try {
      const row = await credentialsRepo.findByProviderId(providerId);
      if (!row || row.status !== 'connected') {
        cache.set(providerId, null);
        return null;
      }

      const decrypted = encryption.decrypt(row.encryptedCredentials);
      if (row.authMethod !== 'oauth' && row.authMethod !== 'device_code') {
        cache.set(providerId, decrypted);
        return decrypted;
      }

      const tokens = JSON.parse(decrypted) as {
        accessToken?: string;
        refreshToken?: string;
        expiresAt?: number;
      };

      const refresher = refreshers[providerId];
      const isExpiring =
        typeof tokens.expiresAt === 'number' &&
        tokens.expiresAt - Date.now() < REFRESH_MARGIN_MS;

      if (refresher && tokens.refreshToken && isExpiring) {
        const refreshed = await refresher(tokens.refreshToken);
        if (!refreshed) {
          log.warn(
            `credentialProvider: token refresh failed for "${providerId}" — marking credential as errored`,
          );
          await credentialsRepo.setError(providerId, 'oauth_refresh_failed');
          cache.set(providerId, null);
          return null;
        }
        const reencrypted = encryption.encrypt(JSON.stringify(refreshed));
        await credentialsRepo.upsert(providerId, row.authMethod, reencrypted);
        cache.set(providerId, refreshed.accessToken);
        return refreshed.accessToken;
      }

      const value = tokens.accessToken ?? null;
      cache.set(providerId, value);
      return value;
    } catch (err) {
      log.warn(
        `credentialProvider: failed to resolve credential for "${providerId}": ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      // Do not cache failures — a transient error (DB blip) shouldn't
      // pin the resolver to "no credential" for the rest of the run.
      return null;
    }
  };

  const invalidate = (providerId: string): void => {
    cache.delete(providerId);
  };

  const resolveAuthMethod = async (
    providerId: string,
  ): Promise<AuthMethodType | null> => {
    try {
      const row = await credentialsRepo.findByProviderId(providerId);
      if (!row || row.status !== 'connected') {
        return null;
      }
      return row.authMethod as AuthMethodType;
    } catch (err) {
      log.warn(
        `credentialProvider: failed to resolve auth method for "${providerId}": ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  };

  return Object.assign(resolve, { invalidate, resolveAuthMethod });
}

/**
 * Standalone invalidator wired to the same cache as the resolver
 * passed to the OpenAI-compatible adapter. Call this from the
 * credential-write paths (connect API-key, complete OAuth,
 * disconnect) so the in-memory cache stays in sync with the DB.
 *
 * Implemented as a no-op when no resolver is in use (e.g. tests,
 * or servers running without a DB).
 */
export function noopInvalidator(): CredentialInvalidator {
  return () => {};
}

/**
 * Backwards-compatible alias for callers that just need a plain
 * `CredentialProvider` (e.g. tests, or callers that don't need
 * invalidation). New code should use `buildCredentialResolver`.
 */
export function buildCredentialProvider(
  db: DatabaseClient | undefined,
): CredentialProvider | undefined {
  return buildCredentialResolver(db);
}
