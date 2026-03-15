/**
 * Tests for Gemini Provider Configuration
 */

import { describe, it, expect } from 'vitest';
import {
  geminiProviderConfigSchema,
  createGeminiConfig,
  createVertexAIGeminiConfig,
  isGeminiConfig,
  getGeminiModelFamily,
  supportsAudioInput,
  isEmbeddingModel,
  GEMINI_MODEL_ALIASES,
  GEMINI_EMBEDDING_ALIASES,
} from './gemini';
import { envSecret, inlineSecret } from './secrets';

describe('geminiProviderConfigSchema', () => {
  it('should parse valid Gemini config', () => {
    const config = {
      id: 'test-gemini',
      name: 'Test Gemini',
      vendorFamily: 'gemini' as const,
      apiKey: inlineSecret('test-key'),
    };
    const result = geminiProviderConfigSchema.parse(config);
    expect(result.id).toBe('test-gemini');
    expect(result.vendorFamily).toBe('gemini');
    expect(result.baseUrl).toBe('https://generativelanguage.googleapis.com/v1beta');
  });

  it('should accept custom baseUrl', () => {
    const config = {
      id: 'test-gemini',
      name: 'Test Gemini',
      vendorFamily: 'gemini' as const,
      baseUrl: 'https://custom.googleapis.com/v1',
      apiKey: 'test-key',
    };
    const result = geminiProviderConfigSchema.parse(config);
    expect(result.baseUrl).toBe('https://custom.googleapis.com/v1');
  });

  it('should accept all optional fields', () => {
    const config = {
      id: 'test-gemini',
      name: 'Test Gemini',
      vendorFamily: 'gemini' as const,
      apiKey: envSecret('GOOGLE_API_KEY'),
      projectId: 'my-project',
      region: 'europe-west1',
      useVertexAI: true,
      defaultModel: 'gemini-2.0-flash',
      embeddingModel: 'text-embedding-004',
      safetySettings: [
        {
          category: 'HARM_CATEGORY_HARASSMENT' as const,
          threshold: 'BLOCK_MEDIUM_AND_ABOVE' as const,
        },
      ],
      generationConfig: {
        temperature: 0.5,
        topP: 0.9,
        maxOutputTokens: 2048,
      },
      enableTools: true,
      enableVision: true,
      enableAudioInput: true,
      enableStreaming: true,
      defaultTemperature: 0.5,
      defaultMaxTokens: 4096,
      systemInstruction: 'You are a helpful assistant.',
    };
    const result = geminiProviderConfigSchema.parse(config);
    expect(result.projectId).toBe('my-project');
    expect(result.region).toBe('europe-west1');
    expect(result.useVertexAI).toBe(true);
    expect(result.safetySettings).toHaveLength(1);
    expect(result.generationConfig?.temperature).toBe(0.5);
  });

  it('should reject invalid vendorFamily', () => {
    const config = {
      id: 'test',
      name: 'Test',
      vendorFamily: 'openai-compatible',
      apiKey: 'key',
    };
    expect(() => geminiProviderConfigSchema.parse(config)).toThrow();
  });

  it('should apply defaults', () => {
    const config = {
      id: 'test',
      name: 'Test',
      vendorFamily: 'gemini' as const,
    };
    const result = geminiProviderConfigSchema.parse(config);
    expect(result.baseUrl).toBe('https://generativelanguage.googleapis.com/v1beta');
    expect(result.useVertexAI).toBe(false);
    expect(result.region).toBe('us-central1');
    expect(result.defaultModel).toBe('gemini-2.0-flash');
    expect(result.embeddingModel).toBe('text-embedding-004');
    expect(result.enableTools).toBe(true);
    expect(result.enableVision).toBe(true);
    expect(result.enableAudioInput).toBe(true);
    expect(result.enableStreaming).toBe(true);
    expect(result.defaultMaxTokens).toBe(8192);
    expect(result.defaultTemperature).toBe(0.7);
  });

  it('should accept safety settings', () => {
    const config = {
      id: 'test',
      name: 'Test',
      vendorFamily: 'gemini' as const,
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_LOW_AND_ABOVE' },
      ],
    };
    const result = geminiProviderConfigSchema.parse(config);
    expect(result.safetySettings).toHaveLength(2);
  });
});

describe('createGeminiConfig', () => {
  it('should create standard Gemini config', () => {
    const config = createGeminiConfig({
      apiKey: inlineSecret('test-key'),
    });
    expect(config.id).toBe('gemini');
    expect(config.name).toBe('Google Gemini');
    expect(config.vendorFamily).toBe('gemini');
    expect(config.baseUrl).toBe('https://generativelanguage.googleapis.com/v1beta');
    expect(config.useVertexAI).toBe(false);
    expect(config.defaultModel).toBe('gemini-2.0-flash');
    expect(config.enableVision).toBe(true);
    expect(config.enableAudioInput).toBe(true);
  });

  it('should allow overriding defaults', () => {
    const config = createGeminiConfig({
      apiKey: 'test-key',
      id: 'custom-gemini',
      name: 'Custom Gemini',
      defaultModel: 'gemini-1.5-pro',
      enableAudioInput: false,
    });
    expect(config.id).toBe('custom-gemini');
    expect(config.name).toBe('Custom Gemini');
    expect(config.defaultModel).toBe('gemini-1.5-pro');
    expect(config.enableAudioInput).toBe(false);
  });
});

describe('createVertexAIGeminiConfig', () => {
  it('should create Vertex AI Gemini config', () => {
    const config = createVertexAIGeminiConfig({
      projectId: 'my-project',
      apiKey: inlineSecret('test-key'),
    });
    expect(config.id).toBe('vertexai-gemini');
    expect(config.name).toBe('Vertex AI Gemini');
    expect(config.useVertexAI).toBe(true);
    expect(config.projectId).toBe('my-project');
    expect(config.region).toBe('us-central1');
  });

  it('should allow overriding defaults', () => {
    const config = createVertexAIGeminiConfig({
      projectId: 'my-project',
      apiKey: 'test-key',
      region: 'europe-west1',
      defaultModel: 'gemini-1.5-pro',
    });
    expect(config.region).toBe('europe-west1');
    expect(config.defaultModel).toBe('gemini-1.5-pro');
  });
});

describe('isGeminiConfig', () => {
  it('should return true for Gemini config', () => {
    const config = createGeminiConfig({ apiKey: 'key' });
    expect(isGeminiConfig(config)).toBe(true);
  });

  it('should return false for other vendor families', () => {
    const config = {
      id: 'test',
      name: 'Test',
      vendorFamily: 'openai-compatible' as const,
      enabled: true,
      priority: 50,
    };
    expect(isGeminiConfig(config)).toBe(false);
  });
});

describe('getGeminiModelFamily', () => {
  it('should identify gemini-2.5 family', () => {
    expect(getGeminiModelFamily('gemini-2.5-pro-preview-06-05')).toBe('gemini-2.5');
    expect(getGeminiModelFamily('gemini-2.5-pro')).toBe('gemini-2.5');
  });

  it('should identify gemini-2.0 family', () => {
    expect(getGeminiModelFamily('gemini-2.0-flash')).toBe('gemini-2.0');
    expect(getGeminiModelFamily('gemini-2.0-flash-lite')).toBe('gemini-2.0');
  });

  it('should identify gemini-1.5 family', () => {
    expect(getGeminiModelFamily('gemini-1.5-pro')).toBe('gemini-1.5');
    expect(getGeminiModelFamily('gemini-1.5-flash')).toBe('gemini-1.5');
    expect(getGeminiModelFamily('gemini-1.5-flash-8b')).toBe('gemini-1.5');
  });

  it('should identify gemini-1.0 family', () => {
    expect(getGeminiModelFamily('gemini-1.0-pro')).toBe('gemini-1.0');
    expect(getGeminiModelFamily('gemini-pro')).toBe('gemini-1.0');
  });

  it('should return null for unknown models', () => {
    expect(getGeminiModelFamily('unknown-model')).toBe(null);
    expect(getGeminiModelFamily('gpt-4')).toBe(null);
  });
});

describe('supportsAudioInput', () => {
  it('should return true for gemini-2.x models', () => {
    expect(supportsAudioInput('gemini-2.0-flash')).toBe(true);
    expect(supportsAudioInput('gemini-2.5-pro')).toBe(true);
  });

  it('should return true for gemini-1.5 models', () => {
    expect(supportsAudioInput('gemini-1.5-pro')).toBe(true);
    expect(supportsAudioInput('gemini-1.5-flash')).toBe(true);
  });

  it('should return false for gemini-1.0 models', () => {
    expect(supportsAudioInput('gemini-1.0-pro')).toBe(false);
    expect(supportsAudioInput('gemini-pro')).toBe(false);
  });

  it('should return false for unknown models', () => {
    expect(supportsAudioInput('unknown-model')).toBe(false);
  });
});

describe('isEmbeddingModel', () => {
  it('should return true for embedding models', () => {
    expect(isEmbeddingModel('text-embedding-004')).toBe(true);
    expect(isEmbeddingModel('text-embedding-005')).toBe(true);
    expect(isEmbeddingModel('text-multilingual-embedding-002')).toBe(true);
  });

  it('should return false for non-embedding models', () => {
    expect(isEmbeddingModel('gemini-2.0-flash')).toBe(false);
    expect(isEmbeddingModel('gemini-1.5-pro')).toBe(false);
  });
});

describe('GEMINI_MODEL_ALIASES', () => {
  it('should contain common model aliases', () => {
    expect(GEMINI_MODEL_ALIASES['gemini-2.0-flash']).toBe('gemini-2.0-flash');
    expect(GEMINI_MODEL_ALIASES['gemini-1.5-pro']).toBe('gemini-1.5-pro');
    expect(GEMINI_MODEL_ALIASES['text-embedding-004']).toBe('text-embedding-004');
  });
});

describe('GEMINI_EMBEDDING_ALIASES', () => {
  it('should contain embedding model aliases', () => {
    expect(GEMINI_EMBEDDING_ALIASES['text-embedding-004']).toBe('text-embedding-004');
    expect(GEMINI_EMBEDDING_ALIASES['text-embedding-005']).toBe('text-embedding-005');
    expect(GEMINI_EMBEDDING_ALIASES['text-multilingual-embedding-002']).toBe(
      'text-multilingual-embedding-002'
    );
  });
});
