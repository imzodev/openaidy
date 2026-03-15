import type {
  ModelProvider,
  ProviderCapability,
  ProviderError,
} from '@openaidy/runtime';

/**
 * Registration options for a provider
 */
export type ProviderRegistrationOptions = {
  /** Whether the provider is enabled (defaults to true) */
  enabled?: boolean;
  /** Priority for default selection (higher = more preferred) */
  priority?: number;
  /** Default model for this provider */
  defaultModel?: string;
  /** Custom configuration */
  config?: Record<string, unknown>;
};

/**
 * Registered provider entry
 */
export type RegisteredProvider = {
  readonly provider: ModelProvider;
  readonly enabled: boolean;
  readonly priority: number;
  readonly defaultModel?: string;
  readonly config?: Record<string, unknown>;
  readonly registeredAt: Date;
};

/**
 * Provider selection request
 */
export type ProviderSelectionRequest = {
  /** Explicit provider ID (optional) */
  providerId?: string;
  /** Explicit model ID (optional) */
  modelId?: string;
  /** Required capabilities */
  capabilities?: readonly ProviderCapability[];
};

/**
 * Provider selection result
 */
export type ProviderSelectionResult =
  | { readonly ok: true; readonly provider: ModelProvider; readonly modelId: string }
  | { readonly ok: false; readonly error: ProviderError };

/**
 * Default provider configuration
 */
export type DefaultProviderConfig = {
  /** Default provider ID */
  providerId: string;
  /** Default model ID */
  modelId: string;
};
