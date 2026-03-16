/**
 * Integrated Invocation Service
 *
 * This service integrates provider configuration loading, secret resolution,
 * and model invocation into a unified flow.
 *
 * It bridges the gap between:
 * - ProviderConfigService (config validation and secret resolution)
 * - ProviderRegistryService (provider registration)
 * - ModelInvocationService (actual model invocation)
 *
 * The integration ensures that:
 * - Provider invocation is backed by validated provider configuration
 * - Secrets are resolved through the abstraction rather than ad hoc wiring
 * - Invalid configuration fails early and predictably
 */

import {
  createProviderError,
  type ModelRequest,
  type ModelResponse,
  type ModelStreamEvent,
  type ProviderError,
  type ModelProvider,
} from '@openaidy/runtime';
import {
  type ProviderConfig,
  type SecretProvider,
  type ResolvedProviderConfig,
  createDefaultSecretProvider,
} from '@openaidy/config';
import { ProviderConfigService, createProviderConfigService } from './config-service';
import { ProviderRegistryService, createProviderRegistry } from './registry';
import { ProviderSelectionService, createProviderSelection } from './selection';
import { ModelInvocationService, createModelInvocation, type InvocationOptions } from './invocation';
import type { ProviderSelectionRequest } from './types';

// =====================
// Types
// =====================

/**
 * Options for the IntegratedInvocationService
 */
export type IntegratedInvocationOptions = {
  /** Secret provider to use for resolving secrets */
  secretProvider?: SecretProvider;
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
  | { readonly ok: true; readonly provider: ModelProvider; readonly config: ResolvedProviderConfig }
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
  | { readonly ok: true; readonly provider: ModelProvider; readonly modelId: string; readonly config?: ResolvedProviderConfig }
  | { readonly ok: false; readonly error: ProviderError };

// =====================
// Integrated Invocation Service
// =====================

/**
 * Integrated Invocation Service
 *
 * Provides a unified interface for:
 * - Loading providers from configuration with secret resolution
 * - Registering providers in the registry
 * - Invoking models through the normalized interface
 *
 * This service ensures that the invocation flow is driven by validated
 * provider configuration and resolved secrets.
 */
export class IntegratedInvocationService {
  private readonly configService: ProviderConfigService;
  private readonly registry: ProviderRegistryService;
  private readonly selection: ProviderSelectionService;
  private readonly invocation: ModelInvocationService;
  private readonly pendingConfigs = new Map<string, ProviderConfig>();

  constructor(options?: IntegratedInvocationOptions) {
    // Initialize the secret provider
    const secretProvider = options?.secretProvider ?? createDefaultSecretProvider();

    // Initialize services
    this.configService = createProviderConfigService({ secretProvider });
    this.registry = createProviderRegistry();
    this.selection = createProviderSelection(this.registry);
    this.invocation = createModelInvocation(this.registry, this.selection);

    // Register pre-registered providers
    if (options?.preRegisteredProviders) {
      for (const { provider, options: regOptions } of options.preRegisteredProviders) {
        const registrationOptions: { enabled?: boolean; priority?: number; defaultModel?: string } = {};
        if (regOptions?.enabled !== undefined) {
          registrationOptions.enabled = regOptions.enabled;
        }
        if (regOptions?.priority !== undefined) {
          registrationOptions.priority = regOptions.priority;
        }
        if (regOptions?.defaultModel !== undefined) {
          registrationOptions.defaultModel = regOptions.defaultModel;
        }
        this.registry.register(provider, registrationOptions);
      }
    }
  }

  // =====================
  // Configuration Management
  // =====================

  /**
   * Register a provider configuration to be loaded on-demand
   */
  registerConfig(config: ProviderConfig): void {
    this.pendingConfigs.set(config.id, config);
  }

  /**
   * Register multiple provider configurations
   */
  registerConfigs(configs: ProviderConfig[]): void {
    for (const config of configs) {
      this.pendingConfigs.set(config.id, config);
    }
  }

  /**
   * Load a provider from configuration immediately
   */
  async loadProvider(config: ProviderConfig): Promise<IntegratedLoadResult> {
    const result = await this.configService.loadProvider(config);

    if (!result.ok) {
      return result;
    }

    // Register the loaded provider in the registry
    const registrationOptions: { enabled?: boolean; priority?: number; defaultModel?: string } = {};
    if (result.config.enabled !== undefined) {
      registrationOptions.enabled = result.config.enabled;
    }
    if (result.config.priority !== undefined) {
      registrationOptions.priority = result.config.priority;
    }
    if (result.config.defaultModel !== undefined) {
      registrationOptions.defaultModel = result.config.defaultModel;
    }
    this.registry.register(result.provider, registrationOptions);

    // Remove from pending if it was there
    this.pendingConfigs.delete(config.id);

    return {
      ok: true,
      provider: result.provider,
      config: result.config,
    };
  }

  /**
   * Load all pending provider configurations
   */
  async loadAllPending(): Promise<Array<{ id: string; result: IntegratedLoadResult }>> {
    const results: Array<{ id: string; result: IntegratedLoadResult }> = [];
    const configsToLoad = Array.from(this.pendingConfigs.values());

    for (const config of configsToLoad) {
      const result = await this.loadProvider(config);
      results.push({ id: config.id, result });
    }

    return results;
  }

  // =====================
  // Provider Resolution
  // =====================

  /**
   * Get or load a provider by ID
   *
   * This method first checks the registry for an already-loaded provider.
   * If not found, it attempts to load from pending configurations.
   */
  async getOrLoadProvider(providerId: string): Promise<IntegratedLoadResult> {
    // Check if already registered
    const existingProvider = this.registry.get(providerId);
    if (existingProvider) {
      const resolvedConfig = this.configService.getResolvedConfig(providerId);
      // Build a minimal config from the provider descriptor if no resolved config exists
      const config: ResolvedProviderConfig = resolvedConfig ?? {
        id: providerId,
        name: existingProvider.descriptor.name,
        vendorFamily: existingProvider.descriptor.vendorFamily as ResolvedProviderConfig['vendorFamily'],
        enabled: true,
        priority: 50,
      };
      return {
        ok: true,
        provider: existingProvider,
        config,
      };
    }

    // Try to load from pending configs
    const pendingConfig = this.pendingConfigs.get(providerId);
    if (pendingConfig) {
      return this.loadProvider(pendingConfig);
    }

    // Provider not found
    return {
      ok: false,
      error: createProviderError(
        'provider.unavailable',
        `Provider "${providerId}" is not registered and no configuration was found`,
        { providerId }
      ),
    };
  }

  /**
   * Select a provider, loading from config if necessary
   */
  async selectWithConfig(request: ProviderSelectionRequest): Promise<SelectionWithConfigResult> {
    // If explicit provider is specified, try to load it
    if (request.providerId) {
      const loadResult = await this.getOrLoadProvider(request.providerId);
      if (!loadResult.ok) {
        return loadResult;
      }
    }

    // Try selection
    const selectionResult = this.selection.select(request);

    if (selectionResult.ok) {
      const config = this.configService.getResolvedConfig(selectionResult.provider.descriptor.id);
      return config
        ? { ok: true, provider: selectionResult.provider, modelId: selectionResult.modelId, config }
        : { ok: true, provider: selectionResult.provider, modelId: selectionResult.modelId };
    }

    // If no explicit provider and selection failed, try to load any pending provider
    if (!request.providerId && this.pendingConfigs.size > 0) {
      // Load all pending and try again
      await this.loadAllPending();
      const retryResult = this.selection.select(request);
      if (retryResult.ok) {
        const config = this.configService.getResolvedConfig(retryResult.provider.descriptor.id);
        return config
          ? { ok: true, provider: retryResult.provider, modelId: retryResult.modelId, config }
          : { ok: true, provider: retryResult.provider, modelId: retryResult.modelId };
      }
    }

    return selectionResult;
  }

  // =====================
  // Invocation
  // =====================

  /**
   * Invoke a model with config-driven provider resolution
   *
   * This method ensures that:
   * - Provider configuration is loaded and validated
   * - Secrets are resolved before invocation
   * - Invocation uses the validated configuration
   */
  async invokeWithConfig(
    request: ModelRequest,
    options?: InvocationOptions
  ): Promise<IntegratedInvokeResult<ModelResponse>> {
    // Determine provider ID from options or request metadata
    const providerId = options?.providerId ?? (request.metadata?.providerId as string | undefined);

    // Ensure provider is loaded
    if (providerId) {
      const loadResult = await this.getOrLoadProvider(providerId);
      if (!loadResult.ok) {
        return loadResult;
      }
    }

    // Try invocation
    const result = await this.invocation.invoke(request, options);

    // If no explicit provider and invocation failed, try loading pending configs
    if (!result.ok && !providerId && this.pendingConfigs.size > 0) {
      await this.loadAllPending();
      const retryResult = await this.invocation.invoke(request, options);
      if (retryResult.ok) {
        return { ok: true, response: retryResult.value };
      }
      return { ok: false, error: retryResult.error };
    }

    if (result.ok) {
      return { ok: true, response: result.value };
    }

    return { ok: false, error: result.error };
  }

  /**
   * Invoke a model with streaming
   */
  async *invokeStreamWithConfig(
    request: ModelRequest,
    options?: InvocationOptions
  ): AsyncIterable<IntegratedInvokeResult<ModelStreamEvent>> {
    // Determine provider ID from options or request metadata
    const providerId = options?.providerId ?? (request.metadata?.providerId as string | undefined);

    // Ensure provider is loaded
    if (providerId) {
      const loadResult = await this.getOrLoadProvider(providerId);
      if (!loadResult.ok) {
        yield loadResult;
        return;
      }
    }

    // Try streaming invocation
    for await (const event of this.invocation.invokeStream(request, options)) {
      if (event.ok) {
        yield { ok: true, response: event.value };
      } else {
        yield { ok: false, error: event.error };
      }
    }
  }

  // =====================
  // Service Access
  // =====================

  /**
   * Get the underlying config service
   */
  getConfigService(): ProviderConfigService {
    return this.configService;
  }

  /**
   * Get the underlying registry
   */
  getRegistry(): ProviderRegistryService {
    return this.registry;
  }

  /**
   * Get the underlying selection service
   */
  getSelection(): ProviderSelectionService {
    return this.selection;
  }

  /**
   * Get the underlying invocation service
   */
  getInvocation(): ModelInvocationService {
    return this.invocation;
  }

  /**
   * Get the secret provider
   */
  getSecretProvider(): SecretProvider {
    return this.configService.getSecretProvider();
  }

  /**
   * Clear all cached data
   */
  clear(): void {
    this.configService.clear();
    this.registry.clear();
    this.pendingConfigs.clear();
  }
}

// =====================
// Factory Function
// =====================

/**
 * Create an integrated invocation service
 */
export function createIntegratedInvocation(
  options?: IntegratedInvocationOptions
): IntegratedInvocationService {
  return new IntegratedInvocationService(options);
}
