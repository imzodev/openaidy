/**
 * Tests for Anthropic Provider Adapter
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createAnthropicProvider,
  createClaudeProvider,
  createClaudeModelProvider,
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

describe('AnthropicProvider', () => {
  describe('descriptor', () => {
    it('should have correct descriptor with defaults', () => {
      const provider = createAnthropicProvider({
        apiKey: 'test-key',
      });

      expect(provider.descriptor.id).toBe('anthropic');
      expect(provider.descriptor.name).toBe('Anthropic');
      expect(provider.descriptor.vendorFamily).toBe('anthropic');
      expect(provider.descriptor.capabilities).toContain('text_generation');
      expect(provider.descriptor.capabilities).toContain('streaming');
      expect(provider.descriptor.capabilities).toContain('tool_calls');
      expect(provider.descriptor.capabilities).toContain('vision');
    });

    it('should allow custom provider id and name', () => {
      const provider = createAnthropicProvider({
        apiKey: 'test-key',
        providerId: 'custom-anthropic',
        providerName: 'Custom Anthropic',
      });

      expect(provider.descriptor.id).toBe('custom-anthropic');
      expect(provider.descriptor.name).toBe('Custom Anthropic');
    });

    it('should disable streaming capability when configured', () => {
      const provider = createAnthropicProvider({
        apiKey: 'test-key',
        enableStreaming: false,
      });

      expect(provider.descriptor.capabilities).not.toContain('streaming');
    });

    it('should disable tool_calls capability when configured', () => {
      const provider = createAnthropicProvider({
        apiKey: 'test-key',
        enableTools: false,
      });

      expect(provider.descriptor.capabilities).not.toContain('tool_calls');
    });

    it('should disable vision capability when configured', () => {
      const provider = createAnthropicProvider({
        apiKey: 'test-key',
        enableVision: false,
      });

      expect(provider.descriptor.capabilities).not.toContain('vision');
    });
  });

  describe('hasCapability', () => {
    it('should return true for supported capabilities', () => {
      const provider = createAnthropicProvider({ apiKey: 'test-key' });

      expect(provider.hasCapability('text_generation')).toBe(true);
      expect(provider.hasCapability('streaming')).toBe(true);
      expect(provider.hasCapability('tool_calls')).toBe(true);
      expect(provider.hasCapability('vision')).toBe(true);
    });

    it('should return false for unsupported capabilities', () => {
      const provider = createAnthropicProvider({ apiKey: 'test-key' });

      expect(provider.hasCapability('embedding')).toBe(false);
    });
  });

  describe('listModels', () => {
    it('should list known Anthropic models', async () => {
      const provider = createAnthropicProvider({ apiKey: 'test-key' });
      const result = await provider.listModels();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.length).toBeGreaterThan(0);
        expect(result.value[0]?.providerId).toBe('anthropic');
        // Check for known models
        const modelIds = result.value.map((m) => m.id);
        expect(modelIds).toContain('claude-sonnet-4-20250514');
        expect(modelIds).toContain('claude-opus-4-20250514');
      }
    });
  });

  describe('getModel', () => {
    it('should return model descriptor for known models', async () => {
      const provider = createAnthropicProvider({ apiKey: 'test-key' });
      const result = await provider.getModel('claude-sonnet-4-20250514');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBe('claude-sonnet-4-20250514');
        expect(result.value.providerId).toBe('anthropic');
        expect(result.value.name).toBe('Claude Sonnet 4');
      }
    });

    it('should return generic descriptor for unknown models', async () => {
      const provider = createAnthropicProvider({ apiKey: 'test-key' });
      const result = await provider.getModel('claude-future-model');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBe('claude-future-model');
        expect(result.value.name).toBe('claude-future-model');
      }
    });
  });

  describe('invoke', () => {
    it('should successfully invoke the model', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'msg_123',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello! How can I help you?' }],
          model: 'claude-sonnet-4-20250514',
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      });

      const provider = createAnthropicProvider({ apiKey: 'test-key' });
      const request: ModelRequest = {
        model: 'claude-sonnet-4-20250514',
        messages: [{ role: 'user', content: 'Hello' }],
      };

      const result = await provider.invoke(request);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.providerId).toBe('anthropic');
        expect(result.value.model).toBe('claude-sonnet-4-20250514');
        expect(result.value.content).toBe('Hello! How can I help you?');
        expect(result.value.finishReason).toBe('stop');
        expect(result.value.usage.totalTokens).toBe(15);
      }
    });

    it('should include correct headers', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'msg_123',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Hi' }],
          model: 'claude-sonnet-4-20250514',
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      });

      const provider = createAnthropicProvider({ apiKey: 'my-api-key' });
      await provider.invoke({
        model: 'claude-sonnet-4-20250514',
        messages: [{ role: 'user', content: 'Hi' }],
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-api-key': 'my-api-key',
            'anthropic-version': expect.any(String),
          }),
        }),
      );
    });

    it('should return error when tools not supported', async () => {
      const provider = createAnthropicProvider({
        apiKey: 'test-key',
        enableTools: false,
      });

      const request: ModelRequest = {
        model: 'claude-sonnet-4-20250514',
        messages: [{ role: 'user', content: 'Hello' }],
        tools: [
          { name: 'test', description: 'Test', parameters: { type: 'object' } },
        ],
      };

      const result = await provider.invoke(request);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('provider.capability_unsupported');
      }
    });

    it('should normalize API errors', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: { type: 'rate_limit_error', message: 'Rate limit exceeded' },
          }),
          {
            status: 429,
            statusText: 'Too Many Requests',
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      );

      const provider = createAnthropicProvider({ apiKey: 'test-key' });
      const result = await provider.invoke({
        model: 'claude-sonnet-4-20250514',
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('provider.rate_limited');
      }
    });

    it('should handle tool calls in response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'msg_123',
          type: 'message',
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_1',
              name: 'get_weather',
              input: { city: 'Berlin' },
            },
          ],
          model: 'claude-sonnet-4-20250514',
          stop_reason: 'tool_use',
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      });

      const provider = createAnthropicProvider({ apiKey: 'test-key' });
      const result = await provider.invoke({
        model: 'claude-sonnet-4-20250514',
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
      const provider = createAnthropicProvider({
        apiKey: 'test-key',
        enableStreaming: false,
      });

      const events = [];
      for await (const event of provider.invokeStream({
        model: 'claude-sonnet-4-20250514',
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

    it('aborts the fetch when the external request signal aborts (#376)', async () => {
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

      const provider = createAnthropicProvider({ apiKey: 'test-key' });
      const external = new AbortController();

      const events = [];
      for await (const event of provider.invokeStream({
        model: 'claude-sonnet-4-20250514',
        messages: [{ role: 'user', content: 'Hello' }],
        signal: external.signal,
      })) {
        events.push(event);
      }

      // The signal handed to fetch is a combined signal, distinct from the
      // external one, but aborting the external must propagate to it.
      const passedSignal = mockFetch.mock.calls[0]?.[1]?.signal as AbortSignal;
      expect(passedSignal).toBeInstanceOf(AbortSignal);
      expect(passedSignal.aborted).toBe(false);
      external.abort();
      expect(passedSignal.aborted).toBe(true);
    });

    it('passes an already-aborted external signal through to fetch (#376)', async () => {
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

      const provider = createAnthropicProvider({ apiKey: 'test-key' });
      const external = new AbortController();
      external.abort();

      const events = [];
      for await (const event of provider.invokeStream({
        model: 'claude-sonnet-4-20250514',
        messages: [{ role: 'user', content: 'Hello' }],
        signal: external.signal,
      })) {
        events.push(event);
      }

      const passedSignal = mockFetch.mock.calls[0]?.[1]?.signal as AbortSignal;
      expect(passedSignal.aborted).toBe(true);
    });

    it('should stream model output', async () => {
      // Mock SSE stream
      const encoder = new TextEncoder();
      const chunks = [
        'data: {"type":"message_start","message":{"id":"msg_123","type":"message","role":"assistant","content":[],"model":"claude-sonnet-4-20250514","usage":{"input_tokens":10,"output_tokens":0}}}\n\n',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n\n',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" World"}}\n\n',
        'data: {"type":"message_stop"}\n\n',
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

      const provider = createAnthropicProvider({ apiKey: 'test-key' });
      const events = [];

      for await (const event of provider.invokeStream({
        model: 'claude-sonnet-4-20250514',
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
  });
});

describe('Factory functions', () => {
  it('createClaudeProvider should create provider with standard config', () => {
    const provider = createClaudeProvider('test-key');

    expect(provider.descriptor.id).toBe('anthropic');
    expect(provider.descriptor.name).toBe('Anthropic');
  });

  it('createClaudeModelProvider should create provider with specific model', () => {
    const provider = createClaudeModelProvider(
      'test-key',
      'claude-opus-4-20250514',
    );

    expect(provider.descriptor.id).toBe('anthropic-claude-opus-4-20250514');
    expect(provider.descriptor.name).toBe('Anthropic claude-opus-4-20250514');
  });
});
