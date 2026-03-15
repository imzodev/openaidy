import {
  createProviderError,
  type ModelProvider,
  type ProviderCapability,
  type ProviderError,
} from '@openaidy/runtime';
import type { ProviderRegistryService } from './registry';
import type { ProviderSelectionRequest, ProviderSelectionResult } from './types';

/**
 * Provider Selection Service
 * 
 * Handles provider and model selection logic including:
 * - Explicit provider/model resolution
 * - Default fallback selection
 * - Capability validation
 * - Error normalization for selection failures
 */
export class ProviderSelectionService {
  constructor(private readonly registry: ProviderRegistryService) {}

  /**
   * Select a provider and model based on the request
   */
  select(request: ProviderSelectionRequest): ProviderSelectionResult {
    // If explicit provider is specified, use it
    if (request.providerId) {
      return this.selectExplicit(
        request.providerId,
        request.modelId,
        request.capabilities
      );
    }

    // Otherwise, fall back to default
    return this.selectDefault(request.modelId, request.capabilities);
  }

  /**
   * Select an explicit provider by ID
   */
  private selectExplicit(
    providerId: string,
    modelId?: string,
    capabilities?: readonly ProviderCapability[]
  ): ProviderSelectionResult {
    const entry = this.registry.getEntry(providerId);

    // Check if provider exists
    if (!entry) {
      return {
        ok: false,
        error: createProviderError(
          'provider.unavailable',
          `Provider "${providerId}" is not registered`,
          { providerId }
        ),
      };
    }

    // Check if provider is enabled
    if (!entry.enabled) {
      return {
        ok: false,
        error: createProviderError(
          'provider.unavailable',
          `Provider "${providerId}" is disabled`,
          { providerId }
        ),
      };
    }

    const provider = entry.provider;

    // Validate capabilities if specified
    if (capabilities) {
      const capabilityError = this.validateCapabilities(
        provider,
        capabilities,
        providerId
      );
      if (capabilityError) {
        return { ok: false, error: capabilityError };
      }
    }

    // Use explicit model or provider's default or first available
    const resolvedModelId =
      modelId ?? entry.defaultModel ?? provider.descriptor.capabilities[0];

    if (!resolvedModelId) {
      return {
        ok: false,
        error: createProviderError(
          'provider.config_invalid',
          `No model specified and provider "${providerId}" has no default model or capabilities`,
          { providerId }
        ),
      };
    }

    return {
      ok: true,
      provider,
      modelId: resolvedModelId,
    };
  }

  /**
   * Select the default provider
   */
  private selectDefault(
    modelId?: string,
    capabilities?: readonly ProviderCapability[]
  ): ProviderSelectionResult {
    const defaultConfig = this.registry.getDefault();

    if (!defaultConfig) {
      return {
        ok: false,
        error: createProviderError(
          'provider.config_invalid',
          'No default provider configured'
        ),
      };
    }

    // Try to use the default provider
    const entry = this.registry.getEntry(defaultConfig.providerId);

    if (!entry) {
      return {
        ok: false,
        error: createProviderError(
          'provider.unavailable',
          `Default provider "${defaultConfig.providerId}" is not registered`,
          { providerId: defaultConfig.providerId }
        ),
      };
    }

    if (!entry.enabled) {
      return {
        ok: false,
        error: createProviderError(
          'provider.unavailable',
          `Default provider "${defaultConfig.providerId}" is disabled`,
          { providerId: defaultConfig.providerId }
        ),
      };
    }

    const provider = entry.provider;

    // Validate capabilities if specified
    if (capabilities) {
      const capabilityError = this.validateCapabilities(
        provider,
        capabilities,
        defaultConfig.providerId
      );
      if (capabilityError) {
        return { ok: false, error: capabilityError };
      }
    }

    return {
      ok: true,
      provider,
      modelId: modelId ?? defaultConfig.modelId,
    };
  }

  /**
   * Validate that a provider supports required capabilities
   */
  private validateCapabilities(
    provider: ModelProvider,
    required: readonly ProviderCapability[],
    providerId: string
  ): ProviderError | null {
    for (const capability of required) {
      if (!provider.hasCapability(capability)) {
        return createProviderError(
          'provider.capability_unsupported',
          `Provider "${providerId}" does not support capability "${capability}"`,
          { providerId }
        );
      }
    }
    return null;
  }

  /**
   * Check if a provider supports specific capabilities
   */
  hasCapabilities(
    providerId: string,
    capabilities: readonly ProviderCapability[]
  ): boolean {
    const provider = this.registry.get(providerId);
    if (!provider) return false;

    return capabilities.every((cap) => provider.hasCapability(cap));
  }

  /**
   * Find providers that support specific capabilities
   */
  findProvidersWithCapabilities(
    capabilities: readonly ProviderCapability[]
  ): ModelProvider[] {
    return this.registry.listEnabled().filter((provider) =>
      capabilities.every((cap) => provider.hasCapability(cap))
    );
  }

  /**
   * Get the registry instance
   */
  getRegistry(): ProviderRegistryService {
    return this.registry;
  }
}

/**
 * Create a provider selection service
 */
export function createProviderSelection(
  registry: ProviderRegistryService
): ProviderSelectionService {
  return new ProviderSelectionService(registry);
}
