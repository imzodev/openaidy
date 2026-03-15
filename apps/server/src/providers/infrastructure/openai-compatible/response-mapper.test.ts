/**
 * Tests for OpenAI-Compatible Response Mapper
 */

import { describe, it, expect } from 'vitest';
import {
  mapUsage,
  mapFinishReason,
  mapToolCall,
  mapToolCalls,
  mapResponse,
  mapStreamChunk,
  createToolCallAccumulator,
  updateToolCallAccumulator,
  finalizeToolCalls,
} from './response-mapper';
import type { OpenAIChatCompletionResponse, OpenAIStreamChunk, OpenAIToolCall } from './types';

describe('mapUsage', () => {
  it('should map usage info', () => {
    const usage = {
      prompt_tokens: 10,
      completion_tokens: 20,
      total_tokens: 30,
    };

    const result = mapUsage(usage);

    expect(result).toEqual({
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
    });
  });
});

describe('mapFinishReason', () => {
  it('should map finish reasons', () => {
    expect(mapFinishReason('stop')).toBe('stop');
    expect(mapFinishReason('length')).toBe('length');
    expect(mapFinishReason('tool_calls')).toBe('tool_calls');
    expect(mapFinishReason('content_filter')).toBe('content_filter');
    expect(mapFinishReason(null)).toBe('stop');
  });
});

describe('mapToolCall', () => {
  it('should map tool call', () => {
    const toolCall: OpenAIToolCall = {
      id: 'call_123',
      type: 'function',
      function: {
        name: 'get_weather',
        arguments: '{"city": "Berlin"}',
      },
    };

    const result = mapToolCall(toolCall);

    expect(result).toEqual({
      id: 'call_123',
      name: 'get_weather',
      arguments: '{"city": "Berlin"}',
    });
  });
});

describe('mapToolCalls', () => {
  it('should map multiple tool calls', () => {
    const toolCalls: OpenAIToolCall[] = [
      { id: 'call_1', type: 'function', function: { name: 'tool1', arguments: '{}' } },
      { id: 'call_2', type: 'function', function: { name: 'tool2', arguments: '{}' } },
    ];

    const result = mapToolCalls(toolCalls);

    expect(result).toHaveLength(2);
    expect(result[0]?.id).toBe('call_1');
    expect(result[1]?.id).toBe('call_2');
  });
});

describe('mapResponse', () => {
  it('should map chat completion response', () => {
    const response: OpenAIChatCompletionResponse = {
      id: 'chatcmpl_123',
      object: 'chat.completion',
      created: 1700000000,
      model: 'gpt-4',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: 'Hello, how can I help?',
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      },
    };

    const result = mapResponse(response, 'test-provider');

    expect(result.id).toBe('chatcmpl_123');
    expect(result.model).toBe('gpt-4');
    expect(result.providerId).toBe('test-provider');
    expect(result.content).toBe('Hello, how can I help?');
    expect(result.finishReason).toBe('stop');
    expect(result.usage.promptTokens).toBe(10);
    expect(result.usage.completionTokens).toBe(5);
    expect(result.toolCalls).toBeUndefined();
  });

  it('should map response with tool calls', () => {
    const response: OpenAIChatCompletionResponse = {
      id: 'chatcmpl_123',
      object: 'chat.completion',
      created: 1700000000,
      model: 'gpt-4',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'get_weather', arguments: '{"city":"Berlin"}' },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      },
    };

    const result = mapResponse(response, 'test-provider');

    expect(result.content).toBe('');
    expect(result.finishReason).toBe('tool_calls');
    expect(result.toolCalls).toBeDefined();
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls?.[0]?.name).toBe('get_weather');
  });

  it('should handle null content', () => {
    const response: OpenAIChatCompletionResponse = {
      id: 'chatcmpl_123',
      object: 'chat.completion',
      created: 1700000000,
      model: 'gpt-4',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: null,
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 0,
        total_tokens: 10,
      },
    };

    const result = mapResponse(response, 'test-provider');

    expect(result.content).toBe('');
  });
});

describe('Tool Call Accumulator', () => {
  it('should accumulate tool call deltas', () => {
    const accumulator = createToolCallAccumulator();

    // First delta - sets id and name
    updateToolCallAccumulator(accumulator, [
      { index: 0, id: 'call_1', type: 'function', function: { name: 'get_weather' } },
    ]);

    // Second delta - appends arguments
    updateToolCallAccumulator(accumulator, [
      { index: 0, function: { arguments: '{"city' } },
    ]);

    // Third delta - appends more arguments
    updateToolCallAccumulator(accumulator, [
      { index: 0, function: { arguments: '":"Berlin"}' } },
    ]);

    const result = finalizeToolCalls(accumulator);

    expect(result).toHaveLength(1);
    expect(result?.[0]).toEqual({
      id: 'call_1',
      name: 'get_weather',
      arguments: '{"city":"Berlin"}',
    });
  });

  it('should handle multiple tool calls', () => {
    const accumulator = createToolCallAccumulator();

    updateToolCallAccumulator(accumulator, [
      { index: 0, id: 'call_1', function: { name: 'tool1', arguments: '{}' } },
      { index: 1, id: 'call_2', function: { name: 'tool2', arguments: '{}' } },
    ]);

    const result = finalizeToolCalls(accumulator);

    expect(result).toHaveLength(2);
    expect(result?.[0]?.id).toBe('call_1');
    expect(result?.[1]?.id).toBe('call_2');
  });

  it('should return undefined for empty accumulator', () => {
    const accumulator = createToolCallAccumulator();
    const result = finalizeToolCalls(accumulator);

    expect(result).toBeUndefined();
  });
});

describe('mapStreamChunk', () => {
  it('should map content delta chunks', () => {
    const chunk: OpenAIStreamChunk = {
      id: 'chatcmpl_123',
      object: 'chat.completion.chunk',
      created: 1700000000,
      model: 'gpt-4',
      choices: [
        {
          index: 0,
          delta: {
            content: 'Hello',
          },
          finish_reason: null,
        },
      ],
    };

    const events = [...mapStreamChunk(chunk, 'test-provider', 'chatcmpl_123')];

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('stream.content_delta');
    if (events[0]?.type === 'stream.content_delta') {
      expect(events[0].delta).toBe('Hello');
      expect(events[0].id).toBe('chatcmpl_123');
    }
  });

  it('should map usage chunk', () => {
    const chunk: OpenAIStreamChunk = {
      id: 'chatcmpl_123',
      object: 'chat.completion.chunk',
      created: 1700000000,
      model: 'gpt-4',
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: null,
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      },
    };

    const events = [...mapStreamChunk(chunk, 'test-provider', 'stream_123')];

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('stream.usage');
    if (events[0]?.type === 'stream.usage') {
      expect(events[0].usage.promptTokens).toBe(10);
    }
  });

  it('should handle chunks with no choices', () => {
    const chunk: OpenAIStreamChunk = {
      id: 'chatcmpl_123',
      object: 'chat.completion.chunk',
      created: 1700000000,
      model: 'gpt-4',
      choices: [],
    };

    const events = [...mapStreamChunk(chunk, 'test-provider', 'stream_123')];

    expect(events).toHaveLength(0);
  });
});
