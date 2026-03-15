/**
 * Tests for Anthropic Provider Configuration
 */

import { describe, it, expect } from 'vitest';
import {
  anthropicProviderConfigSchema,
  createAnthropicConfig,
  isAnthropicConfig,
  getAnthropicModelFamily,
  supportsExtendedThinking,
  ANTHROPIC_MODEL_ALIASES,
} from './anthropic';
import { envSecret, inlineSecret } from './secrets';

describe('anthropicProviderConfigSchema', () => {
  it('should parse valid Anthropic config', () => {
    const config = {
      id: 'test-anthropic',
      name: 'Test Anthropic',
      vendorFamily: 'anthropic' as const,
      apiKey: inlineSecret('test-key'),
    };
    const result = anthropicProviderConfigSchema.parse(config);
    expect(result.id).toBe('test-anthropic');
    expect(result.vendorFamily).toBe('anthropic');
    expect(result.baseUrl).toBe('https://api.anthropic.com/v1');
    expect(result.apiVersion).toBe('2023-06-01');
  });

  it('should accept custom baseUrl', () => {
    const config = {
      id: 'test-anthropic',
      name: 'Test Anthropic',
      vendorFamily: 'anthropic' as const,
      baseUrl: 'https://custom.anthropic.com/v1',
      apiKey: 'test-key',
    };
    const result = anthropicProviderConfigSchema.parse(config);
    expect(result.baseUrl).toBe('https://custom.anthropic.com/v1');
  });

  it('should accept all optional fields', () => {
    const config = {
      id: 'test-anthropic',
      name: 'Test Anthropic',
      vendorFamily: 'anthropic' as const,
      apiKey: envSecret('ANTHROPIC_API_KEY'),
      apiVersion: '2024-01-01',
      defaultModel: 'claude-opus-4-20250514',
      messagesModel: 'claude-sonnet-4-20250514',
      betas: ['max-tokens-3-5-sonnet-2024-07-15'],
      enableExtendedThinking: true,
      maxThinkingTokens: 10000,
      enableTools: true,
      enableVision: true,
      enableStreaming: true,
      defaultMaxTokens: 8192,
      defaultTemperature: 0.5,
      systemPrompt: 'You are a helpful assistant.',
    };
    const result = anthropicProviderConfigSchema.parse(config);
    expect(result.apiVersion).toBe('2024-01-01');
    expect(result.defaultModel).toBe('claude-opus-4-20250514');
    expect(result.enableExtendedThinking).toBe(true);
    expect(result.maxThinkingTokens).toBe(10000);
    expect(result.betas).toContain('max-tokens-3-5-sonnet-2024-07-15');
  });

  it('should reject invalid vendorFamily', () => {
    const config = {
      id: 'test',
      name: 'Test',
      vendorFamily: 'openai-compatible',
      apiKey: 'key',
    };
    expect(() => anthropicProviderConfigSchema.parse(config)).toThrow();
  });

  it('should apply defaults', () => {
    const config = {
      id: 'test',
      name: 'Test',
      vendorFamily: 'anthropic' as const,
    };
    const result = anthropicProviderConfigSchema.parse(config);
    expect(result.baseUrl).toBe('https://api.anthropic.com/v1');
    expect(result.apiVersion).toBe('2023-06-01');
    expect(result.defaultModel).toBe('claude-sonnet-4-20250514');
    expect(result.enableTools).toBe(true);
    expect(result.enableVision).toBe(true);
    expect(result.enableStreaming).toBe(true);
    expect(result.defaultMaxTokens).toBe(4096);
    expect(result.defaultTemperature).toBe(0.7);
  });
});

describe('createAnthropicConfig', () => {
  it('should create standard Anthropic config', () => {
    const config = createAnthropicConfig({
      apiKey: inlineSecret('test-key'),
    });
    expect(config.id).toBe('anthropic');
    expect(config.name).toBe('Anthropic');
    expect(config.vendorFamily).toBe('anthropic');
    expect(config.baseUrl).toBe('https://api.anthropic.com/v1');
    expect(config.defaultModel).toBe('claude-sonnet-4-20250514');
    expect(config.enableVision).toBe(true);
  });

  it('should allow overriding defaults', () => {
    const config = createAnthropicConfig({
      apiKey: 'test-key',
      id: 'custom-anthropic',
      name: 'Custom Anthropic',
      defaultModel: 'claude-opus-4-20250514',
      enableExtendedThinking: true,
    });
    expect(config.id).toBe('custom-anthropic');
    expect(config.name).toBe('Custom Anthropic');
    expect(config.defaultModel).toBe('claude-opus-4-20250514');
    expect(config.enableExtendedThinking).toBe(true);
  });
});

describe('isAnthropicConfig', () => {
  it('should return true for Anthropic config', () => {
    const config = createAnthropicConfig({ apiKey: 'key' });
    expect(isAnthropicConfig(config)).toBe(true);
  });

  it('should return false for other vendor families', () => {
    const config = {
      id: 'test',
      name: 'Test',
      vendorFamily: 'openai-compatible' as const,
      enabled: true,
      priority: 50,
    };
    expect(isAnthropicConfig(config)).toBe(false);
  });
});

describe('getAnthropicModelFamily', () => {
  it('should identify claude-4 family', () => {
    expect(getAnthropicModelFamily('claude-opus-4-20250514')).toBe('claude-4');
    expect(getAnthropicModelFamily('claude-sonnet-4-20250514')).toBe('claude-4');
  });

  it('should identify claude-3.5 family', () => {
    expect(getAnthropicModelFamily('claude-3-5-sonnet-20241022')).toBe('claude-3.5');
    expect(getAnthropicModelFamily('claude-3-5-haiku-20241022')).toBe('claude-3.5');
  });

  it('should identify claude-3 family', () => {
    expect(getAnthropicModelFamily('claude-3-opus-20240229')).toBe('claude-3');
    expect(getAnthropicModelFamily('claude-3-sonnet-20240229')).toBe('claude-3');
    expect(getAnthropicModelFamily('claude-3-haiku-20240307')).toBe('claude-3');
  });

  it('should return null for unknown models', () => {
    expect(getAnthropicModelFamily('unknown-model')).toBe(null);
    expect(getAnthropicModelFamily('gpt-4')).toBe(null);
  });
});

describe('supportsExtendedThinking', () => {
  it('should return true for claude-4 models', () => {
    expect(supportsExtendedThinking('claude-opus-4-20250514')).toBe(true);
    expect(supportsExtendedThinking('claude-sonnet-4-20250514')).toBe(true);
  });

  it('should return false for claude-3.x models', () => {
    expect(supportsExtendedThinking('claude-3-5-sonnet-20241022')).toBe(false);
    expect(supportsExtendedThinking('claude-3-opus-20240229')).toBe(false);
  });
});

describe('ANTHROPIC_MODEL_ALIASES', () => {
  it('should contain common model aliases', () => {
    expect(ANTHROPIC_MODEL_ALIASES['claude-opus-4-20250514']).toBe(
      'claude-opus-4-20250514'
    );
    expect(ANTHROPIC_MODEL_ALIASES['claude-sonnet-4-20250514']).toBe(
      'claude-sonnet-4-20250514'
    );
    expect(ANTHROPIC_MODEL_ALIASES['claude-3-5-sonnet-20241022']).toBe(
      'claude-3-5-sonnet-20241022'
    );
  });
});
