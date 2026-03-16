import { describe, it, expect, beforeEach } from 'vitest';
import {
  type SecretProvider,
  type SecretReference,
  type SecretResolutionResult,
  secretOk,
  secretErr,
  envSecret,
  inlineSecret,
  createOpenAIConfig,
  createAnthropicConfig,
  createGeminiConfig,
} from '@openaidy/config';
import {
  IntegratedInvocationService,
  createIntegratedInvocation,
} from './integrated-invocation';
import { createFakeProvider } from '@openaidy/runtime/testing';

/**
 * Helper to create a mock secret provider
 */
function createMockSecretProvider(
  resolutions: Map<string, string | Error>
): SecretProvider {
  return {
    canResolve: (ref: SecretReference) => {
      if (ref.type === 'env') {
        return resolutions.has(ref.name);
      }
      if (ref.type === 'inline') {
        return true;
      }
      return false;
    },
    resolve: async (ref: SecretReference): Promise<SecretResolutionResult> => {
      if (ref.type === 'env') {
        const value = resolutions.get(ref.name);
        if (value === undefined) {
          return secretErr('secret.not_found', `Environment variable "${ref.name}" is not set`);
        }
        if (value instanceof Error) {
          return secretErr('secret.access_denied', value.message);
        }
        return secretOk(value);
      }
      if (ref.type === 'inline') {
        return secretOk(ref.value);
      }
      return secretErr('secret.invalid_reference', `Cannot resolve secret type: ${ref.type}`);
    },
  };
}

describe('IntegratedInvocationService', () => {
  let service: IntegratedInvocationService;

  describe('configuration management', () => {
    beforeEach(() => {
      const mockSecretProvider = createMockSecretProvider(new Map());
      service = createIntegratedInvocation({ secretProvider: mockSecretProvider });
    });

    it('should register a provider configuration', () => {
      const config = createOpenAIConfig({
        id: 'test-provider',
        name: 'Test Provider',
        apiKey: inlineSecret('test-key'),
      });

      service.registerConfig(config);

      // Configuration should be stored (we can verify this by loading)
      expect(service.getRegistry().has('test-provider')).toBe(false);
    });

    it('should register multiple provider configurations', () => {
      const configs = [
        createOpenAIConfig({
          id: 'provider-1',
          name: 'Provider 1',
          apiKey: inlineSecret('key-1'),
        }),
        createOpenAIConfig({
          id: 'provider-2',
          name: 'Provider 2',
          apiKey: inlineSecret('key-2'),
        }),
      ];

      service.registerConfigs(configs);

      expect(service.getRegistry().has('provider-1')).toBe(false);
      expect(service.getRegistry().has('provider-2')).toBe(false);
    });

    it('should load a provider from configuration', async () => {
      const mockSecretProvider = createMockSecretProvider(new Map());
      service = createIntegratedInvocation({ secretProvider: mockSecretProvider });

      const config = createOpenAIConfig({
        id: 'loaded-provider',
        name: 'Loaded Provider',
        apiKey: inlineSecret('test-key'),
      });

      const result = await service.loadProvider(config);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.provider.descriptor.id).toBe('loaded-provider');
        expect(result.config.id).toBe('loaded-provider');
        expect(result.config.apiKey).toBe('test-key');
      }

      // Should be registered in the registry
      expect(service.getRegistry().has('loaded-provider')).toBe(true);
    });
  });

  describe('secret resolution', () => {
    it('should successfully resolve provider config and secret references before invocation', async () => {
      const resolutions = new Map([['OPENAI_API_KEY', 'sk-resolved-key-12345']]);
      const mockSecretProvider = createMockSecretProvider(resolutions);
      service = createIntegratedInvocation({ secretProvider: mockSecretProvider });

      const config = createOpenAIConfig({
        id: 'env-provider',
        name: 'Env Provider',
        apiKey: envSecret('OPENAI_API_KEY'),
      });

      const result = await service.loadProvider(config);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.config.apiKey).toBe('sk-resolved-key-12345');
        expect(result.provider).toBeDefined();
      }
    });

    it('should fail when required secret references cannot be resolved', async () => {
      const mockSecretProvider = createMockSecretProvider(new Map());
      service = createIntegratedInvocation({ secretProvider: mockSecretProvider });

      const config = createOpenAIConfig({
        id: 'missing-secret-provider',
        name: 'Missing Secret Provider',
        apiKey: envSecret('MISSING_API_KEY'),
      });

      const result = await service.loadProvider(config);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('provider.config_invalid');
        expect(result.error.message).toContain('Secret resolution failed');
        expect(result.error.message).toContain('MISSING_API_KEY');
      }
    });

    it('should fail when config is invalid or incomplete', async () => {
      const mockSecretProvider = createMockSecretProvider(new Map());
      service = createIntegratedInvocation({ secretProvider: mockSecretProvider });

      const result = await service.loadProvider({
        id: '', // Invalid: empty ID
        name: 'Invalid Provider',
        vendorFamily: 'openai-compatible',
        apiKey: inlineSecret('test-key'),
      } as never);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('provider.config_invalid');
        expect(result.error.message).toContain('Invalid provider configuration');
      }
    });

    it('should fail when provider is disabled', async () => {
      const mockSecretProvider = createMockSecretProvider(new Map());
      service = createIntegratedInvocation({ secretProvider: mockSecretProvider });

      const config = createOpenAIConfig({
        id: 'disabled-provider',
        name: 'Disabled Provider',
        apiKey: inlineSecret('test-key'),
        enabled: false,
      });

      const result = await service.loadProvider(config);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('provider.unavailable');
        expect(result.error.message).toContain('disabled');
      }
    });
  });

  describe('normalized error mapping', () => {
    it('should map secret timeout error to provider timeout error', async () => {
      const timeoutSecretProvider: SecretProvider = {
        canResolve: () => true,
        resolve: async () => secretErr('secret.timeout', 'Secret resolution timed out'),
      };

      service = createIntegratedInvocation({ secretProvider: timeoutSecretProvider });

      const config = createOpenAIConfig({
        id: 'timeout-provider',
        name: 'Timeout Provider',
        apiKey: envSecret('TIMEOUT_KEY'),
      });

      const result = await service.loadProvider(config);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('provider.timeout');
      }
    });

    it('should map access denied error to config invalid error', async () => {
      const accessDeniedProvider: SecretProvider = {
        canResolve: () => true,
        resolve: async () => secretErr('secret.access_denied', 'Access denied to secret'),
      };

      service = createIntegratedInvocation({ secretProvider: accessDeniedProvider });

      const config = createOpenAIConfig({
        id: 'access-denied-provider',
        name: 'Access Denied Provider',
        apiKey: envSecret('SECRET_KEY'),
      });

      const result = await service.loadProvider(config);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('provider.config_invalid');
        expect(result.error.message).toContain('Access denied');
      }
    });

    it('should map provider unavailable error for missing provider', async () => {
      const mockSecretProvider = createMockSecretProvider(new Map());
      service = createIntegratedInvocation({ secretProvider: mockSecretProvider });

      const result = await service.getOrLoadProvider('non-existent-provider');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('provider.unavailable');
        expect(result.error.message).toContain('not registered');
        expect(result.error.message).toContain('no configuration was found');
      }
    });
  });

  describe('provider resolution', () => {
    beforeEach(() => {
      const mockSecretProvider = createMockSecretProvider(new Map());
      service = createIntegratedInvocation({ secretProvider: mockSecretProvider });
    });

    it('should get or load a provider by ID', async () => {
      const config = createOpenAIConfig({
        id: 'on-demand-provider',
        name: 'On Demand Provider',
        apiKey: inlineSecret('test-key'),
      });

      service.registerConfig(config);

      // Should not be in registry yet
      expect(service.getRegistry().has('on-demand-provider')).toBe(false);

      // Load on demand
      const result = await service.getOrLoadProvider('on-demand-provider');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.provider.descriptor.id).toBe('on-demand-provider');
      }

      // Should now be in registry
      expect(service.getRegistry().has('on-demand-provider')).toBe(true);
    });

    it('should return existing provider without reloading', async () => {
      const config = createOpenAIConfig({
        id: 'cached-provider',
        name: 'Cached Provider',
        apiKey: inlineSecret('test-key'),
      });

      // Load once
      await service.loadProvider(config);

      // Get again
      const result = await service.getOrLoadProvider('cached-provider');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.provider.descriptor.id).toBe('cached-provider');
      }
    });

    it('should select provider with config loading', async () => {
      const config = createOpenAIConfig({
        id: 'selectable-provider',
        name: 'Selectable Provider',
        apiKey: inlineSecret('test-key'),
        defaultModel: 'gpt-4',
      });

      service.registerConfig(config);
      service.getRegistry().setDefault({
        providerId: 'selectable-provider',
        modelId: 'gpt-4',
      });

      const result = await service.selectWithConfig({
        capabilities: ['text_generation'],
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.provider.descriptor.id).toBe('selectable-provider');
        expect(result.modelId).toBe('gpt-4');
        expect(result.config).toBeDefined();
        expect(result.config?.id).toBe('selectable-provider');
      }
    });
  });

  describe('invocation with config', () => {
    it('should invoke model with config-driven provider resolution', async () => {
      const mockProvider = createFakeProvider({
        id: 'invoke-test-provider',
        name: 'Invoke Test Provider',
        capabilities: ['text_generation'],
        models: [
          {
            id: 'test-model',
            providerId: 'invoke-test-provider',
            name: 'Test Model',
            capabilities: ['text_generation'],
          },
        ],
      });

      service = createIntegratedInvocation({
        secretProvider: createMockSecretProvider(new Map()),
        preRegisteredProviders: [
          {
            provider: mockProvider,
            options: { defaultModel: 'test-model' },
          },
        ],
      });

      service.getRegistry().setDefault({
        providerId: 'invoke-test-provider',
        modelId: 'test-model',
      });

      const result = await service.invokeWithConfig({
        model: 'test-model',
        messages: [{ role: 'user', content: 'Hello' }],
      });

      // Note: The mock provider will return a response
      expect(result.ok).toBe(true);
    });

    it('should fail gracefully when no provider is configured', async () => {
      service = createIntegratedInvocation({
        secretProvider: createMockSecretProvider(new Map()),
      });

      const result = await service.invokeWithConfig({
        model: 'test-model',
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('provider.config_invalid');
        expect(result.error.message).toContain('No default provider configured');
      }
    });

    it('should load provider on demand when invoking', async () => {
      const config = createOpenAIConfig({
        id: 'on-demand-invoke-provider',
        name: 'On Demand Invoke Provider',
        apiKey: inlineSecret('test-key'),
        defaultModel: 'gpt-4',
      });

      service = createIntegratedInvocation({
        secretProvider: createMockSecretProvider(new Map()),
      });

      service.registerConfig(config);
      service.getRegistry().setDefault({
        providerId: 'on-demand-invoke-provider',
        modelId: 'gpt-4',
      });

      // Provider should not be loaded yet
      expect(service.getRegistry().has('on-demand-invoke-provider')).toBe(false);

      // Invocation should trigger loading
      await service.invokeWithConfig({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
      });

      // Provider should now be loaded
      expect(service.getRegistry().has('on-demand-invoke-provider')).toBe(true);
    });
  });

  describe('load all pending', () => {
    it('should load all pending provider configurations', async () => {
      const configs = [
        createOpenAIConfig({
          id: 'pending-1',
          name: 'Pending 1',
          apiKey: inlineSecret('key-1'),
        }),
        createOpenAIConfig({
          id: 'pending-2',
          name: 'Pending 2',
          apiKey: inlineSecret('key-2'),
        }),
        createAnthropicConfig({
          id: 'pending-3',
          name: 'Pending 3',
          apiKey: inlineSecret('key-3'),
        }),
      ];

      service = createIntegratedInvocation({
        secretProvider: createMockSecretProvider(new Map()),
      });

      service.registerConfigs(configs);

      const results = await service.loadAllPending();

      expect(results).toHaveLength(3);
      expect(results.every((r) => r.result.ok)).toBe(true);
      expect(service.getRegistry().size).toBe(3);
    });

    it('should report failures for invalid configurations', async () => {
      const validConfig = createOpenAIConfig({
        id: 'valid-pending',
        name: 'Valid Pending',
        apiKey: inlineSecret('key'),
      });

      const invalidConfig = createOpenAIConfig({
        id: 'invalid-pending',
        name: 'Invalid Pending',
        apiKey: envSecret('MISSING_KEY'),
      });

      service = createIntegratedInvocation({
        secretProvider: createMockSecretProvider(new Map()),
      });

      service.registerConfigs([validConfig, invalidConfig]);

      const results = await service.loadAllPending();

      expect(results).toHaveLength(2);

      const validResult = results.find((r) => r.id === 'valid-pending');
      const invalidResult = results.find((r) => r.id === 'invalid-pending');

      expect(validResult?.result.ok).toBe(true);
      expect(invalidResult?.result.ok).toBe(false);
    });
  });

  describe('multiple vendor families', () => {
    it('should load OpenAI-compatible provider through full config-to-invocation path', async () => {
      const mockSecretProvider = createMockSecretProvider(new Map());
      service = createIntegratedInvocation({ secretProvider: mockSecretProvider });

      const config = createOpenAIConfig({
        id: 'openai-via-config',
        name: 'OpenAI Via Config',
        apiKey: inlineSecret('sk-test'),
        defaultModel: 'gpt-4',
      });

      const result = await service.loadProvider(config);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.config.vendorFamily).toBe('openai-compatible');
        expect(result.provider.descriptor.vendorFamily).toBe('openai-compatible');
      }
    });

    it('should load Anthropic provider through full config-to-invocation path', async () => {
      const mockSecretProvider = createMockSecretProvider(new Map());
      service = createIntegratedInvocation({ secretProvider: mockSecretProvider });

      const config = createAnthropicConfig({
        id: 'anthropic-via-config',
        name: 'Anthropic Via Config',
        apiKey: inlineSecret('sk-ant-test'),
        defaultModel: 'claude-3-opus-20240229',
      });

      const result = await service.loadProvider(config);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.config.vendorFamily).toBe('anthropic');
        expect(result.provider.descriptor.vendorFamily).toBe('anthropic');
      }
    });

    it('should load Gemini provider through full config-to-invocation path', async () => {
      const mockSecretProvider = createMockSecretProvider(new Map());
      service = createIntegratedInvocation({ secretProvider: mockSecretProvider });

      const config = createGeminiConfig({
        id: 'gemini-via-config',
        name: 'Gemini Via Config',
        apiKey: inlineSecret('gemini-test-key'),
        defaultModel: 'gemini-1.5-pro',
      });

      const result = await service.loadProvider(config);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.config.vendorFamily).toBe('gemini');
        expect(result.provider.descriptor.vendorFamily).toBe('gemini');
      }
    });
  });

  describe('service access', () => {
    beforeEach(() => {
      service = createIntegratedInvocation();
    });

    it('should provide access to underlying services', () => {
      expect(service.getConfigService()).toBeDefined();
      expect(service.getRegistry()).toBeDefined();
      expect(service.getSelection()).toBeDefined();
      expect(service.getInvocation()).toBeDefined();
      expect(service.getSecretProvider()).toBeDefined();
    });

    it('should clear all cached data', async () => {
      const config = createOpenAIConfig({
        id: 'clear-test',
        name: 'Clear Test',
        apiKey: inlineSecret('key'),
      });

      await service.loadProvider(config);

      expect(service.getRegistry().has('clear-test')).toBe(true);
      expect(service.getConfigService().getResolvedConfig('clear-test')).toBeDefined();

      service.clear();

      expect(service.getRegistry().size).toBe(0);
      expect(service.getConfigService().getResolvedConfig('clear-test')).toBeUndefined();
    });
  });
});
