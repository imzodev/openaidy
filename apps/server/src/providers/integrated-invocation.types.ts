/**
 * Types for IntegratedInvocationService
 *
 * Lives in its own file so the `integrated-invocation.ts` service
 * implementation can stay focused on logic. Per project convention,
 * types and interfaces are exported only from type files and
 * imported wherever they're needed.
 */

import type {
  ModelResponse,
  ProviderError,
  ModelProvider,
} from '@openaidy/runtime';
import type {
  ProviderConfig,
  SecretProvider,
  ResolvedProviderConfig,
} from '@openaidy/config';
import type { CredentialProvider } from '@openaidy/shared-types';

/**
 * Options for the IntegratedInvocationService
 */
export type IntegratedInvocationOptions = {
  /** Secret provider to use for resolving secrets */
  secretProvider?: SecretProvider;
  /**
   * Optional callback that returns the current credential (e.g. an
   * OAuth access token) for a provider at request time. Forwarded
   * to the underlying `ProviderConfigService` so OpenAI-compatible
   * adapters (including minimax) pick up tokens persisted after
   * server startup.
   */
  credentialProvider?: CredentialProvider;
  /** Pre-registered providers to add to the registry */
  preRegisteredProviders?: Array<{
    provider: ModelProvider;
    options?: {
      enabled?: boolean;
      priority?: number;
      defaultModel?: string;
    };
  }>;
};

/**
 * Result of loading a provider through the integrated service
 */
export type IntegratedLoadResult =
  | {
      readonly ok: true;
      readonly provider: ModelProvider;
      readonly config: ResolvedProviderConfig;
    }
  | { readonly ok: false; readonly error: ProviderError };

/**
 * Result of invoking a model through the integrated service
 */
export type IntegratedInvokeResult<T = ModelResponse> =
  | { readonly ok: true; readonly response: T }
  | { readonly ok: false; readonly error: ProviderError };

/**
 * Result of selection with optional config
 */
export type SelectionWithConfigResult =
  | {
      readonly ok: true;
      readonly provider: ModelProvider;
      readonly modelId: string;
      readonly config?: ResolvedProviderConfig;
    }
  | { readonly ok: false; readonly error: ProviderError };

/**
 * Re-export of `ProviderConfig` so consumers that only import from
 * this file don't have to reach into `@openaidy/config` for the
 * config type used by the registration API.
 */
export type { ProviderConfig };
