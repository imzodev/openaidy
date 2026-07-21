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
 * own, only in response to a user action (re-running OAuth,
 * entering a new API key, disconnecting), so a TTL would just add
 * a window where a freshly-changed credential is ignored.
 *
 * - `api_key` rows store the bare key as ciphertext → returned as-is
 * - `oauth` / `device_code` rows store a JSON object with
 *   `{ accessToken, refreshToken, ... }` → `accessToken` is returned
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
  CredentialInvalidator,
  CredentialProvider,
} from '@openaidy/shared-types';

const log = createLogger('credential-provider');

export type CredentialResolver = CredentialProvider & {
  /**
   * Drop the cached credential for a provider so the next request
   * re-reads it from the DB. Call this whenever a credential is
   * upserted, refreshed, or its connection is torn down.
   */
  invalidate: (providerId: string) => void;
};

export function buildCredentialResolver(
  db: DatabaseClient | undefined,
): CredentialResolver | undefined {
  if (!db) {
    return undefined;
  }

  const credentialsRepo = new ProviderCredentialsRepository(db);
  const encryption = getEncryptionService();
  const cache = new Map<string, string | null>();

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
      const value =
        row.authMethod === 'oauth' || row.authMethod === 'device_code'
          ? ((JSON.parse(decrypted) as { accessToken?: string }).accessToken ??
            null)
          : decrypted;
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

  return Object.assign(resolve, { invalidate });
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
