/**
 * Adapter Contract Tests for OpenAI-Compatible Provider
 *
 * These tests validate that the adapter satisfies the common provider interface.
 * Note: Some tests are skipped because they require real API calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { describeProviderAdapterContract } from '@openaidy/runtime/adapter-contract';
import { createOpenAICompatibleProvider } from './adapter';

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
  // Mock listModels
  mockFetch.mockImplementation(async (url: string, options?: { body?: string }) => {
    if (url.endsWith('/models')) {
      return {
        ok: true,
        json: async () => ({
          object: 'list',
          data: [
            { id: 'gpt-4o', object: 'model', created: 1700000000, owned_by: 'openai' },
          ],
        }),
      };
    }

    if (url.includes('/models/')) {
      const modelId = url.split('/models/')[1];
      if (modelId === 'test-model') {
        return {
          ok: true,
          json: async () => ({
            id: 'test-model',
            object: 'model',
            created: 1700000000,
            owned_by: 'openai',
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

    // Mock chat completions
    if (url.endsWith('/chat/completions')) {
      // Check if the request body contains an invalid model
      const body = options?.body;
      if (body) {
        try {
          const parsed = JSON.parse(body);
          if (parsed.model && parsed.model.includes('invalid')) {
            return new Response(
              JSON.stringify({
                error: {
                  message: `Model '${parsed.model}' not found`,
                  type: 'invalid_request_error',
                  code: 'model_not_found',
                },
              }),
              {
                status: 404,
                statusText: 'Not Found',
                headers: { 'Content-Type': 'application/json' },
              }
            );
          }
        } catch {
          // Ignore parse errors
        }
      }

      return {
        ok: true,
        json: async () => ({
          id: 'chatcmpl_123',
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: 'test-model',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: 'Hello, World!',
              },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 5,
            total_tokens: 15,
          },
        }),
      };
    }

    return { ok: false, status: 404 };
  });
}

// Run the adapter contract tests with mocking
describe('OpenAI-Compatible Adapter Contract', () => {
  beforeEach(() => {
    setupMockResponses();
  });

  // Create provider with mocked responses
  describeProviderAdapterContract('OpenAI-Compatible', {
    createProvider: () =>
      createOpenAICompatibleProvider({
        apiKey: 'test-key',
        providerId: 'test-provider',
        providerName: 'Test Provider',
      }),
    supportedCapabilities: ['text_generation', 'streaming', 'tool_calls'],
    defaultModelId: 'test-model',
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
    const provider = createOpenAICompatibleProvider({
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
    const provider = createOpenAICompatibleProvider({
      apiKey: 'test-key',
    });

    const { descriptor } = provider;

    expect(typeof descriptor.id).toBe('string');
    expect(descriptor.id.length).toBeGreaterThan(0);
    expect(typeof descriptor.name).toBe('string');
    expect(descriptor.name.length).toBeGreaterThan(0);
    expect(typeof descriptor.vendorFamily).toBe('string');
    expect(descriptor.vendorFamily).toBe('openai-compatible');
    expect(Array.isArray(descriptor.capabilities)).toBe(true);
    expect(descriptor.capabilities.length).toBeGreaterThan(0);
  });

  it('should support text_generation capability', () => {
    const provider = createOpenAICompatibleProvider({ apiKey: 'test-key' });
    expect(provider.hasCapability('text_generation')).toBe(true);
  });

  it('should correctly report capabilities', async () => {
    const provider = createOpenAICompatibleProvider({
      apiKey: 'test-key',
      enableStreaming: true,
      enableTools: true,
    });

    expect(provider.hasCapability('streaming')).toBe(true);
    expect(provider.hasCapability('tool_calls')).toBe(true);
    expect(provider.hasCapability('vision')).toBe(false);
    expect(provider.hasCapability('embedding')).toBe(false);
  });
});
