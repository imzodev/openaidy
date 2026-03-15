/**
 * Tests for Secret Handling Abstraction
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  secretReferenceSchema,
  envSecret,
  fileSecret,
  vaultSecret,
  inlineSecret,
  secretOk,
  secretErr,
  InlineSecretProvider,
  EnvSecretProvider,
  CompositeSecretProvider,
  createDefaultSecretProvider,
  type SecretReference,
} from './secrets';

describe('secretReferenceSchema', () => {
  describe('env secret reference', () => {
    it('should parse valid env secret reference', () => {
      const result = secretReferenceSchema.parse({
        type: 'env',
        name: 'API_KEY',
      });
      expect(result).toEqual({ type: 'env', name: 'API_KEY' });
    });

    it('should reject env secret without name', () => {
      expect(() => secretReferenceSchema.parse({ type: 'env' })).toThrow();
      expect(() =>
        secretReferenceSchema.parse({ type: 'env', name: '' })
      ).toThrow();
    });
  });

  describe('file secret reference', () => {
    it('should parse valid file secret reference', () => {
      const result = secretReferenceSchema.parse({
        type: 'file',
        path: '/path/to/secret',
      });
      expect(result).toEqual({ type: 'file', path: '/path/to/secret' });
    });

    it('should reject file secret without path', () => {
      expect(() => secretReferenceSchema.parse({ type: 'file' })).toThrow();
    });
  });

  describe('vault secret reference', () => {
    it('should parse valid vault secret reference', () => {
      const result = secretReferenceSchema.parse({
        type: 'vault',
        key: 'secret/api/key',
      });
      expect(result).toEqual({ type: 'vault', key: 'secret/api/key' });
    });

    it('should parse vault secret with mount', () => {
      const result = secretReferenceSchema.parse({
        type: 'vault',
        key: 'secret/api/key',
        mount: 'secrets',
      });
      expect(result).toEqual({
        type: 'vault',
        key: 'secret/api/key',
        mount: 'secrets',
      });
    });

    it('should reject vault secret without key', () => {
      expect(() => secretReferenceSchema.parse({ type: 'vault' })).toThrow();
    });
  });

  describe('inline secret reference', () => {
    it('should parse valid inline secret reference', () => {
      const result = secretReferenceSchema.parse({
        type: 'inline',
        value: 'my-secret',
      });
      expect(result).toEqual({ type: 'inline', value: 'my-secret' });
    });
  });

  it('should reject unknown secret types', () => {
    expect(() =>
      secretReferenceSchema.parse({ type: 'unknown', key: 'value' })
    ).toThrow();
  });
});

describe('secret reference helpers', () => {
  it('should create env secret reference', () => {
    expect(envSecret('API_KEY')).toEqual({ type: 'env', name: 'API_KEY' });
  });

  it('should create file secret reference', () => {
    expect(fileSecret('/path/to/secret')).toEqual({
      type: 'file',
      path: '/path/to/secret',
    });
  });

  it('should create vault secret reference', () => {
    expect(vaultSecret('secret/key')).toEqual({
      type: 'vault',
      key: 'secret/key',
    });
    expect(vaultSecret('secret/key', 'secrets')).toEqual({
      type: 'vault',
      key: 'secret/key',
      mount: 'secrets',
    });
  });

  it('should create inline secret reference', () => {
    expect(inlineSecret('my-secret')).toEqual({
      type: 'inline',
      value: 'my-secret',
    });
  });
});

describe('secret resolution result helpers', () => {
  it('should create successful result', () => {
    const result = secretOk('resolved-value');
    expect(result).toEqual({ ok: true, value: 'resolved-value' });
  });

  it('should create error result', () => {
    const result = secretErr('secret.not_found', 'Secret not found');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('secret.not_found');
      expect(result.error.message).toBe('Secret not found');
    }
  });

  it('should create error result with cause', () => {
    const cause = new Error('Original error');
    const result = secretErr('secret.unknown', 'Unknown error', cause);
    if (!result.ok) {
      expect(result.error.cause).toBe(cause);
    }
  });
});

describe('InlineSecretProvider', () => {
  let provider: InlineSecretProvider;

  beforeEach(() => {
    provider = new InlineSecretProvider();
  });

  it('should resolve inline secrets', async () => {
    const ref = inlineSecret('my-secret');
    expect(provider.canResolve(ref)).toBe(true);

    const result = await provider.resolve(ref);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('my-secret');
    }
  });

  it('should not resolve non-inline secrets', () => {
    expect(provider.canResolve(envSecret('API_KEY'))).toBe(false);
    expect(provider.canResolve(fileSecret('/path'))).toBe(false);
    expect(provider.canResolve(vaultSecret('key'))).toBe(false);
  });

  it('should return error for non-inline secrets', async () => {
    const result = await provider.resolve(envSecret('API_KEY'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('secret.invalid_reference');
    }
  });
});

describe('EnvSecretProvider', () => {
  let provider: EnvSecretProvider;
  let envSource: Record<string, string | undefined>;

  beforeEach(() => {
    envSource = {
      API_KEY: 'test-api-key',
      SECRET_TOKEN: 'test-token',
      EMPTY_VAR: '',
    };
    provider = new EnvSecretProvider(envSource);
  });

  it('should resolve env secrets', async () => {
    const ref = envSecret('API_KEY');
    expect(provider.canResolve(ref)).toBe(true);

    const result = await provider.resolve(ref);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('test-api-key');
    }
  });

  it('should return error for missing env var', async () => {
    const result = await provider.resolve(envSecret('MISSING_VAR'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('secret.not_found');
      expect(result.error.message).toContain('MISSING_VAR');
    }
  });

  it('should return error for empty env var', async () => {
    const result = await provider.resolve(envSecret('EMPTY_VAR'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('secret.not_found');
    }
  });

  it('should not resolve non-env secrets', () => {
    expect(provider.canResolve(inlineSecret('value'))).toBe(false);
    expect(provider.canResolve(fileSecret('/path'))).toBe(false);
  });
});

describe('CompositeSecretProvider', () => {
  let provider: CompositeSecretProvider;
  let envSource: Record<string, string | undefined>;

  beforeEach(() => {
    envSource = {
      API_KEY: 'env-api-key',
    };
    provider = new CompositeSecretProvider([
      new InlineSecretProvider(),
      new EnvSecretProvider(envSource),
    ]);
  });

  it('should resolve inline secrets', async () => {
    const result = await provider.resolve(inlineSecret('inline-value'));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('inline-value');
    }
  });

  it('should resolve env secrets', async () => {
    const result = await provider.resolve(envSecret('API_KEY'));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('env-api-key');
    }
  });

  it('should return error when no provider available', async () => {
    const result = await provider.resolve(vaultSecret('secret/key'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('secret.provider_unavailable');
    }
  });

  it('should support adding providers', async () => {
    const customProvider = {
      canResolve: (ref: SecretReference) => ref.type === 'vault',
      resolve: async (ref: SecretReference) => {
        if (ref.type === 'vault') {
          return secretOk('vault-secret');
        }
        return secretErr('secret.invalid_reference', 'Invalid');
      },
    };

    provider.addProvider(customProvider);
    expect(provider.canResolve(vaultSecret('key'))).toBe(true);

    const result = await provider.resolve(vaultSecret('key'));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('vault-secret');
    }
  });
});

describe('createDefaultSecretProvider', () => {
  it('should create provider with inline and env providers', () => {
    const envSource = { TEST_KEY: 'test-value' };
    const provider = createDefaultSecretProvider(envSource);

    expect(provider.canResolve(inlineSecret('value'))).toBe(true);
    expect(provider.canResolve(envSecret('TEST_KEY'))).toBe(true);
  });

  it('should resolve secrets correctly', async () => {
    const envSource = { API_KEY: 'test-api-key' };
    const provider = createDefaultSecretProvider(envSource);

    const result = await provider.resolve(envSecret('API_KEY'));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('test-api-key');
    }
  });
});
