/**
 * Tests for Gemini Provider Adapter
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createGeminiProvider,
  createGeminiStudioProvider,
  createVertexAIGeminiProvider,
} from './adapter';
import type { ModelRequest } from '@openaidy/runtime';

// Mock fetch
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

describe('GeminiProvider', () => {
  describe('descriptor', () => {
    it('should have correct descriptor with defaults', () => {
      const provider = createGeminiProvider({
        apiKey: 'test-key',
      });

      expect(provider.descriptor.id).toBe('gemini');
      expect(provider.descriptor.name).toBe('Google Gemini');
      expect(provider.descriptor.vendorFamily).toBe('gemini');
      expect(provider.descriptor.capabilities).toContain('text_generation');
      expect(provider.descriptor.capabilities).toContain('streaming');
      expect(provider.descriptor.capabilities).toContain('tool_calls');
      expect(provider.descriptor.capabilities).toContain('vision');
      expect(provider.descriptor.capabilities).toContain('audio_input');
    });

    it('should allow custom provider id and name', () => {
      const provider = createGeminiProvider({
        apiKey: 'test-key',
        providerId: 'custom-gemini',
        providerName: 'Custom Gemini',
      });

      expect(provider.descriptor.id).toBe('custom-gemini');
      expect(provider.descriptor.name).toBe('Custom Gemini');
    });

    it('should disable streaming capability when configured', () => {
      const provider = createGeminiProvider({
        apiKey: 'test-key',
        enableStreaming: false,
      });

      expect(provider.descriptor.capabilities).not.toContain('streaming');
    });

    it('should disable tool_calls capability when configured', () => {
      const provider = createGeminiProvider({
        apiKey: 'test-key',
        enableTools: false,
      });

      expect(provider.descriptor.capabilities).not.toContain('tool_calls');
    });

    it('should disable vision capability when configured', () => {
      const provider = createGeminiProvider({
        apiKey: 'test-key',
        enableVision: false,
      });

      expect(provider.descriptor.capabilities).not.toContain('vision');
    });

    it('should disable audio_input capability when configured', () => {
      const provider = createGeminiProvider({
        apiKey: 'test-key',
        enableAudioInput: false,
      });

      expect(provider.descriptor.capabilities).not.toContain('audio_input');
    });

    it('should show Vertex AI in description when useVertexAI is true', () => {
      const provider = createGeminiProvider({
        apiKey: 'test-token',
        useVertexAI: true,
      });

      expect(provider.descriptor.description).toContain('Vertex AI');
    });

    it('should show AI Studio in description when useVertexAI is false', () => {
      const provider = createGeminiProvider({
        apiKey: 'test-key',
        useVertexAI: false,
      });

      expect(provider.descriptor.description).toContain('AI Studio');
    });
  });

  describe('hasCapability', () => {
    it('should return true for supported capabilities', () => {
      const provider = createGeminiProvider({ apiKey: 'test-key' });

      expect(provider.hasCapability('text_generation')).toBe(true);
      expect(provider.hasCapability('streaming')).toBe(true);
      expect(provider.hasCapability('tool_calls')).toBe(true);
      expect(provider.hasCapability('vision')).toBe(true);
      expect(provider.hasCapability('audio_input')).toBe(true);
    });

    it('should return false for unsupported capabilities', () => {
      const provider = createGeminiProvider({ apiKey: 'test-key' });

      expect(provider.hasCapability('embedding')).toBe(false);
    });
  });

  describe('listModels', () => {
    it('should list available models', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          models: [
            { name: 'models/gemini-2.0-flash', displayName: 'Gemini 2.0 Flash' },
            { name: 'models/gemini-1.5-pro', displayName: 'Gemini 1.5 Pro' },
          ],
        }),
      });

      const provider = createGeminiProvider({ apiKey: 'test-key' });
      const result = await provider.listModels();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.length).toBeGreaterThan(0);
        expect(result.value[0]?.providerId).toBe('gemini');
      }
    });

    it('should return error on API failure', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(null, {
          status: 401,
          statusText: 'Unauthorized',
          headers: new Headers(),
        })
      );

      const provider = createGeminiProvider({ apiKey: 'test-key' });
      const result = await provider.listModels();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('provider.auth.invalid');
      }
    });

    it('should return default model when no models found', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [] }),
      });

      const provider = createGeminiProvider({ apiKey: 'test-key' });
      const result = await provider.listModels();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.length).toBe(1);
        expect(result.value[0]?.id).toBe('gemini-2.0-flash');
      }
    });
  });

  describe('getModel', () => {
    it('should return model descriptor for known models', async () => {
      const provider = createGeminiProvider({ apiKey: 'test-key' });
      const result = await provider.getModel('gemini-2.0-flash');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBe('gemini-2.0-flash');
        expect(result.value.providerId).toBe('gemini');
        expect(result.value.name).toBe('Gemini 2.0 Flash');
      }
    });

    it('should return model_not_found error for 404 response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: new Headers(),
      });

      const provider = createGeminiProvider({ apiKey: 'test-key' });
      const result = await provider.getModel('non-existent-model');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('provider.model_not_found');
      }
    });

    it('should return generic descriptor for unknown model on fetch error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const provider = createGeminiProvider({ apiKey: 'test-key' });
      const result = await provider.getModel('unknown-model');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBe('unknown-model');
        expect(result.value.name).toBe('unknown-model');
      }
    });
  });

  describe('invoke', () => {
    it('should successfully invoke the model', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                role: 'model',
                parts: [{ text: 'Hello! How can I help you?' }],
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
      });

      const provider = createGeminiProvider({ apiKey: 'test-key' });
      const request: ModelRequest = {
        model: 'gemini-2.0-flash',
        messages: [{ role: 'user', content: 'Hello' }],
      };

      const result = await provider.invoke(request);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.providerId).toBe('gemini');
        expect(result.value.model).toBe('gemini-2.0-flash');
        expect(result.value.content).toBe('Hello! How can I help you?');
        expect(result.value.finishReason).toBe('stop');
        expect(result.value.usage.totalTokens).toBe(15);
      }
    });

    it('should include correct API key in URL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: { role: 'model', parts: [{ text: 'Hi' }] },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
        }),
      });

      const provider = createGeminiProvider({ apiKey: 'my-api-key' });
      await provider.invoke({ model: 'gemini-2.0-flash', messages: [{ role: 'user', content: 'Hi' }] });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('key=my-api-key'),
        expect.any(Object)
      );
    });

    it('should use Bearer token for Vertex AI', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: { role: 'model', parts: [{ text: 'Hi' }] },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
        }),
      });

      const provider = createGeminiProvider({
        apiKey: 'access-token',
        useVertexAI: true,
      });

      await provider.invoke({ model: 'gemini-2.0-flash', messages: [{ role: 'user', content: 'Hi' }] });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer access-token',
          }),
        })
      );
    });

    it('should return error when tools not supported', async () => {
      const provider = createGeminiProvider({
        apiKey: 'test-key',
        enableTools: false,
      });

      const request: ModelRequest = {
        model: 'gemini-2.0-flash',
        messages: [{ role: 'user', content: 'Hello' }],
        tools: [{ name: 'test', description: 'Test', parameters: { type: 'object' } }],
      };

      const result = await provider.invoke(request);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('provider.capability_unsupported');
      }
    });

    it('should normalize API errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        headers: new Headers({ 'retry-after': '60' }),
        text: async () => JSON.stringify({
          error: { message: 'Rate limit exceeded', status: 'RESOURCE_EXHAUSTED' },
        }),
      });

      const provider = createGeminiProvider({ apiKey: 'test-key' });
      const result = await provider.invoke({
        model: 'gemini-2.0-flash',
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('provider.rate_limited');
        expect(result.error.retryable).toBe(true);
      }
    });

    it('should handle tool calls in response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                role: 'model',
                parts: [
                  { functionCall: { name: 'get_weather', args: { city: 'Berlin' } } },
                ],
              },
              finishReason: 'TOOL_CALLS',
            },
          ],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
        }),
      });

      const provider = createGeminiProvider({ apiKey: 'test-key' });
      const result = await provider.invoke({
        model: 'gemini-2.0-flash',
        messages: [{ role: 'user', content: 'What is the weather in Berlin?' }],
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.toolCalls).toBeDefined();
        expect(result.value.toolCalls).toHaveLength(1);
        expect(result.value.toolCalls?.[0]?.name).toBe('get_weather');
        expect(result.value.finishReason).toBe('tool_calls');
      }
    });
  });

  describe('invokeStream', () => {
    it('should return error when streaming not supported', async () => {
      const provider = createGeminiProvider({
        apiKey: 'test-key',
        enableStreaming: false,
      });

      const events = [];
      for await (const event of provider.invokeStream({
        model: 'gemini-2.0-flash',
        messages: [{ role: 'user', content: 'Hello' }],
      })) {
        events.push(event);
      }

      expect(events).toHaveLength(1);
      const firstEvent = events[0];
      expect(firstEvent?.ok).toBe(false);
      if (firstEvent && !firstEvent.ok) {
        expect(firstEvent.error.code).toBe('provider.capability_unsupported');
      }
    });

    it('should stream model output', async () => {
      // Mock SSE stream
      const encoder = new TextEncoder();
      const chunks = [
        'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"Hello"}]}}]}\n\n',
        'data: {"candidates":[{"content":{"role":"model","parts":[{"text":" World"}]},"finishReason":"STOP"}]}\n\n',
      ];

      const stream = new ReadableStream({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(encoder.encode(chunk));
          }
          controller.close();
        },
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: stream,
        headers: new Headers(),
      });

      const provider = createGeminiProvider({ apiKey: 'test-key' });
      const events = [];

      for await (const event of provider.invokeStream({
        model: 'gemini-2.0-flash',
        messages: [{ role: 'user', content: 'Hello' }],
      })) {
        events.push(event);
      }

      // Should have started, content_deltas, and finished events
      expect(events.length).toBeGreaterThan(0);
      expect(events[0]?.ok).toBe(true);
      if (events[0]?.ok) {
        expect(events[0].value.type).toBe('stream.started');
      }
    });

    it('should include stream parameters in URL', async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.close();
        },
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: stream,
        headers: new Headers(),
      });

      const provider = createGeminiProvider({ apiKey: 'test-key' });

      // Iterate but don't care about results
      for await (const _ of provider.invokeStream({
        model: 'gemini-2.0-flash',
        messages: [{ role: 'user', content: 'Hello' }],
      })) {
        break;
      }

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('alt=sse'),
        expect.any(Object)
      );
    });
  });
});

describe('Factory functions', () => {
  it('createGeminiStudioProvider should create provider with AI Studio defaults', () => {
    const provider = createGeminiStudioProvider('test-key');

    expect(provider.descriptor.id).toBe('gemini');
    expect(provider.descriptor.name).toBe('Google Gemini');
    expect(provider.descriptor.description).toContain('AI Studio');
  });

  it('createVertexAIGeminiProvider should create provider with Vertex AI config', () => {
    const provider = createVertexAIGeminiProvider('access-token', 'my-project');

    expect(provider.descriptor.id).toBe('vertexai-gemini');
    expect(provider.descriptor.name).toBe('Vertex AI Gemini');
    expect(provider.descriptor.description).toContain('Vertex AI');
  });

  it('createVertexAIGeminiProvider should use custom region', () => {
    const provider = createVertexAIGeminiProvider('access-token', 'my-project', {
      region: 'europe-west1',
    });

    // The baseUrl should contain the custom region
    expect(provider.descriptor.description).toContain('Vertex AI');
  });
});
