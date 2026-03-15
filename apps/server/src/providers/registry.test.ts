import { describe, it, expect, beforeEach } from 'vitest';
import {
  ok,
  err,
  createProviderError,
  type ModelProvider,
  type ProviderDescriptor,
  type ModelRequest,
} from '@openaidy/runtime';
import {
  ProviderRegistryService,
  createProviderRegistry,
} from './registry';

/**
 * Helper to create a mock provider
 */
function createMockProvider(overrides?: Partial<ModelProvider>): ModelProvider {
  const descriptor: ProviderDescriptor = {
    id: 'test-provider',
    name: 'Test Provider',
    description: 'A test provider',
    capabilities: ['text_generation', 'streaming'],
    vendorFamily: 'test',
  };

  const provider: ModelProvider = {
    descriptor,
    listModels: async () =>
      ok([
        {
          id: 'test-model',
          providerId: 'test-provider',
          name: 'Test Model',
          capabilities: ['text_generation'],
        },
      ]),
    getModel: async (id: string) => {
      if (id === 'test-model') {
        return ok({
          id: 'test-model',
          providerId: 'test-provider',
          name: 'Test Model',
          capabilities: ['text_generation'],
        });
      }
      return err(createProviderError('provider.model_not_found', 'Model not found'));
    },
    hasCapability: (cap) => descriptor.capabilities.includes(cap),
    invoke: async (req: ModelRequest) =>
      ok({
        id: 'resp_123',
        model: req.model,
        providerId: 'test-provider',
        content: 'Test response',
        usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
        finishReason: 'stop' as const,
        created: new Date().toISOString(),
      }),
    invokeStream: async function* (req: ModelRequest) {
      yield ok({
        type: 'stream.started' as const,
        timestamp: new Date().toISOString(),
        id: 'stream_123',
        model: req.model,
        providerId: 'test-provider',
      });
      yield ok({
        type: 'stream.content_delta' as const,
        timestamp: new Date().toISOString(),
        id: 'stream_123',
        delta: 'Hello',
      });
      yield ok({
        type: 'stream.finished' as const,
        timestamp: new Date().toISOString(),
        id: 'stream_123',
        finishReason: 'stop' as const,
      });
    },
    ...overrides,
  };

  return provider;
}

describe('ProviderRegistryService', () => {
  let registry: ProviderRegistryService;

  beforeEach(() => {
    registry = createProviderRegistry();
  });

  describe('register', () => {
    it('should register a provider', () => {
      const provider = createMockProvider();
      registry.register(provider);

      expect(registry.has('test-provider')).toBe(true);
      expect(registry.size).toBe(1);
    });

    it('should throw when registering duplicate provider', () => {
      const provider = createMockProvider();
      registry.register(provider);

      expect(() => registry.register(provider)).toThrow(
        'Provider "test-provider" is already registered'
      );
    });

    it('should register with options', () => {
      const provider = createMockProvider();
      registry.register(provider, {
        enabled: false,
        priority: 10,
        defaultModel: 'gpt-4',
        config: { apiKey: 'test-key' },
      });

      const entry = registry.getEntry('test-provider');
      expect(entry?.enabled).toBe(false);
      expect(entry?.priority).toBe(10);
      expect(entry?.defaultModel).toBe('gpt-4');
      expect(entry?.config).toEqual({ apiKey: 'test-key' });
    });

    it('should default enabled to true', () => {
      const provider = createMockProvider();
      registry.register(provider);

      expect(registry.isEnabled('test-provider')).toBe(true);
    });
  });

  describe('unregister', () => {
    it('should unregister a provider', () => {
      const provider = createMockProvider();
      registry.register(provider);

      expect(registry.unregister('test-provider')).toBe(true);
      expect(registry.has('test-provider')).toBe(false);
    });

    it('should return false for non-existent provider', () => {
      expect(registry.unregister('non-existent')).toBe(false);
    });
  });

  describe('get', () => {
    it('should return provider when enabled', () => {
      const provider = createMockProvider();
      registry.register(provider);

      expect(registry.get('test-provider')).toBe(provider);
    });

    it('should return undefined when disabled', () => {
      const provider = createMockProvider();
      registry.register(provider, { enabled: false });

      expect(registry.get('test-provider')).toBeUndefined();
    });

    it('should return undefined for non-existent provider', () => {
      expect(registry.get('non-existent')).toBeUndefined();
    });
  });

  describe('getEntry', () => {
    it('should return entry even when disabled', () => {
      const provider = createMockProvider();
      registry.register(provider, { enabled: false });

      const entry = registry.getEntry('test-provider');
      expect(entry?.provider).toBe(provider);
      expect(entry?.enabled).toBe(false);
    });
  });

  describe('getDescriptor', () => {
    it('should return provider descriptor', () => {
      const provider = createMockProvider();
      registry.register(provider);

      const descriptor = registry.getDescriptor('test-provider');
      expect(descriptor?.id).toBe('test-provider');
      expect(descriptor?.vendorFamily).toBe('test');
    });
  });

  describe('listDescriptors', () => {
    it('should list enabled provider descriptors', () => {
      const provider1 = createMockProvider();
      const provider2 = createMockProvider({
        descriptor: {
          id: 'provider-2',
          name: 'Provider 2',
          capabilities: ['text_generation'],
          vendorFamily: 'test',
        },
      });

      registry.register(provider1);
      registry.register(provider2);

      const descriptors = registry.listDescriptors();
      expect(descriptors).toHaveLength(2);
    });

    it('should not list disabled providers', () => {
      const provider = createMockProvider();
      registry.register(provider, { enabled: false });

      expect(registry.listDescriptors()).toHaveLength(0);
    });
  });

  describe('listAllDescriptors', () => {
    it('should list all providers including disabled', () => {
      const provider1 = createMockProvider();
      const provider2 = createMockProvider({
        descriptor: {
          id: 'provider-2',
          name: 'Provider 2',
          capabilities: ['text_generation'],
          vendorFamily: 'test',
        },
      });

      registry.register(provider1, { enabled: false });
      registry.register(provider2);

      const descriptors = registry.listAllDescriptors();
      expect(descriptors).toHaveLength(2);
    });
  });

  describe('listEnabled', () => {
    it('should list only enabled providers', () => {
      const provider1 = createMockProvider();
      const provider2 = createMockProvider({
        descriptor: {
          id: 'provider-2',
          name: 'Provider 2',
          capabilities: ['text_generation'],
          vendorFamily: 'test',
        },
      });

      registry.register(provider1);
      registry.register(provider2, { enabled: false });

      const enabled = registry.listEnabled();
      expect(enabled).toHaveLength(1);
      expect(enabled[0]?.descriptor.id).toBe('test-provider');
    });
  });

  describe('enable/disable', () => {
    it('should enable a disabled provider', () => {
      const provider = createMockProvider();
      registry.register(provider, { enabled: false });

      expect(registry.isEnabled('test-provider')).toBe(false);
      expect(registry.enable('test-provider')).toBe(true);
      expect(registry.isEnabled('test-provider')).toBe(true);
    });

    it('should disable an enabled provider', () => {
      const provider = createMockProvider();
      registry.register(provider);

      expect(registry.isEnabled('test-provider')).toBe(true);
      expect(registry.disable('test-provider')).toBe(true);
      expect(registry.isEnabled('test-provider')).toBe(false);
    });

    it('should return false for non-existent provider', () => {
      expect(registry.enable('non-existent')).toBe(false);
      expect(registry.disable('non-existent')).toBe(false);
    });
  });

  describe('default provider', () => {
    it('should set and get default config', () => {
      registry.setDefault({ providerId: 'openai', modelId: 'gpt-4' });

      const config = registry.getDefault();
      expect(config?.providerId).toBe('openai');
      expect(config?.modelId).toBe('gpt-4');
    });

    it('should return null when no default set', () => {
      expect(registry.getDefault()).toBeNull();
    });

    it('should get default provider', () => {
      const provider = createMockProvider();
      registry.register(provider);
      registry.setDefault({ providerId: 'test-provider', modelId: 'test-model' });

      expect(registry.getDefaultProvider()).toBe(provider);
    });
  });

  describe('clear', () => {
    it('should clear all providers', () => {
      const provider = createMockProvider();
      registry.register(provider);
      registry.setDefault({ providerId: 'test-provider', modelId: 'test-model' });

      registry.clear();

      expect(registry.size).toBe(0);
      expect(registry.getDefault()).toBeNull();
    });
  });

  describe('enabledCount', () => {
    it('should count enabled providers', () => {
      const provider1 = createMockProvider();
      const provider2 = createMockProvider({
        descriptor: {
          id: 'provider-2',
          name: 'Provider 2',
          capabilities: ['text_generation'],
          vendorFamily: 'test',
        },
      });

      registry.register(provider1);
      registry.register(provider2, { enabled: false });

      expect(registry.enabledCount).toBe(1);
    });
  });
});
