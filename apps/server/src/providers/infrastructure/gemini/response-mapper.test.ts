/**
 * Tests for Gemini Response Mapper
 */

import { describe, it, expect } from 'vitest';
import {
  isTextPart,
  isFunctionCallPart,
  mapUsage,
  mapFinishReason,
  mapFunctionCall,
  extractToolCalls,
  extractTextContent,
  mapResponse,
  mapStreamChunk,
} from './response-mapper';
import type {
  GeminiGenerateContentResponse,
  GeminiStreamChunk,
  GeminiPart,
} from './types';

describe('isTextPart', () => {
  it('should return true for text parts', () => {
    expect(isTextPart({ text: 'Hello' })).toBe(true);
  });

  it('should return false for function call parts', () => {
    expect(
      isTextPart({ functionCall: { name: 'test', args: {} } })
    ).toBe(false);
  });

  it('should return false for function response parts', () => {
    expect(
      isTextPart({ functionResponse: { name: 'test', response: {} } })
    ).toBe(false);
  });
});

describe('isFunctionCallPart', () => {
  it('should return true for function call parts', () => {
    expect(
      isFunctionCallPart({ functionCall: { name: 'test', args: { foo: 'bar' } } })
    ).toBe(true);
  });

  it('should return false for text parts', () => {
    expect(isFunctionCallPart({ text: 'Hello' })).toBe(false);
  });
});

describe('mapUsage', () => {
  it('should map usage metadata', () => {
    const usageMetadata = {
      promptTokenCount: 10,
      candidatesTokenCount: 20,
      totalTokenCount: 30,
    };

    const result = mapUsage(usageMetadata);

    expect(result).toEqual({
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
    });
  });

  it('should return zeros for undefined metadata', () => {
    const result = mapUsage(undefined);

    expect(result).toEqual({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    });
  });
});

describe('mapFinishReason', () => {
  it('should map STOP to stop', () => {
    expect(mapFinishReason('STOP')).toBe('stop');
  });

  it('should map MAX_TOKENS to length', () => {
    expect(mapFinishReason('MAX_TOKENS')).toBe('length');
  });

  it('should map SAFETY to content_filter', () => {
    expect(mapFinishReason('SAFETY')).toBe('content_filter');
  });

  it('should map RECITATION to content_filter', () => {
    expect(mapFinishReason('RECITATION')).toBe('content_filter');
  });

  it('should map TOOL_CALLS to tool_calls', () => {
    expect(mapFinishReason('TOOL_CALLS')).toBe('tool_calls');
  });

  it('should return stop for undefined', () => {
    expect(mapFinishReason(undefined)).toBe('stop');
  });

  it('should return stop for unknown values', () => {
    expect(mapFinishReason('OTHER')).toBe('stop');
  });
});

describe('mapFunctionCall', () => {
  it('should map function call to tool call request', () => {
    const functionCall = {
      name: 'get_weather',
      args: { city: 'Berlin' },
    };

    const result = mapFunctionCall(functionCall);

    expect(result.name).toBe('get_weather');
    expect(result.arguments).toBe('{"city":"Berlin"}');
    expect(result.id).toMatch(/^call_/);
  });
});

describe('extractToolCalls', () => {
  it('should extract tool calls from parts', () => {
    const parts: GeminiPart[] = [
      { text: 'Let me check that.' },
      { functionCall: { name: 'get_weather', args: { city: 'Berlin' } } },
      { functionCall: { name: 'get_time', args: { zone: 'UTC' } } },
    ];

    const result = extractToolCalls(parts);

    expect(result).toHaveLength(2);
    expect(result[0]?.name).toBe('get_weather');
    expect(result[1]?.name).toBe('get_time');
  });

  it('should return empty array for parts without function calls', () => {
    const parts: GeminiPart[] = [
      { text: 'Hello' },
      { text: 'World' },
    ];

    const result = extractToolCalls(parts);

    expect(result).toHaveLength(0);
  });
});

describe('extractTextContent', () => {
  it('should extract text from parts', () => {
    const parts: GeminiPart[] = [
      { text: 'Hello ' },
      { functionCall: { name: 'test', args: {} } },
      { text: 'World' },
    ];

    const result = extractTextContent(parts);

    expect(result).toBe('Hello World');
  });

  it('should return empty string for parts without text', () => {
    const parts: GeminiPart[] = [
      { functionCall: { name: 'test', args: {} } },
    ];

    const result = extractTextContent(parts);

    expect(result).toBe('');
  });
});

describe('mapResponse', () => {
  it('should map generate content response', () => {
    const response: GeminiGenerateContentResponse = {
      candidates: [
        {
          content: {
            role: 'model',
            parts: [{ text: 'Hello, how can I help?' }],
          },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 5,
        totalTokenCount: 15,
      },
    };

    const result = mapResponse(response, 'test-provider');

    expect(result.providerId).toBe('test-provider');
    expect(result.content).toBe('Hello, how can I help?');
    expect(result.finishReason).toBe('stop');
    expect(result.usage.promptTokens).toBe(10);
    expect(result.usage.completionTokens).toBe(5);
    expect(result.toolCalls).toBeUndefined();
  });

  it('should map response with tool calls', () => {
    const response: GeminiGenerateContentResponse = {
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
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 5,
        totalTokenCount: 15,
      },
    };

    const result = mapResponse(response, 'test-provider');

    expect(result.content).toBe('');
    expect(result.finishReason).toBe('tool_calls');
    expect(result.toolCalls).toBeDefined();
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls?.[0]?.name).toBe('get_weather');
  });

  it('should handle response with no candidates', () => {
    const response: GeminiGenerateContentResponse = {
      candidates: [],
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 0,
        totalTokenCount: 10,
      },
    };

    const result = mapResponse(response, 'test-provider');

    expect(result.content).toBe('');
    expect(result.finishReason).toBe('stop');
  });

  it('should handle mixed content and tool calls', () => {
    const response: GeminiGenerateContentResponse = {
      candidates: [
        {
          content: {
            role: 'model',
            parts: [
              { text: 'Let me check that for you.' },
              { functionCall: { name: 'get_weather', args: { city: 'Berlin' } } },
            ],
          },
          finishReason: 'TOOL_CALLS',
        },
      ],
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 10,
        totalTokenCount: 20,
      },
    };

    const result = mapResponse(response, 'test-provider');

    expect(result.content).toBe('Let me check that for you.');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.finishReason).toBe('tool_calls');
  });
});

describe('mapStreamChunk', () => {
  it('should map content delta chunks', () => {
    const chunk: GeminiStreamChunk = {
      candidates: [
        {
          content: {
            role: 'model',
            parts: [{ text: 'Hello' }],
          },
        },
      ],
    };

    const events = [...mapStreamChunk(chunk, 'test-provider', 'stream_123')];

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('stream.content_delta');
    if (events[0]?.type === 'stream.content_delta') {
      expect(events[0].delta).toBe('Hello');
      expect(events[0].id).toBe('stream_123');
    }
  });

  it('should map function call chunks', () => {
    const chunk: GeminiStreamChunk = {
      candidates: [
        {
          content: {
            role: 'model',
            parts: [
              { functionCall: { name: 'get_weather', args: { city: 'Berlin' } } },
            ],
          },
        },
      ],
    };

    const events = [...mapStreamChunk(chunk, 'test-provider', 'stream_123')];

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('stream.tool_call');
    if (events[0]?.type === 'stream.tool_call') {
      expect(events[0].toolCall.name).toBe('get_weather');
    }
  });

  it('should map usage metadata chunk', () => {
    const chunk: GeminiStreamChunk = {
      candidates: [
        {
          content: {
            role: 'model',
            parts: [],
          },
        },
      ],
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 5,
        totalTokenCount: 15,
      },
    };

    const events = [...mapStreamChunk(chunk, 'test-provider', 'stream_123')];

    const usageEvent = events.find((e) => e.type === 'stream.usage');
    expect(usageEvent).toBeDefined();
    if (usageEvent?.type === 'stream.usage') {
      expect(usageEvent.usage.promptTokens).toBe(10);
      expect(usageEvent.usage.totalTokens).toBe(15);
    }
  });

  it('should handle chunks with no candidates', () => {
    const chunk: GeminiStreamChunk = {
      candidates: [],
    };

    const events = [...mapStreamChunk(chunk, 'test-provider', 'stream_123')];

    expect(events).toHaveLength(0);
  });

  it('should handle empty parts', () => {
    const chunk: GeminiStreamChunk = {
      candidates: [
        {
          content: {
            role: 'model',
            parts: [],
          },
        },
      ],
    };

    const events = [...mapStreamChunk(chunk, 'test-provider', 'stream_123')];

    expect(events).toHaveLength(0);
  });

  it('should map multiple events from single chunk', () => {
    const chunk: GeminiStreamChunk = {
      candidates: [
        {
          content: {
            role: 'model',
            parts: [
              { text: 'Hello' },
              { functionCall: { name: 'test', args: {} } },
            ],
          },
        },
      ],
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 5,
        totalTokenCount: 15,
      },
    };

    const events = [...mapStreamChunk(chunk, 'test-provider', 'stream_123')];

    expect(events).toHaveLength(3); // content_delta, tool_call, usage
  });
});
