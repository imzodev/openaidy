/**
 * Provider Configuration Service
 *
 * This service integrates provider configuration loading, validation,
 * and secret resolution into the invocation path.
 *
 * It bridges the gap between:
 * - The @openaidy/config package (configuration schemas and secret resolution)
 * - The provider adapters in apps/server/src/providers/infrastructure/
 * - The ModelInvocationService
 */

import {
  createProviderError,
  type ProviderError,
  type ModelProvider,
} from '@openaidy/runtime';
import {
  type ProviderConfig,
  type ResolvedProviderConfig,
  type SecretProvider,
  type SecretResolutionError,
  providerConfigSchema,
  resolveProviderConfig,
  createDefaultSecretProvider,
  isSecretReference,
} from '@openaidy/config';
import type { CredentialProvider } from '@openaidy/shared-types';
import { createOpenAICompatibleProvider } from './infrastructure/openai-compatible';
import { createAnthropicProvider } from './infrastructure/anthropic';
import { createGeminiProvider } from './infrastructure/gemini';
import type {
  ConfigLoadResult,
  ProviderConfigServiceOptions,
} from './config-service.types';

// =====================
// Provider Config Service
// =====================

/**
 * Provider Configuration Service
 *
 * Handles loading, validating, and resolving provider configurations,
 * and creating provider adapters from the resolved configuration.
 */
export class ProviderConfigService {
  private readonly secretProvider: SecretProvider;
  private readonly credentialProvider: CredentialProvider | undefined;
  private readonly resolvedConfigs = new Map<string, ResolvedProviderConfig>();
  private readonly providers = new Map<string, ModelProvider>();

  constructor(options?: ProviderConfigServiceOptions) {
    this.secretProvider =
      options?.secretProvider ?? createDefaultSecretProvider();
    this.credentialProvider = options?.credentialProvider;
  }

  /**
   * Load and resolve a provider configuration, then create the provider adapter
   */
  async loadProvider(config: ProviderConfig): Promise<ConfigLoadResult> {
    // Validate the configuration
    const validationResult = providerConfigSchema.safeParse(config);
    if (!validationResult.success) {
      return {
        ok: false,
        error: createProviderError(
          'provider.config_invalid',
          `Invalid provider configuration: ${validationResult.error.issues
            .map(
              (i: { path: (string | number)[]; message: string }) =>
                `${i.path.join('.')}: ${i.message}`,
            )
            .join('; ')}`,
          { providerId: config.id },
        ),
      };
    }

    const validConfig = validationResult.data;

    // Resolve secrets in the configuration
    const resolveResult = await resolveProviderConfig(validConfig, {
      secretProvider: this.secretProvider,
    });

    if (!resolveResult.ok) {
      // Map secret resolution error to provider error
      return {
        ok: false,
        error: this.mapSecretError(
          resolveResult.error as SecretResolutionError,
          validConfig.id,
        ),
      };
    }

    // At this point, resolveResult.value is ResolvedProviderConfig
    const resolvedConfig = resolveResult.value as ResolvedProviderConfig;

    // Check if the provider is enabled
    if (!resolvedConfig.enabled) {
      return {
        ok: false,
        error: createProviderError(
          'provider.unavailable',
          `Provider "${resolvedConfig.id}" is disabled`,
          { providerId: resolvedConfig.id },
        ),
      };
    }

    // Create the provider adapter from the resolved configuration
    const providerResult = this.createProviderFromConfig(resolvedConfig);
    if (!providerResult.ok) {
      return providerResult;
    }

    // Cache the resolved config and provider
    this.resolvedConfigs.set(resolvedConfig.id, resolvedConfig);
    this.providers.set(resolvedConfig.id, providerResult.provider);

    return {
      ok: true,
      config: resolvedConfig,
      provider: providerResult.provider,
    };
  }

  /**
   * Get a previously loaded provider by ID
   */
  getProvider(providerId: string): ModelProvider | undefined {
    return this.providers.get(providerId);
  }

  /**
   * Get a previously resolved configuration by ID
   */
  getResolvedConfig(providerId: string): ResolvedProviderConfig | undefined {
    return this.resolvedConfigs.get(providerId);
  }

  /**
   * Resolve secrets for a specific API key value
   */
  async resolveApiKey(
    apiKey: string | ReturnType<typeof isSecretReference> extends true
      ? never
      : unknown,
    providerId: string,
  ): Promise<
    | { readonly ok: true; readonly value: string }
    | { readonly ok: false; readonly error: ProviderError }
  > {
    // If it's already a string, return it
    if (typeof apiKey === 'string') {
      return { ok: true, value: apiKey };
    }

    // If it's a secret reference, resolve it
    if (isSecretReference(apiKey)) {
      const result = await this.secretProvider.resolve(apiKey);
      if (!result.ok) {
        return {
          ok: false,
          error: this.mapSecretError(
            result.error as SecretResolutionError,
            providerId,
          ),
        };
      }
      return { ok: true, value: result.value };
    }

    // Invalid API key type
    return {
      ok: false,
      error: createProviderError(
        'provider.config_invalid',
        `Invalid API key configuration for provider "${providerId}"`,
        { providerId },
      ),
    };
  }

  /**
   * Clear all cached configurations and providers
   */
  clear(): void {
    this.resolvedConfigs.clear();
    this.providers.clear();
  }

  /**
   * Get the secret provider
   */
  getSecretProvider(): SecretProvider {
    return this.secretProvider;
  }

  // =====================
  // Private Methods
  // =====================

  /**
   * Create a provider adapter from a resolved configuration
   */
  private createProviderFromConfig(
    config: ResolvedProviderConfig,
  ): ConfigLoadResult {
    try {
      const provider = this.createAdapter(config);
      if (!provider) {
        return {
          ok: false,
          error: createProviderError(
            'provider.config_invalid',
            `Unsupported vendor family: ${config.vendorFamily}`,
            { providerId: config.id },
          ),
        };
      }
      return { ok: true, config, provider };
    } catch (error) {
      return {
        ok: false,
        error: createProviderError(
          'provider.config_invalid',
          `Failed to create provider adapter: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { providerId: config.id, cause: error },
        ),
      };
    }
  }

  /**
   * Create the appropriate adapter based on vendor family
   */
  private createAdapter(config: ResolvedProviderConfig): ModelProvider | null {
    switch (config.vendorFamily) {
      case 'openai-compatible':
        return this.createOpenAICompatibleAdapter(config);
      case 'anthropic':
        return this.createAnthropicAdapter(config);
      case 'gemini':
        return this.createGeminiAdapter(config);
      default:
        return null;
    }
  }

  /**
   * Create an OpenAI-compatible adapter
   */
  private createOpenAICompatibleAdapter(
    config: ResolvedProviderConfig,
  ): ModelProvider {
    const adapterConfig: {
      apiKey: string;
      baseUrl?: string;
      defaultModel?: string;
      organizationId?: string;
      headers?: Record<string, string>;
      timeoutMs?: number;
      providerId: string;
      providerName: string;
      credentialProvider?: CredentialProvider;
    } = {
      apiKey: config.apiKey ?? '',
      providerId: config.id,
      providerName: config.name,
    };

    // Only add optional properties if they are defined
    if (config.baseUrl !== undefined) {
      adapterConfig.baseUrl = config.baseUrl;
    }
    if (config.defaultModel !== undefined) {
      adapterConfig.defaultModel = config.defaultModel;
    }
    if (config.organizationId !== undefined) {
      adapterConfig.organizationId = config.organizationId;
    }
    if (config.headers !== undefined) {
      adapterConfig.headers = config.headers;
    }
    if (config.timeout?.requestMs !== undefined) {
      adapterConfig.timeoutMs = config.timeout.requestMs;
    }
    if (this.credentialProvider) {
      adapterConfig.credentialProvider = this.credentialProvider;
    }

    return createOpenAICompatibleProvider(adapterConfig);
  }

  /**
   * Create an Anthropic adapter
   */
  private createAnthropicAdapter(
    config: ResolvedProviderConfig,
  ): ModelProvider {
    const adapterConfig: {
      apiKey: string;
      baseUrl?: string;
      defaultModel?: string;
      headers?: Record<string, string>;
      timeoutMs?: number;
      providerId: string;
      providerName: string;
    } = {
      apiKey: config.apiKey ?? '',
      providerId: config.id,
      providerName: config.name,
    };

    // Only add optional properties if they are defined
    if (config.baseUrl !== undefined) {
      adapterConfig.baseUrl = config.baseUrl;
    }
    if (config.defaultModel !== undefined) {
      adapterConfig.defaultModel = config.defaultModel;
    }
    if (config.headers !== undefined) {
      adapterConfig.headers = config.headers;
    }
    if (config.timeout?.requestMs !== undefined) {
      adapterConfig.timeoutMs = config.timeout.requestMs;
    }

    return createAnthropicProvider(adapterConfig);
  }

  /**
   * Create a Gemini adapter
   */
  private createGeminiAdapter(config: ResolvedProviderConfig): ModelProvider {
    const adapterConfig: {
      apiKey: string;
      baseUrl?: string;
      defaultModel?: string;
      timeoutMs?: number;
      providerId: string;
      providerName: string;
      credentialProvider?: CredentialProvider;
    } = {
      apiKey: config.apiKey ?? '',
      providerId: config.id,
      providerName: config.name,
    };

    // Only add optional properties if they are defined
    if (config.baseUrl !== undefined) {
      adapterConfig.baseUrl = config.baseUrl;
    }
    if (config.defaultModel !== undefined) {
      adapterConfig.defaultModel = config.defaultModel;
    }
    if (config.timeout?.requestMs !== undefined) {
      adapterConfig.timeoutMs = config.timeout.requestMs;
    }
    if (this.credentialProvider) {
      adapterConfig.credentialProvider = this.credentialProvider;
    }

    return createGeminiProvider(adapterConfig);
  }

  /**
   * Map a secret resolution error to a provider error
   */
  private mapSecretError(
    error: SecretResolutionError,
    providerId: string,
  ): ProviderError {
    // Map secret error codes to provider error codes
    const errorCodeMap: Record<string, string> = {
      'secret.not_found': 'provider.config_invalid',
      'secret.access_denied': 'provider.config_invalid',
      'secret.invalid_reference': 'provider.config_invalid',
      'secret.provider_unavailable': 'provider.config_invalid',
      'secret.timeout': 'provider.timeout',
      'secret.unknown': 'provider.unknown',
    };

    const mappedCode = errorCodeMap[error.code] ?? 'provider.config_invalid';

    return createProviderError(
      mappedCode as ProviderError['code'],
      `Secret resolution failed for provider "${providerId}": ${error.message}`,
      {
        providerId,
        cause: error.cause,
      },
    );
  }
}

// =====================
// Factory Function
// =====================

/**
 * Create a provider configuration service
 */
export function createProviderConfigService(
  options?: ProviderConfigServiceOptions,
): ProviderConfigService {
  return new ProviderConfigService(options);
}
