/**
 * Tests for OpenAI-Compatible Provider Configuration
 */

import { describe, it, expect } from 'vitest';
import {
  openaiCompatibleProviderConfigSchema,
  createOpenAIConfig,
  createOpenAICompatibleConfig,
  createCompatibleConfig,
  isOpenAICompatibleConfig,
  OPENAI_MODEL_ALIASES,
} from './openai-compatible';
import { envSecret, inlineSecret } from './secrets';

describe('openaiCompatibleProviderConfigSchema', () => {
  it('should parse valid OpenAI-compatible config', () => {
    const config = {
      id: 'test-openai',
      name: 'Test OpenAI',
      vendorFamily: 'openai-compatible' as const,
      apiKey: inlineSecret('test-key'),
    };
    const result = openaiCompatibleProviderConfigSchema.parse(config);
    expect(result.id).toBe('test-openai');
    expect(result.vendorFamily).toBe('openai-compatible');
    expect(result.baseUrl).toBe('https://api.openai.com/v1');
  });

  it('should accept custom baseUrl', () => {
    const config = {
      id: 'test-compatible',
      name: 'Test Compatible',
      vendorFamily: 'openai-compatible' as const,
      baseUrl: 'https://api.custom.com/v1',
      apiKey: 'test-key',
    };
    const result = openaiCompatibleProviderConfigSchema.parse(config);
    expect(result.baseUrl).toBe('https://api.custom.com/v1');
  });

  it('should accept all optional fields', () => {
    const config = {
      id: 'test-openai',
      name: 'Test OpenAI',
      vendorFamily: 'openai-compatible' as const,
      apiKey: envSecret('OPENAI_API_KEY'),
      chatModel: 'gpt-4o',
      embeddingModel: 'text-embedding-3-small',
      audioModel: 'whisper-1',
      imageModel: 'dall-e-3',
      useResponsesApi: true,
      enableTools: true,
      enableVision: true,
      enableStreaming: true,
      defaultTemperature: 0.5,
      defaultMaxTokens: 2000,
    };
    const result = openaiCompatibleProviderConfigSchema.parse(config);
    expect(result.chatModel).toBe('gpt-4o');
    expect(result.embeddingModel).toBe('text-embedding-3-small');
    expect(result.useResponsesApi).toBe(true);
    expect(result.defaultTemperature).toBe(0.5);
  });

  it('should reject invalid vendorFamily', () => {
    const config = {
      id: 'test',
      name: 'Test',
      vendorFamily: 'anthropic',
      apiKey: 'key',
    };
    expect(() => openaiCompatibleProviderConfigSchema.parse(config)).toThrow();
  });

  it('should apply defaults', () => {
    const config = {
      id: 'test',
      name: 'Test',
      vendorFamily: 'openai-compatible' as const,
    };
    const result = openaiCompatibleProviderConfigSchema.parse(config);
    expect(result.baseUrl).toBe('https://api.openai.com/v1');
    expect(result.useResponsesApi).toBe(false);
    expect(result.enableTools).toBe(true);
    expect(result.enableStreaming).toBe(true);
    expect(result.defaultTemperature).toBe(0.7);
    expect(result.defaultMaxTokens).toBe(4096);
  });
});

describe('createOpenAIConfig', () => {
  it('should create standard OpenAI config', () => {
    const config = createOpenAIConfig({
      apiKey: inlineSecret('test-key'),
    });
    expect(config.id).toBe('openai');
    expect(config.name).toBe('OpenAI');
    expect(config.vendorFamily).toBe('openai-compatible');
    expect(config.baseUrl).toBe('https://api.openai.com/v1');
    expect(config.defaultModel).toBe('gpt-4o');
    expect(config.enableVision).toBe(true);
  });

  it('should allow overriding defaults', () => {
    const config = createOpenAIConfig({
      apiKey: 'test-key',
      id: 'custom-openai',
      name: 'Custom OpenAI',
      defaultModel: 'gpt-4-turbo',
      enableVision: false,
    });
    expect(config.id).toBe('custom-openai');
    expect(config.name).toBe('Custom OpenAI');
    expect(config.defaultModel).toBe('gpt-4-turbo');
    expect(config.enableVision).toBe(false);
  });
});

describe('createOpenAICompatibleConfig', () => {
  it('should create compatible config with required fields', () => {
    const config = createOpenAICompatibleConfig({
      id: 'deepseek',
      name: 'DeepSeek',
      apiKey: envSecret('DEEPSEEK_API_KEY'),
    });
    expect(config.id).toBe('deepseek');
    expect(config.vendorFamily).toBe('openai-compatible');
  });
});

describe('createCompatibleConfig', () => {
  it('should create compatible config with custom baseUrl', () => {
    const config = createCompatibleConfig('https://api.deepseek.com/v1', {
      id: 'deepseek',
      name: 'DeepSeek',
      apiKey: 'test-key',
    });
    expect(config.baseUrl).toBe('https://api.deepseek.com/v1');
    expect(config.enableTools).toBe(true);
    expect(config.enableVision).toBe(false);
  });
});

describe('isOpenAICompatibleConfig', () => {
  it('should return true for OpenAI-compatible config', () => {
    const config = createOpenAIConfig({ apiKey: 'key' });
    expect(isOpenAICompatibleConfig(config)).toBe(true);
  });

  it('should return false for other vendor families', () => {
    const config = {
      id: 'test',
      name: 'Test',
      vendorFamily: 'anthropic' as const,
      enabled: true,
      priority: 50,
    };
    expect(isOpenAICompatibleConfig(config)).toBe(false);
  });
});

describe('OPENAI_MODEL_ALIASES', () => {
  it('should contain common model aliases', () => {
    expect(OPENAI_MODEL_ALIASES['gpt-4']).toBe('gpt-4');
    expect(OPENAI_MODEL_ALIASES['gpt-4o']).toBe('gpt-4o');
    expect(OPENAI_MODEL_ALIASES['gpt-3.5-turbo']).toBe('gpt-3.5-turbo');
    expect(OPENAI_MODEL_ALIASES['text-embedding-3-small']).toBe(
      'text-embedding-3-small'
    );
  });
});
