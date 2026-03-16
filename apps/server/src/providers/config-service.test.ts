import { describe, it, expect } from 'vitest';
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
  ProviderConfigService,
  createProviderConfigService,
} from './config-service';

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

describe('ProviderConfigService', () => {
  let configService: ProviderConfigService;

  describe('loadProvider', () => {
    it('should load a provider with inline API key successfully', async () => {
      const mockSecretProvider = createMockSecretProvider(new Map());
      configService = createProviderConfigService({ secretProvider: mockSecretProvider });

      const config = createOpenAIConfig({
        id: 'test-openai',
        name: 'Test OpenAI',
        apiKey: inlineSecret('test-api-key'),
      });

      const result = await configService.loadProvider(config);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.config.id).toBe('test-openai');
        expect(result.config.name).toBe('Test OpenAI');
        expect(result.config.apiKey).toBe('test-api-key');
        expect(result.config.vendorFamily).toBe('openai-compatible');
        expect(result.provider).toBeDefined();
        expect(result.provider.descriptor.id).toBe('test-openai');
      }
    });

    it('should resolve environment variable secret reference', async () => {
      const resolutions = new Map([['OPENAI_API_KEY', 'sk-test-key-12345']]);
      const mockSecretProvider = createMockSecretProvider(resolutions);
      configService = createProviderConfigService({ secretProvider: mockSecretProvider });

      const config = createOpenAIConfig({
        id: 'env-openai',
        name: 'Env OpenAI',
        apiKey: envSecret('OPENAI_API_KEY'),
      });

      const result = await configService.loadProvider(config);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.config.apiKey).toBe('sk-test-key-12345');
      }
    });

    it('should fail when secret cannot be resolved', async () => {
      const mockSecretProvider = createMockSecretProvider(new Map());
      configService = createProviderConfigService({ secretProvider: mockSecretProvider });

      const config = createOpenAIConfig({
        id: 'missing-secret',
        name: 'Missing Secret',
        apiKey: envSecret('MISSING_API_KEY'),
      });

      const result = await configService.loadProvider(config);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('provider.config_invalid');
        expect(result.error.message).toContain('Secret resolution failed');
        expect(result.error.message).toContain('MISSING_API_KEY');
      }
    });

    it('should fail when config is invalid', async () => {
      const mockSecretProvider = createMockSecretProvider(new Map());
      configService = createProviderConfigService({ secretProvider: mockSecretProvider });

      const result = await configService.loadProvider({
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
      configService = createProviderConfigService({ secretProvider: mockSecretProvider });

      const config = createOpenAIConfig({
        id: 'disabled-provider',
        name: 'Disabled Provider',
        apiKey: inlineSecret('test-key'),
        enabled: false,
      });

      const result = await configService.loadProvider(config);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('provider.unavailable');
        expect(result.error.message).toContain('disabled');
      }
    });

    it('should load Anthropic provider successfully', async () => {
      const mockSecretProvider = createMockSecretProvider(new Map());
      configService = createProviderConfigService({ secretProvider: mockSecretProvider });

      const config = createAnthropicConfig({
        id: 'test-anthropic',
        name: 'Test Anthropic',
        apiKey: inlineSecret('sk-ant-test'),
        defaultModel: 'claude-3-opus-20240229',
      });

      const result = await configService.loadProvider(config);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.config.vendorFamily).toBe('anthropic');
        expect(result.config.defaultModel).toBe('claude-3-opus-20240229');
        expect(result.provider.descriptor.vendorFamily).toBe('anthropic');
      }
    });

    it('should load Gemini provider successfully', async () => {
      const mockSecretProvider = createMockSecretProvider(new Map());
      configService = createProviderConfigService({ secretProvider: mockSecretProvider });

      const config = createGeminiConfig({
        id: 'test-gemini',
        name: 'Test Gemini',
        apiKey: inlineSecret('gemini-api-key'),
        defaultModel: 'gemini-1.5-pro',
      });

      const result = await configService.loadProvider(config);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.config.vendorFamily).toBe('gemini');
        expect(result.config.defaultModel).toBe('gemini-1.5-pro');
        expect(result.provider.descriptor.vendorFamily).toBe('gemini');
      }
    });

    it('should pass configuration options to adapter', async () => {
      const mockSecretProvider = createMockSecretProvider(new Map());
      configService = createProviderConfigService({ secretProvider: mockSecretProvider });

      const config = createOpenAIConfig({
        id: 'configured-openai',
        name: 'Configured OpenAI',
        apiKey: inlineSecret('test-key'),
        baseUrl: 'https://custom-api.example.com/v1',
        defaultModel: 'gpt-4-turbo',
        timeout: { connectMs: 5000, requestMs: 30000, readMs: 10000 },
        headers: { 'X-Custom-Header': 'test' },
      });

      const result = await configService.loadProvider(config);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.config.baseUrl).toBe('https://custom-api.example.com/v1');
        expect(result.config.defaultModel).toBe('gpt-4-turbo');
        expect(result.config.timeout?.requestMs).toBe(30000);
        expect(result.config.headers?.['X-Custom-Header']).toBe('test');
      }
    });
  });

  describe('getProvider', () => {
    it('should return cached provider after loading', async () => {
      const mockSecretProvider = createMockSecretProvider(new Map());
      configService = createProviderConfigService({ secretProvider: mockSecretProvider });

      const config = createOpenAIConfig({
        id: 'cached-provider',
        name: 'Cached Provider',
        apiKey: inlineSecret('test-key'),
      });

      await configService.loadProvider(config);

      const provider = configService.getProvider('cached-provider');
      expect(provider).toBeDefined();
      expect(provider?.descriptor.id).toBe('cached-provider');
    });

    it('should return undefined for non-existent provider', () => {
      configService = createProviderConfigService();

      const provider = configService.getProvider('non-existent');
      expect(provider).toBeUndefined();
    });
  });

  describe('getResolvedConfig', () => {
    it('should return cached resolved config after loading', async () => {
      const mockSecretProvider = createMockSecretProvider(new Map());
      configService = createProviderConfigService({ secretProvider: mockSecretProvider });

      const config = createOpenAIConfig({
        id: 'cached-config',
        name: 'Cached Config',
        apiKey: inlineSecret('test-key'),
      });

      await configService.loadProvider(config);

      const resolvedConfig = configService.getResolvedConfig('cached-config');
      expect(resolvedConfig).toBeDefined();
      expect(resolvedConfig?.id).toBe('cached-config');
      expect(resolvedConfig?.apiKey).toBe('test-key');
    });

    it('should return undefined for non-existent config', () => {
      configService = createProviderConfigService();

      const config = configService.getResolvedConfig('non-existent');
      expect(config).toBeUndefined();
    });
  });

  describe('resolveApiKey', () => {
    it('should return string API key as-is', async () => {
      configService = createProviderConfigService();

      const result = await configService.resolveApiKey('plain-api-key', 'test-provider');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('plain-api-key');
      }
    });

    it('should resolve secret reference', async () => {
      const resolutions = new Map([['API_KEY', 'resolved-key']]);
      const mockSecretProvider = createMockSecretProvider(resolutions);
      configService = createProviderConfigService({ secretProvider: mockSecretProvider });

      const result = await configService.resolveApiKey(envSecret('API_KEY'), 'test-provider');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('resolved-key');
      }
    });

    it('should fail for unresolved secret reference', async () => {
      const mockSecretProvider = createMockSecretProvider(new Map());
      configService = createProviderConfigService({ secretProvider: mockSecretProvider });

      const result = await configService.resolveApiKey(envSecret('MISSING_KEY'), 'test-provider');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('provider.config_invalid');
        expect(result.error.message).toContain('Secret resolution failed');
      }
    });
  });

  describe('clear', () => {
    it('should clear all cached providers and configs', async () => {
      const mockSecretProvider = createMockSecretProvider(new Map());
      configService = createProviderConfigService({ secretProvider: mockSecretProvider });

      const config = createOpenAIConfig({
        id: 'clear-test',
        name: 'Clear Test',
        apiKey: inlineSecret('test-key'),
      });

      await configService.loadProvider(config);

      expect(configService.getProvider('clear-test')).toBeDefined();
      expect(configService.getResolvedConfig('clear-test')).toBeDefined();

      configService.clear();

      expect(configService.getProvider('clear-test')).toBeUndefined();
      expect(configService.getResolvedConfig('clear-test')).toBeUndefined();
    });
  });

  describe('getSecretProvider', () => {
    it('should return the secret provider', () => {
      const mockSecretProvider = createMockSecretProvider(new Map());
      configService = createProviderConfigService({ secretProvider: mockSecretProvider });

      expect(configService.getSecretProvider()).toBe(mockSecretProvider);
    });

    it('should return default secret provider when not provided', () => {
      configService = createProviderConfigService();

      const provider = configService.getSecretProvider();
      expect(provider).toBeDefined();
      expect(provider.canResolve).toBeDefined();
      expect(provider.resolve).toBeDefined();
    });
  });

  describe('error handling', () => {
    it('should map secret timeout error to provider timeout error', async () => {
      const timeoutSecretProvider: SecretProvider = {
        canResolve: () => true,
        resolve: async () => secretErr('secret.timeout', 'Secret resolution timed out'),
      };

      configService = createProviderConfigService({ secretProvider: timeoutSecretProvider });

      const config = createOpenAIConfig({
        id: 'timeout-test',
        name: 'Timeout Test',
        apiKey: envSecret('TIMEOUT_KEY'),
      });

      const result = await configService.loadProvider(config);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('provider.timeout');
      }
    });

    it('should handle access denied errors', async () => {
      const accessDeniedProvider: SecretProvider = {
        canResolve: () => true,
        resolve: async () => secretErr('secret.access_denied', 'Access denied to secret'),
      };

      configService = createProviderConfigService({ secretProvider: accessDeniedProvider });

      const config = createOpenAIConfig({
        id: 'access-denied-test',
        name: 'Access Denied Test',
        apiKey: envSecret('SECRET_KEY'),
      });

      const result = await configService.loadProvider(config);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('provider.config_invalid');
        expect(result.error.message).toContain('Access denied');
      }
    });
  });
});
