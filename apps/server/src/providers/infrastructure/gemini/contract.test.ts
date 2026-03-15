/**
 * Adapter Contract Tests for Gemini Provider
 *
 * These tests validate that the adapter satisfies the common provider interface.
 * Note: Some tests are skipped because they require real API calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { describeProviderAdapterContract } from '@openaidy/runtime/adapter-contract';
import { createGeminiProvider } from './adapter';

// Mock fetch for contract tests
const originalFetch = global.fetch;
let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch = vi.fn();
  global.fetch = mockFetch;
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.clearAllMocks();
});

// Set up mock responses for contract tests
function setupMockResponses() {
  mockFetch.mockImplementation(async (url: string, options?: { body?: string }) => {
    // Mock listModels
    if (url.includes('/models?key=')) {
      return {
        ok: true,
        json: async () => ({
          models: [
            { name: 'models/gemini-2.0-flash', displayName: 'Gemini 2.0 Flash' },
          ],
        }),
      };
    }

    // Mock getModel
    if (url.includes('/models/') && !url.includes(':generateContent')) {
      const urlParts = url.split('/models/');
      const modelId = urlParts[1]?.split('?')[0];
      if (modelId === 'test-model') {
        return {
          ok: true,
          json: async () => ({
            name: `models/${modelId}`,
            displayName: 'Test Model',
          }),
        };
      }
      return {
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: new Headers(),
      };
    }

    // Mock generateContent
    if (url.includes(':generateContent')) {
      // Check if model is invalid (contract test for invalid model)
      const urlModel = url.split('/models/')[1]?.split(':')[0];
      if (urlModel && urlModel.includes('invalid')) {
        return new Response(
          JSON.stringify({
            error: {
              code: 404,
              message: `Model '${urlModel}' not found`,
              status: 'NOT_FOUND',
            },
          }),
          {
            status: 404,
            statusText: 'Not Found',
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }

      return {
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                role: 'model',
                parts: [{ text: 'Hello, World!' }],
              },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 5,
            totalTokenCount: 15,
          },
        }),
      };
    }

    return { ok: false, status: 404 };
  });
}

// Run the adapter contract tests with mocking
describe('Gemini Adapter Contract', () => {
  beforeEach(() => {
    setupMockResponses();
  });

  // Create provider with mocked responses
  describeProviderAdapterContract('Gemini', {
    createProvider: () =>
      createGeminiProvider({
        apiKey: 'test-key',
        providerId: 'test-gemini',
        providerName: 'Test Gemini',
      }),
    supportedCapabilities: ['text_generation', 'streaming', 'tool_calls', 'vision', 'audio_input'],
    defaultModelId: 'gemini-2.0-flash',
    skipTests: [
      // Skip streaming tests that require actual SSE handling
      'stream success',
      'stream started',
      'stream content delta',
      'stream finished',
      'stream usage',
    ],
  });
});

// Additional contract validation tests
describe('Adapter Contract Validation', () => {
  beforeEach(() => {
    setupMockResponses();
  });

  it('should implement ModelProvider interface correctly', () => {
    const provider = createGeminiProvider({
      apiKey: 'test-key',
      providerId: 'test',
      providerName: 'Test',
    });

    // Check all required methods exist
    expect(typeof provider.descriptor).toBe('object');
    expect(typeof provider.listModels).toBe('function');
    expect(typeof provider.getModel).toBe('function');
    expect(typeof provider.hasCapability).toBe('function');
    expect(typeof provider.invoke).toBe('function');
    expect(typeof provider.invokeStream).toBe('function');
  });

  it('should have valid descriptor structure', () => {
    const provider = createGeminiProvider({
      apiKey: 'test-key',
    });

    const { descriptor } = provider;

    expect(typeof descriptor.id).toBe('string');
    expect(descriptor.id.length).toBeGreaterThan(0);
    expect(typeof descriptor.name).toBe('string');
    expect(descriptor.name.length).toBeGreaterThan(0);
    expect(typeof descriptor.vendorFamily).toBe('string');
    expect(descriptor.vendorFamily).toBe('gemini');
    expect(Array.isArray(descriptor.capabilities)).toBe(true);
    expect(descriptor.capabilities.length).toBeGreaterThan(0);
  });

  it('should support text_generation capability', () => {
    const provider = createGeminiProvider({ apiKey: 'test-key' });
    expect(provider.hasCapability('text_generation')).toBe(true);
  });

  it('should correctly report capabilities', async () => {
    const provider = createGeminiProvider({
      apiKey: 'test-key',
      enableStreaming: true,
      enableTools: true,
      enableVision: true,
      enableAudioInput: true,
    });

    expect(provider.hasCapability('streaming')).toBe(true);
    expect(provider.hasCapability('tool_calls')).toBe(true);
    expect(provider.hasCapability('vision')).toBe(true);
    expect(provider.hasCapability('audio_input')).toBe(true);
    expect(provider.hasCapability('embedding')).toBe(false);
  });

  it('should support capability configuration', async () => {
    const provider = createGeminiProvider({
      apiKey: 'test-key',
      enableStreaming: false,
      enableTools: false,
      enableVision: false,
      enableAudioInput: false,
    });

    expect(provider.hasCapability('streaming')).toBe(false);
    expect(provider.hasCapability('tool_calls')).toBe(false);
    expect(provider.hasCapability('vision')).toBe(false);
    expect(provider.hasCapability('audio_input')).toBe(false);
    // text_generation should always be supported
    expect(provider.hasCapability('text_generation')).toBe(true);
  });
});
