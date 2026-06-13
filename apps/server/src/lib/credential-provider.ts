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
 * - `api_key` rows store the bare key as ciphertext → returned as-is
 * - `oauth` / `device_code` rows store a JSON object with
 *   `{ accessToken, refreshToken, ... }` → `accessToken` is returned
 *
 * Returns `null` ("no override — use the SDK default") when no row
 * exists for the provider or the row is in a non-connected state.
 */

import {
  ProviderCredentialsRepository,
  type DatabaseClient,
} from '@openaidy/db';
import { getEncryptionService } from './encryption';
import { createLogger } from './logger';
import type { CredentialProvider } from '@openaidy/shared-types';

const log = createLogger('credential-provider');

export function buildCredentialProvider(
  db: DatabaseClient | undefined,
): CredentialProvider | undefined {
  if (!db) {
    return undefined;
  }

  const credentialsRepo = new ProviderCredentialsRepository(db);
  const encryption = getEncryptionService();

  return async (providerId: string): Promise<string | null> => {
    try {
      const row = await credentialsRepo.findByProviderId(providerId);
      if (!row || row.status !== 'connected') return null;

      const decrypted = encryption.decrypt(row.encryptedCredentials);
      if (row.authMethod === 'oauth' || row.authMethod === 'device_code') {
        const parsed = JSON.parse(decrypted) as { accessToken?: string };
        return parsed.accessToken ?? null;
      }
      return decrypted;
    } catch (err) {
      log.warn(
        `credentialProvider: failed to resolve credential for "${providerId}": ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  };
}
