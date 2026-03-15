/**
 * Tests for OpenAI-Compatible Provider Adapter
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createOpenAICompatibleProvider,
  createOpenAIProvider,
  createCompatibleProvider,
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

describe('OpenAICompatibleProvider', () => {
  describe('descriptor', () => {
    it('should have correct descriptor with defaults', () => {
      const provider = createOpenAICompatibleProvider({
        apiKey: 'test-key',
      });

      expect(provider.descriptor.id).toBe('openai-compatible');
      expect(provider.descriptor.name).toBe('OpenAI-Compatible');
      expect(provider.descriptor.vendorFamily).toBe('openai-compatible');
      expect(provider.descriptor.capabilities).toContain('text_generation');
      expect(provider.descriptor.capabilities).toContain('streaming');
      expect(provider.descriptor.capabilities).toContain('tool_calls');
    });

    it('should allow custom provider id and name', () => {
      const provider = createOpenAICompatibleProvider({
        apiKey: 'test-key',
        providerId: 'custom-provider',
        providerName: 'Custom Provider',
      });

      expect(provider.descriptor.id).toBe('custom-provider');
      expect(provider.descriptor.name).toBe('Custom Provider');
    });

    it('should disable streaming capability when configured', () => {
      const provider = createOpenAICompatibleProvider({
        apiKey: 'test-key',
        enableStreaming: false,
      });

      expect(provider.descriptor.capabilities).not.toContain('streaming');
    });

    it('should disable tool_calls capability when configured', () => {
      const provider = createOpenAICompatibleProvider({
        apiKey: 'test-key',
        enableTools: false,
      });

      expect(provider.descriptor.capabilities).not.toContain('tool_calls');
    });
  });

  describe('hasCapability', () => {
    it('should return true for supported capabilities', () => {
      const provider = createOpenAICompatibleProvider({ apiKey: 'test-key' });

      expect(provider.hasCapability('text_generation')).toBe(true);
      expect(provider.hasCapability('streaming')).toBe(true);
      expect(provider.hasCapability('tool_calls')).toBe(true);
    });

    it('should return false for unsupported capabilities', () => {
      const provider = createOpenAICompatibleProvider({ apiKey: 'test-key' });

      expect(provider.hasCapability('vision')).toBe(false);
      expect(provider.hasCapability('embedding')).toBe(false);
    });
  });

  describe('listModels', () => {
    it('should list available models', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          object: 'list',
          data: [
            { id: 'gpt-4', object: 'model', created: 1700000000, owned_by: 'openai' },
            { id: 'gpt-3.5-turbo', object: 'model', created: 1700000000, owned_by: 'openai' },
          ],
        }),
      });

      const provider = createOpenAICompatibleProvider({ apiKey: 'test-key' });
      const result = await provider.listModels();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.length).toBeGreaterThan(0);
        expect(result.value[0]?.providerId).toBe('openai-compatible');
      }
    });

    it('should return error on API failure', async () => {
      // Create a real Response object for proper instanceof check
      mockFetch.mockResolvedValueOnce(
        new Response(null, {
          status: 401,
          statusText: 'Unauthorized',
          headers: new Headers(),
        })
      );

      const provider = createOpenAICompatibleProvider({ apiKey: 'test-key' });
      const result = await provider.listModels();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('provider.auth.invalid');
      }
    });
  });

  describe('getModel', () => {
    it('should return model descriptor for known models', async () => {
      const provider = createOpenAICompatibleProvider({ apiKey: 'test-key' });
      const result = await provider.getModel('gpt-4');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBe('gpt-4');
        expect(result.value.providerId).toBe('openai-compatible');
        expect(result.value.name).toBe('GPT-4');
      }
    });

    it('should return model_not_found error for invalid model', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: new Headers(),
      });

      const provider = createOpenAICompatibleProvider({ apiKey: 'test-key' });
      const result = await provider.getModel('non-existent-model');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('provider.model_not_found');
      }
    });
  });

  describe('invoke', () => {
    it('should successfully invoke the model', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'chatcmpl_123',
          object: 'chat.completion',
          created: 1700000000,
          model: 'gpt-4',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'Hello!' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      });

      const provider = createOpenAICompatibleProvider({ apiKey: 'test-key' });
      const request: ModelRequest = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
      };

      const result = await provider.invoke(request);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBe('chatcmpl_123');
        expect(result.value.model).toBe('gpt-4');
        expect(result.value.providerId).toBe('openai-compatible');
        expect(result.value.content).toBe('Hello!');
        expect(result.value.finishReason).toBe('stop');
        expect(result.value.usage.totalTokens).toBe(15);
      }
    });

    it('should include correct headers', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'chatcmpl_123',
          object: 'chat.completion',
          created: 1700000000,
          model: 'gpt-4',
          choices: [{ index: 0, message: { role: 'assistant', content: 'Hi' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      });

      const provider = createOpenAICompatibleProvider({
        apiKey: 'test-key',
        organizationId: 'org-123',
      });

      await provider.invoke({ model: 'gpt-4', messages: [{ role: 'user', content: 'Hi' }] });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-key',
            'OpenAI-Organization': 'org-123',
          }),
        })
      );
    });

    it('should return error when tools not supported', async () => {
      const provider = createOpenAICompatibleProvider({
        apiKey: 'test-key',
        enableTools: false,
      });

      const request: ModelRequest = {
        model: 'gpt-4',
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
          error: { message: 'Rate limit exceeded', type: 'rate_limit_error', code: 'rate_limit_exceeded' },
        }),
      });

      const provider = createOpenAICompatibleProvider({ apiKey: 'test-key' });
      const result = await provider.invoke({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('provider.rate_limited');
        expect(result.error.retryable).toBe(true);
      }
    });
  });

  describe('invokeStream', () => {
    it('should return error when streaming not supported', async () => {
      const provider = createOpenAICompatibleProvider({
        apiKey: 'test-key',
        enableStreaming: false,
      });

      const events = [];
      for await (const event of provider.invokeStream({
        model: 'gpt-4',
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
        'data: {"id":"chatcmpl_123","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}\n\n',
        'data: {"id":"chatcmpl_123","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}\n\n',
        'data: {"id":"chatcmpl_123","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
        'data: [DONE]\n\n',
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

      const provider = createOpenAICompatibleProvider({ apiKey: 'test-key' });
      const events = [];

      for await (const event of provider.invokeStream({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
      })) {
        events.push(event);
      }

      // Should have started, content_delta, and finished events
      expect(events.length).toBeGreaterThan(0);
      expect(events[0]?.ok).toBe(true);
      if (events[0]?.ok) {
        expect(events[0].value.type).toBe('stream.started');
      }
    });
  });
});

describe('Factory functions', () => {
  it('createOpenAIProvider should create provider with OpenAI defaults', () => {
    const provider = createOpenAIProvider('test-key');

    expect(provider.descriptor.id).toBe('openai');
    expect(provider.descriptor.name).toBe('OpenAI');
  });

  it('createCompatibleProvider should create provider with custom baseUrl', () => {
    const provider = createCompatibleProvider('http://localhost:11434/v1', 'local-key', {
      providerId: 'ollama',
      providerName: 'Ollama',
    });

    expect(provider.descriptor.id).toBe('ollama');
    expect(provider.descriptor.name).toBe('Ollama');
  });
});
