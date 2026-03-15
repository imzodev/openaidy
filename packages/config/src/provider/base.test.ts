/**
 * Tests for Base Provider Configuration
 */

import { describe, it, expect } from 'vitest';
import {
  baseProviderConfigSchema,
  resolvedProviderConfigSchema,
  vendorFamilySchema,
  httpTimeoutSchema,
  retrySchema,
  isSecretReference,
  createBaseProviderConfig,
} from './base';
import { envSecret, inlineSecret } from './secrets';

describe('vendorFamilySchema', () => {
  it('should accept valid vendor families', () => {
    expect(vendorFamilySchema.parse('openai-compatible')).toBe('openai-compatible');
    expect(vendorFamilySchema.parse('anthropic')).toBe('anthropic');
    expect(vendorFamilySchema.parse('gemini')).toBe('gemini');
  });

  it('should reject invalid vendor families', () => {
    expect(() => vendorFamilySchema.parse('invalid')).toThrow();
  });
});

describe('httpTimeoutSchema', () => {
  it('should accept valid timeout config', () => {
    const result = httpTimeoutSchema.parse({
      connectMs: 5000,
      requestMs: 30000,
      readMs: 10000,
    });
    expect(result.connectMs).toBe(5000);
    expect(result.requestMs).toBe(30000);
    expect(result.readMs).toBe(10000);
  });

  it('should apply defaults', () => {
    const result = httpTimeoutSchema.parse({});
    expect(result.connectMs).toBe(5000);
    expect(result.requestMs).toBe(60000);
    expect(result.readMs).toBe(30000);
  });

  it('should reject invalid timeout values', () => {
    expect(() => httpTimeoutSchema.parse({ connectMs: -1 })).toThrow();
    expect(() => httpTimeoutSchema.parse({ requestMs: 0 })).toThrow();
  });
});

describe('retrySchema', () => {
  it('should accept valid retry config', () => {
    const result = retrySchema.parse({
      maxAttempts: 5,
      baseDelayMs: 2000,
      maxDelayMs: 60000,
      exponentialBackoff: true,
      retryOnStatus: [429, 500],
    });
    expect(result.maxAttempts).toBe(5);
    expect(result.baseDelayMs).toBe(2000);
    expect(result.exponentialBackoff).toBe(true);
  });

  it('should apply defaults', () => {
    const result = retrySchema.parse({});
    expect(result.maxAttempts).toBe(3);
    expect(result.baseDelayMs).toBe(1000);
    expect(result.maxDelayMs).toBe(30000);
    expect(result.exponentialBackoff).toBe(true);
    expect(result.retryOnStatus).toEqual([429, 500, 502, 503, 504]);
  });

  it('should reject invalid retry values', () => {
    expect(() => retrySchema.parse({ maxAttempts: -1 })).toThrow();
    expect(() => retrySchema.parse({ maxAttempts: 11 })).toThrow();
  });
});

describe('baseProviderConfigSchema', () => {
  it('should accept valid base config', () => {
    const config = {
      id: 'test-provider',
      name: 'Test Provider',
      vendorFamily: 'openai-compatible' as const,
      apiKey: inlineSecret('test-key'),
    };
    const result = baseProviderConfigSchema.parse(config);
    expect(result.id).toBe('test-provider');
    expect(result.name).toBe('Test Provider');
    expect(result.enabled).toBe(true);
    expect(result.priority).toBe(50);
  });

  it('should accept string API key', () => {
    const config = {
      id: 'test-provider',
      name: 'Test Provider',
      vendorFamily: 'anthropic' as const,
      apiKey: 'plain-api-key',
    };
    const result = baseProviderConfigSchema.parse(config);
    expect(result.apiKey).toBe('plain-api-key');
  });

  it('should accept secret reference API key', () => {
    const config = {
      id: 'test-provider',
      name: 'Test Provider',
      vendorFamily: 'gemini' as const,
      apiKey: envSecret('GOOGLE_API_KEY'),
    };
    const result = baseProviderConfigSchema.parse(config);
    expect(result.apiKey).toEqual({ type: 'env', name: 'GOOGLE_API_KEY' });
  });

  it('should require id, name, and vendorFamily', () => {
    expect(() => baseProviderConfigSchema.parse({})).toThrow();
    expect(() => baseProviderConfigSchema.parse({ id: 'test' })).toThrow();
    expect(() =>
      baseProviderConfigSchema.parse({ id: 'test', name: 'Test' })
    ).toThrow();
  });

  it('should reject invalid vendor family', () => {
    const config = {
      id: 'test-provider',
      name: 'Test Provider',
      vendorFamily: 'invalid',
    };
    expect(() => baseProviderConfigSchema.parse(config)).toThrow();
  });

  it('should accept optional fields', () => {
    const config = {
      id: 'test-provider',
      name: 'Test Provider',
      vendorFamily: 'openai-compatible' as const,
      baseUrl: 'https://api.example.com/v1',
      organizationId: 'org-123',
      defaultModel: 'gpt-4',
      timeout: { connectMs: 10000 },
      retry: { maxAttempts: 5 },
      headers: { 'X-Custom': 'value' },
      metadata: { custom: 'data' },
    };
    const result = baseProviderConfigSchema.parse(config);
    expect(result.baseUrl).toBe('https://api.example.com/v1');
    expect(result.organizationId).toBe('org-123');
    expect(result.defaultModel).toBe('gpt-4');
    expect(result.headers).toEqual({ 'X-Custom': 'value' });
  });
});

describe('resolvedProviderConfigSchema', () => {
  it('should accept valid resolved config', () => {
    const config = {
      id: 'test-provider',
      name: 'Test Provider',
      vendorFamily: 'openai-compatible' as const,
      enabled: true,
      apiKey: 'resolved-api-key',
      priority: 50,
    };
    const result = resolvedProviderConfigSchema.parse(config);
    expect(result.apiKey).toBe('resolved-api-key');
  });
});

describe('isSecretReference', () => {
  it('should return true for valid secret references', () => {
    expect(isSecretReference({ type: 'env', name: 'API_KEY' })).toBe(true);
    expect(isSecretReference({ type: 'file', path: '/path/to/secret' })).toBe(true);
    expect(isSecretReference({ type: 'vault', key: 'secret/key' })).toBe(true);
    expect(isSecretReference({ type: 'inline', value: 'secret' })).toBe(true);
  });

  it('should return false for non-secret references', () => {
    expect(isSecretReference(null)).toBe(false);
    expect(isSecretReference(undefined)).toBe(false);
    expect(isSecretReference('plain-string')).toBe(false);
    expect(isSecretReference({})).toBe(false);
    expect(isSecretReference({ type: 'invalid' })).toBe(false);
  });
});

describe('createBaseProviderConfig', () => {
  it('should create config with required fields', () => {
    const config = createBaseProviderConfig({
      id: 'test',
      name: 'Test',
      vendorFamily: 'anthropic',
    });
    expect(config.id).toBe('test');
    expect(config.name).toBe('Test');
    expect(config.vendorFamily).toBe('anthropic');
    expect(config.enabled).toBe(true);
    expect(config.priority).toBe(50);
  });

  it('should throw on invalid input', () => {
    expect(() =>
      createBaseProviderConfig({
        id: '',
        name: 'Test',
        vendorFamily: 'anthropic',
      })
    ).toThrow();
  });
});
