/**
 * Adapter Contract Tests for Anthropic Provider
 *
 * These tests validate that the adapter satisfies the common provider interface.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { describeProviderAdapterContract } from '@openaidy/runtime/adapter-contract';
import { createAnthropicProvider } from './adapter';

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
  mockFetch.mockImplementation(async (url: string) => {
    // Mock listModels (returns static list, no API call needed)
    // Mock getModel (returns static model, no API call needed)

    // Mock generateContent (messages endpoint)
    if (url.includes('/messages')) {
      return {
        ok: true,
        json: async () => ({
          id: 'msg_test',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello, World!' }],
          model: 'claude-sonnet-4-20250514',
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      };
    }

    return { ok: false, status: 404 };
  });
}

// Run the adapter contract tests with mocking
describe('Anthropic Adapter Contract', () => {
  beforeEach(() => {
    setupMockResponses();
  });

  // Create provider with mocked responses
  describeProviderAdapterContract('Anthropic', {
    createProvider: () =>
      createAnthropicProvider({
        apiKey: 'test-key',
        providerId: 'test-anthropic',
        providerName: 'Test Anthropic',
      }),
    supportedCapabilities: ['text_generation', 'streaming', 'tool_calls', 'vision'],
    defaultModelId: 'claude-sonnet-4-20250514',
    skipTests: [
      // Skip streaming tests that require actual SSE handling
      'stream success',
      'stream started',
      'stream content delta',
      'stream finished',
      'stream usage',
      // Anthropic adapter returns generic descriptors for unknown models (by design)
      // This allows working with new models that aren't in the known list
      'model not found',
      'error invalid model',
    ],
  });
});

// Additional contract validation tests
describe('Adapter Contract Validation', () => {
  beforeEach(() => {
    setupMockResponses();
  });

  it('should implement ModelProvider interface correctly', () => {
    const provider = createAnthropicProvider({
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
    const provider = createAnthropicProvider({
      apiKey: 'test-key',
    });

    const { descriptor } = provider;

    expect(typeof descriptor.id).toBe('string');
    expect(descriptor.id.length).toBeGreaterThan(0);
    expect(typeof descriptor.name).toBe('string');
    expect(descriptor.name.length).toBeGreaterThan(0);
    expect(typeof descriptor.vendorFamily).toBe('string');
    expect(descriptor.vendorFamily).toBe('anthropic');
    expect(Array.isArray(descriptor.capabilities)).toBe(true);
    expect(descriptor.capabilities.length).toBeGreaterThan(0);
  });

  it('should support text_generation capability', () => {
    const provider = createAnthropicProvider({ apiKey: 'test-key' });
    expect(provider.hasCapability('text_generation')).toBe(true);
  });

  it('should correctly report capabilities', async () => {
    const provider = createAnthropicProvider({
      apiKey: 'test-key',
      enableStreaming: true,
      enableTools: true,
      enableVision: true,
    });

    expect(provider.hasCapability('streaming')).toBe(true);
    expect(provider.hasCapability('tool_calls')).toBe(true);
    expect(provider.hasCapability('vision')).toBe(true);
    expect(provider.hasCapability('embedding')).toBe(false);
  });

  it('should support capability configuration', async () => {
    const provider = createAnthropicProvider({
      apiKey: 'test-key',
      enableStreaming: false,
      enableTools: false,
      enableVision: false,
    });

    expect(provider.hasCapability('streaming')).toBe(false);
    expect(provider.hasCapability('tool_calls')).toBe(false);
    expect(provider.hasCapability('vision')).toBe(false);
    // text_generation should always be supported
    expect(provider.hasCapability('text_generation')).toBe(true);
  });
});
