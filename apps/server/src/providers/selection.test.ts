import { describe, it, expect, beforeEach } from 'vitest';
import {
  ok,
  err,
  createProviderError,
  type ModelProvider,
  type ProviderDescriptor,
} from '@openaidy/runtime';
import { ProviderRegistryService, createProviderRegistry } from './registry';
import { ProviderSelectionService, createProviderSelection } from './selection';

/**
 * Helper to create a mock provider
 */
function createMockProvider(
  id: string = 'test-provider',
  capabilities: string[] = ['text_generation', 'streaming']
): ModelProvider {
  const descriptor: ProviderDescriptor = {
    id,
    name: `Provider ${id}`,
    capabilities: capabilities as ProviderDescriptor['capabilities'],
    vendorFamily: 'test',
  };

  return {
    descriptor,
    listModels: async () => ok([]),
    getModel: async () => err(createProviderError('provider.model_not_found', 'Not found')),
    hasCapability: (cap) => descriptor.capabilities.includes(cap),
    invoke: async () =>
      ok({
        id: 'resp_123',
        model: 'test-model',
        providerId: id,
        content: 'Response',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        finishReason: 'stop' as const,
        created: new Date().toISOString(),
      }),
    invokeStream: async function* () {
      yield ok({
        type: 'stream.started' as const,
        timestamp: new Date().toISOString(),
        id: 'stream_123',
        model: 'test-model',
        providerId: id,
      });
    },
  };
}

describe('ProviderSelectionService', () => {
  let registry: ProviderRegistryService;
  let selection: ProviderSelectionService;

  beforeEach(() => {
    registry = createProviderRegistry();
    selection = createProviderSelection(registry);
  });

  describe('select with explicit provider', () => {
    it('should select an explicit provider', () => {
      const provider = createMockProvider('openai');
      registry.register(provider);
      registry.setDefault({ providerId: 'anthropic', modelId: 'claude-3' });

      const result = selection.select({ providerId: 'openai' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.provider.descriptor.id).toBe('openai');
      }
    });

    it('should return error for non-existent provider', () => {
      const result = selection.select({ providerId: 'non-existent' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('provider.unavailable');
        expect(result.error.message).toContain('not registered');
      }
    });

    it('should return error for disabled provider', () => {
      const provider = createMockProvider('disabled-provider');
      registry.register(provider, { enabled: false });

      const result = selection.select({ providerId: 'disabled-provider' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('provider.unavailable');
        expect(result.error.message).toContain('disabled');
      }
    });

    it('should use explicit model ID', () => {
      const provider = createMockProvider('openai');
      registry.register(provider);

      const result = selection.select({
        providerId: 'openai',
        modelId: 'gpt-4-turbo',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.modelId).toBe('gpt-4-turbo');
      }
    });

    it('should use provider default model when no model specified', () => {
      const provider = createMockProvider('openai');
      registry.register(provider, { defaultModel: 'gpt-4' });

      const result = selection.select({ providerId: 'openai' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.modelId).toBe('gpt-4');
      }
    });
  });

  describe('select with default provider', () => {
    it('should select default provider when no explicit provider', () => {
      const provider = createMockProvider('default-provider');
      registry.register(provider);
      registry.setDefault({ providerId: 'default-provider', modelId: 'default-model' });

      const result = selection.select({});

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.provider.descriptor.id).toBe('default-provider');
        expect(result.modelId).toBe('default-model');
      }
    });

    it('should return error when no default configured', () => {
      const result = selection.select({});

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('provider.config_invalid');
        expect(result.error.message).toContain('No default provider');
      }
    });

    it('should return error when default provider not registered', () => {
      registry.setDefault({ providerId: 'missing', modelId: 'model' });

      const result = selection.select({});

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('provider.unavailable');
        expect(result.error.message).toContain('not registered');
      }
    });

    it('should return error when default provider is disabled', () => {
      const provider = createMockProvider('disabled-default');
      registry.register(provider, { enabled: false });
      registry.setDefault({ providerId: 'disabled-default', modelId: 'model' });

      const result = selection.select({});

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('provider.unavailable');
        expect(result.error.message).toContain('disabled');
      }
    });
  });

  describe('capability validation', () => {
    it('should reject selection when provider lacks required capability', () => {
      const provider = createMockProvider('basic-provider', ['text_generation']);
      registry.register(provider);

      const result = selection.select({
        providerId: 'basic-provider',
        capabilities: ['vision'],
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('provider.capability_unsupported');
        expect(result.error.message).toContain('vision');
      }
    });

    it('should accept selection when provider has all required capabilities', () => {
      const provider = createMockProvider('full-provider', [
        'text_generation',
        'streaming',
        'vision',
      ]);
      registry.register(provider);

      const result = selection.select({
        providerId: 'full-provider',
        capabilities: ['text_generation', 'streaming'],
      });

      expect(result.ok).toBe(true);
    });

    it('should validate capabilities for default provider', () => {
      const provider = createMockProvider('default-provider', ['text_generation']);
      registry.register(provider);
      registry.setDefault({ providerId: 'default-provider', modelId: 'model' });

      const result = selection.select({
        capabilities: ['streaming'],
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('provider.capability_unsupported');
      }
    });
  });

  describe('hasCapabilities', () => {
    it('should return true when provider has all capabilities', () => {
      const provider = createMockProvider('test', ['text_generation', 'streaming']);
      registry.register(provider);

      expect(selection.hasCapabilities('test', ['text_generation'])).toBe(true);
      expect(
        selection.hasCapabilities('test', ['text_generation', 'streaming'])
      ).toBe(true);
    });

    it('should return false when provider lacks capability', () => {
      const provider = createMockProvider('test', ['text_generation']);
      registry.register(provider);

      expect(selection.hasCapabilities('test', ['vision'])).toBe(false);
    });

    it('should return false for non-existent provider', () => {
      expect(selection.hasCapabilities('non-existent', ['text_generation'])).toBe(false);
    });
  });

  describe('findProvidersWithCapabilities', () => {
    it('should find providers with required capabilities', () => {
      const provider1 = createMockProvider('p1', ['text_generation', 'streaming']);
      const provider2 = createMockProvider('p2', ['text_generation', 'vision']);
      const provider3 = createMockProvider('p3', ['embedding']);

      registry.register(provider1);
      registry.register(provider2);
      registry.register(provider3);

      const providers = selection.findProvidersWithCapabilities(['text_generation']);

      expect(providers).toHaveLength(2);
      expect(providers.map((p) => p.descriptor.id)).toContain('p1');
      expect(providers.map((p) => p.descriptor.id)).toContain('p2');
    });

    it('should not include disabled providers', () => {
      const provider1 = createMockProvider('p1', ['text_generation']);
      const provider2 = createMockProvider('p2', ['text_generation']);

      registry.register(provider1);
      registry.register(provider2, { enabled: false });

      const providers = selection.findProvidersWithCapabilities(['text_generation']);

      expect(providers).toHaveLength(1);
      expect(providers[0]?.descriptor.id).toBe('p1');
    });
  });

  describe('getRegistry', () => {
    it('should return the registry instance', () => {
      expect(selection.getRegistry()).toBe(registry);
    });
  });
});
