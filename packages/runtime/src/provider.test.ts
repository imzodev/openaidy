import { describe, it, expect } from 'vitest';
import {
  ok,
  err,
  isStreamStartedEvent,
  isStreamContentDeltaEvent,
  isStreamToolCallEvent,
  isStreamUsageEvent,
  isStreamFinishedEvent,
  isStreamErrorEvent,
  createProviderError,
  type ModelProvider,
  type ProviderDescriptor,
  type ModelDescriptor,
  type ModelRequest,
  type ModelResponse,
  type ModelStreamEvent,
  type ProviderCapability,
} from '../src';

describe('Provider', () => {
  describe('ok helper', () => {
    it('should create a successful result', () => {
      const value = { test: 'data' };
      const result = ok(value);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(value);
      }
    });
  });

  describe('err helper', () => {
    it('should create an error result', () => {
      const error = createProviderError('provider.timeout', 'Timeout');
      const result = err(error);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe(error);
      }
    });
  });

  describe('ProviderDescriptor', () => {
    it('should define a valid provider descriptor', () => {
      const descriptor: ProviderDescriptor = {
        id: 'openai',
        name: 'OpenAI',
        description: 'OpenAI API provider',
        capabilities: ['text_generation', 'streaming', 'tool_calls'],
        vendorFamily: 'openai-compatible',
      };

      expect(descriptor.id).toBe('openai');
      expect(descriptor.vendorFamily).toBe('openai-compatible');
      expect(descriptor.capabilities).toContain('streaming');
    });
  });

  describe('ModelDescriptor', () => {
    it('should define a valid model descriptor', () => {
      const model: ModelDescriptor = {
        id: 'gpt-4',
        providerId: 'openai',
        name: 'GPT-4',
        description: 'GPT-4 model',
        capabilities: ['text_generation', 'streaming', 'tool_calls'],
        contextWindow: 8192,
        maxOutputTokens: 4096,
      };

      expect(model.id).toBe('gpt-4');
      expect(model.providerId).toBe('openai');
      expect(model.contextWindow).toBe(8192);
    });
  });

  describe('ModelRequest', () => {
    it('should define a valid model request', () => {
      const request: ModelRequest = {
        model: 'gpt-4',
        messages: [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'Hello!' },
        ],
        maxTokens: 1000,
        temperature: 0.7,
        stream: false,
      };

      expect(request.model).toBe('gpt-4');
      expect(request.messages).toHaveLength(2);
      expect(request.maxTokens).toBe(1000);
      expect(request.temperature).toBe(0.7);
    });

    it('should support tool definitions', () => {
      const request: ModelRequest = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'What is the weather?' }],
        tools: [
          {
            name: 'get_weather',
            description: 'Get current weather',
            parameters: {
              type: 'object',
              properties: {
                location: { type: 'string', description: 'City name' },
              },
              required: ['location'],
            },
          },
        ],
        toolChoice: 'auto',
      };

      expect(request.tools).toHaveLength(1);
      expect(request.toolChoice).toBe('auto');
    });
  });

  describe('ModelResponse', () => {
    it('should define a valid model response', () => {
      const response: ModelResponse = {
        id: 'resp_123',
        model: 'gpt-4',
        providerId: 'openai',
        content: 'Hello! How can I help you today?',
        usage: {
          promptTokens: 10,
          completionTokens: 20,
          totalTokens: 30,
        },
        finishReason: 'stop',
        created: '2026-03-15T00:00:00Z',
      };

      expect(response.id).toBe('resp_123');
      expect(response.finishReason).toBe('stop');
      expect(response.usage.totalTokens).toBe(30);
    });

    it('should support tool calls in response', () => {
      const response: ModelResponse = {
        id: 'resp_123',
        model: 'gpt-4',
        providerId: 'openai',
        content: '',
        toolCalls: [
          {
            id: 'call_123',
            name: 'get_weather',
            arguments: '{"location": "Berlin"}',
          },
        ],
        usage: {
          promptTokens: 15,
          completionTokens: 10,
          totalTokens: 25,
        },
        finishReason: 'tool_calls',
        created: '2026-03-15T00:00:00Z',
      };

      expect(response.toolCalls).toHaveLength(1);
      expect(response.finishReason).toBe('tool_calls');
    });
  });
});

describe('Stream Events', () => {
  const timestamp = '2026-03-15T00:00:00Z';

  describe('isStreamStartedEvent', () => {
    it('should return true for stream started events', () => {
      const event: ModelStreamEvent = {
        type: 'stream.started',
        timestamp,
        id: 'stream_123',
        model: 'gpt-4',
        providerId: 'openai',
      };
      expect(isStreamStartedEvent(event)).toBe(true);
    });

    it('should return false for other event types', () => {
      const event: ModelStreamEvent = {
        type: 'stream.content_delta',
        timestamp,
        id: 'stream_123',
        delta: 'Hello',
      };
      expect(isStreamStartedEvent(event)).toBe(false);
    });
  });

  describe('isStreamContentDeltaEvent', () => {
    it('should return true for content delta events', () => {
      const event: ModelStreamEvent = {
        type: 'stream.content_delta',
        timestamp,
        id: 'stream_123',
        delta: ' world',
      };
      expect(isStreamContentDeltaEvent(event)).toBe(true);
    });
  });

  describe('isStreamToolCallEvent', () => {
    it('should return true for tool call events', () => {
      const event: ModelStreamEvent = {
        type: 'stream.tool_call',
        timestamp,
        id: 'stream_123',
        toolCall: {
          id: 'call_123',
          name: 'get_weather',
          arguments: '{"location": "Berlin"}',
        },
      };
      expect(isStreamToolCallEvent(event)).toBe(true);
    });
  });

  describe('isStreamUsageEvent', () => {
    it('should return true for usage events', () => {
      const event: ModelStreamEvent = {
        type: 'stream.usage',
        timestamp,
        id: 'stream_123',
        usage: {
          promptTokens: 10,
          completionTokens: 20,
          totalTokens: 30,
        },
      };
      expect(isStreamUsageEvent(event)).toBe(true);
    });
  });

  describe('isStreamFinishedEvent', () => {
    it('should return true for finished events', () => {
      const event: ModelStreamEvent = {
        type: 'stream.finished',
        timestamp,
        id: 'stream_123',
        finishReason: 'stop',
      };
      expect(isStreamFinishedEvent(event)).toBe(true);
    });
  });

  describe('isStreamErrorEvent', () => {
    it('should return true for error events', () => {
      const event: ModelStreamEvent = {
        type: 'stream.error',
        timestamp,
        id: 'stream_123',
        error: createProviderError('provider.stream_error', 'Stream failed'),
      };
      expect(isStreamErrorEvent(event)).toBe(true);
    });
  });
});

describe('ModelProvider Interface', () => {
  it('should define a valid model provider implementation', async () => {
    const descriptor: ProviderDescriptor = {
      id: 'test-provider',
      name: 'Test Provider',
      capabilities: ['text_generation', 'streaming'],
      vendorFamily: 'test',
    };

    const provider: ModelProvider = {
      descriptor,

      listModels: async () => {
        return ok([
          {
            id: 'test-model',
            providerId: 'test-provider',
            name: 'Test Model',
            capabilities: ['text_generation'],
          },
        ]);
      },

      getModel: async (modelId: string) => {
        if (modelId === 'test-model') {
          return ok({
            id: 'test-model',
            providerId: 'test-provider',
            name: 'Test Model',
            capabilities: ['text_generation'],
          });
        }
        return err(
          createProviderError('provider.model_not_found', 'Model not found')
        );
      },

      hasCapability: (capability: ProviderCapability) => {
        return descriptor.capabilities.includes(capability);
      },

      invoke: async (request: ModelRequest) => {
        return ok({
          id: 'resp_123',
          model: request.model,
          providerId: 'test-provider',
          content: 'Test response',
          usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
          finishReason: 'stop',
          created: new Date().toISOString(),
        });
      },

      invokeStream: async function* (request: ModelRequest) {
        yield {
          ok: true,
          value: {
            type: 'stream.started' as const,
            timestamp: new Date().toISOString(),
            id: 'stream_123',
            model: request.model,
            providerId: 'test-provider',
          },
        };

        yield {
          ok: true,
          value: {
            type: 'stream.content_delta' as const,
            timestamp: new Date().toISOString(),
            id: 'stream_123',
            delta: 'Test',
          },
        };

        yield {
          ok: true,
          value: {
            type: 'stream.finished' as const,
            timestamp: new Date().toISOString(),
            id: 'stream_123',
            finishReason: 'stop' as const,
          },
        };
      },
    };

    // Test provider
    expect(provider.descriptor.id).toBe('test-provider');
    expect(provider.hasCapability('text_generation')).toBe(true);
    expect(provider.hasCapability('vision')).toBe(false);

    // Test listModels
    const modelsResult = await provider.listModels();
    expect(modelsResult.ok).toBe(true);
    if (modelsResult.ok) {
      expect(modelsResult.value).toHaveLength(1);
    }

    // Test getModel
    const modelResult = await provider.getModel('test-model');
    expect(modelResult.ok).toBe(true);

    // Test invoke
    const invokeResult = await provider.invoke({
      model: 'test-model',
      messages: [{ role: 'user', content: 'Hello' }],
    });
    expect(invokeResult.ok).toBe(true);
    if (invokeResult.ok) {
      expect(invokeResult.value.content).toBe('Test response');
    }

    // Test invokeStream
    const streamEvents: ModelStreamEvent[] = [];
    for await (const result of provider.invokeStream({
      model: 'test-model',
      messages: [{ role: 'user', content: 'Hello' }],
    })) {
      if (result.ok) {
        streamEvents.push(result.value);
      }
    }
    expect(streamEvents).toHaveLength(3);
    expect(streamEvents[0]?.type).toBe('stream.started');
    expect(streamEvents[1]?.type).toBe('stream.content_delta');
    expect(streamEvents[2]?.type).toBe('stream.finished');
  });
});
