/**
 * Types for ProviderConfigService
 *
 * Lives in its own file so `config-service.ts` can stay focused on
 * logic. Per project convention, types and interfaces are exported
 * only from type files and imported wherever they're needed.
 */

import type { ProviderError, ModelProvider } from '@openaidy/runtime';
import type { SecretProvider } from '@openaidy/config';
import type { ResolvedProviderConfig } from '@openaidy/config';
import type {
  AuthMethodProvider,
  CredentialProvider,
} from '@openaidy/shared-types';

/**
 * Result of loading and resolving a provider configuration
 */
export type ConfigLoadResult =
  | {
      readonly ok: true;
      readonly config: ResolvedProviderConfig;
      readonly provider: ModelProvider;
    }
  | { readonly ok: false; readonly error: ProviderError };

/**
 * Options for the ProviderConfigService
 */
export type ProviderConfigServiceOptions = {
  /** Secret provider to use for resolving secrets */
  secretProvider?: SecretProvider;
  /**
   * Optional callback that supplies the credential used for the
   * `Authorization: Bearer …` header on every outgoing request. This
   * is the path that lets OAuth-stored tokens (written to the
   * `provider_credentials` table after server startup) actually
   * reach the upstream provider.
   */
  credentialProvider?: CredentialProvider;
  /**
   * Optional callback that resolves which auth method a provider's
   * stored credential was connected with. Only consumed by the
   * Anthropic adapter today — it needs to send OAuth bearer tokens
   * and API keys with different headers, which `credentialProvider`
   * alone can't distinguish.
   */
  authMethodProvider?: AuthMethodProvider;
};
