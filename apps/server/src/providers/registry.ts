import type { ModelProvider, ProviderDescriptor } from '@openaidy/runtime';
import type {
  ProviderRegistrationOptions,
  RegisteredProvider,
  DefaultProviderConfig,
} from './types';

/**
 * Provider Registry Service
 * 
 * Manages provider registration, resolution, and state.
 * All provider adapters must be registered here before use.
 */
export class ProviderRegistryService {
  private readonly providers = new Map<string, RegisteredProvider>();
  private defaultConfig: DefaultProviderConfig | null = null;

  /**
   * Register a provider adapter
   * @throws Error if provider with same ID already exists
   */
  register(
    provider: ModelProvider,
    options?: ProviderRegistrationOptions
  ): void {
    const id = provider.descriptor.id;
    
    if (this.providers.has(id)) {
      throw new Error(`Provider "${id}" is already registered`);
    }

    const entry: RegisteredProvider = {
      provider,
      enabled: options?.enabled ?? true,
      priority: options?.priority ?? 0,
      registeredAt: new Date(),
      ...(options?.defaultModel !== undefined && { defaultModel: options.defaultModel }),
      ...(options?.config !== undefined && { config: options.config }),
    };

    this.providers.set(id, entry);
  }

  /**
   * Unregister a provider by ID
   * @returns true if provider was removed, false if not found
   */
  unregister(providerId: string): boolean {
    return this.providers.delete(providerId);
  }

  /**
   * Check if a provider is registered
   */
  has(providerId: string): boolean {
    return this.providers.has(providerId);
  }

  /**
   * Get a registered provider by ID
   * Returns undefined if not found or disabled
   */
  get(providerId: string): ModelProvider | undefined {
    const entry = this.providers.get(providerId);
    if (!entry || !entry.enabled) {
      return undefined;
    }
    return entry.provider;
  }

  /**
   * Get a registered provider entry (including metadata)
   */
  getEntry(providerId: string): RegisteredProvider | undefined {
    return this.providers.get(providerId);
  }

  /**
   * Get provider descriptor by ID
   */
  getDescriptor(providerId: string): ProviderDescriptor | undefined {
    return this.get(providerId)?.descriptor;
  }

  /**
   * List all registered provider descriptors
   */
  listDescriptors(): ProviderDescriptor[] {
    return Array.from(this.providers.values())
      .filter((entry) => entry.enabled)
      .map((entry) => entry.provider.descriptor);
  }

  /**
   * List all registered providers (including disabled)
   */
  listAllDescriptors(): ProviderDescriptor[] {
    return Array.from(this.providers.values()).map(
      (entry) => entry.provider.descriptor
    );
  }

  /**
   * List all enabled providers
   */
  listEnabled(): ModelProvider[] {
    return Array.from(this.providers.values())
      .filter((entry) => entry.enabled)
      .map((entry) => entry.provider);
  }

  /**
   * Enable a provider
   */
  enable(providerId: string): boolean {
    const entry = this.providers.get(providerId);
    if (!entry) return false;
    (entry as { enabled: boolean }).enabled = true;
    return true;
  }

  /**
   * Disable a provider
   */
  disable(providerId: string): boolean {
    const entry = this.providers.get(providerId);
    if (!entry) return false;
    (entry as { enabled: boolean }).enabled = false;
    return true;
  }

  /**
   * Check if a provider is enabled
   */
  isEnabled(providerId: string): boolean {
    const entry = this.providers.get(providerId);
    return entry?.enabled ?? false;
  }

  /**
   * Set the default provider/model configuration
   */
  setDefault(config: DefaultProviderConfig): void {
    this.defaultConfig = config;
  }

  /**
   * Get the default provider/model configuration
   */
  getDefault(): DefaultProviderConfig | null {
    return this.defaultConfig;
  }

  /**
   * Get the default provider
   */
  getDefaultProvider(): ModelProvider | undefined {
    if (!this.defaultConfig) return undefined;
    return this.get(this.defaultConfig.providerId);
  }

  /**
   * Get count of registered providers
   */
  get size(): number {
    return this.providers.size;
  }

  /**
   * Get count of enabled providers
   */
  get enabledCount(): number {
    return Array.from(this.providers.values()).filter((e) => e.enabled).length;
  }

  /**
   * Clear all registered providers
   */
  clear(): void {
    this.providers.clear();
    this.defaultConfig = null;
  }
}

/**
 * Create a provider registry instance
 */
export function createProviderRegistry(): ProviderRegistryService {
  return new ProviderRegistryService();
}
