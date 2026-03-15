/**
 * Tests for Anthropic Response Mapper
 */

import { describe, it, expect } from 'vitest';
import {
  isTextBlock,
  isToolUseBlock,
  mapUsage,
  mapStopReason,
  mapToolUse,
  extractToolCalls,
  extractTextContent,
  mapResponse,
  mapStreamEvent,
  createToolCallAccumulator,
  updateToolCallAccumulator,
  finalizeToolCalls,
  extractStopReasonFromDelta,
} from './response-mapper';
import type {
  AnthropicMessagesResponse,
  AnthropicContentBlock,
  AnthropicStreamEvent,
} from './types';

describe('isTextBlock', () => {
  it('should return true for text blocks', () => {
    expect(isTextBlock({ type: 'text', text: 'Hello' })).toBe(true);
  });

  it('should return false for tool use blocks', () => {
    expect(
      isTextBlock({ type: 'tool_use', id: '1', name: 'test', input: {} })
    ).toBe(false);
  });
});

describe('isToolUseBlock', () => {
  it('should return true for tool use blocks', () => {
    expect(
      isToolUseBlock({ type: 'tool_use', id: '1', name: 'test', input: { foo: 'bar' } })
    ).toBe(true);
  });

  it('should return false for text blocks', () => {
    expect(isToolUseBlock({ type: 'text', text: 'Hello' })).toBe(false);
  });
});

describe('mapUsage', () => {
  it('should map usage metadata', () => {
    const usage = {
      input_tokens: 10,
      output_tokens: 20,
    };

    const result = mapUsage(usage);

    expect(result).toEqual({
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
    });
  });
});

describe('mapStopReason', () => {
  it('should map end_turn to stop', () => {
    expect(mapStopReason('end_turn')).toBe('stop');
  });

  it('should map max_tokens to length', () => {
    expect(mapStopReason('max_tokens')).toBe('length');
  });

  it('should map stop_sequence to stop', () => {
    expect(mapStopReason('stop_sequence')).toBe('stop');
  });

  it('should map tool_use to tool_calls', () => {
    expect(mapStopReason('tool_use')).toBe('tool_calls');
  });

  it('should return stop for null', () => {
    expect(mapStopReason(null)).toBe('stop');
  });
});

describe('mapToolUse', () => {
  it('should map tool use block to tool call request', () => {
    const toolUse = {
      type: 'tool_use' as const,
      id: 'toolu_123',
      name: 'get_weather',
      input: { city: 'Berlin' },
    };

    const result = mapToolUse(toolUse);

    expect(result.id).toBe('toolu_123');
    expect(result.name).toBe('get_weather');
    expect(result.arguments).toBe('{"city":"Berlin"}');
  });
});

describe('extractToolCalls', () => {
  it('should extract tool calls from blocks', () => {
    const blocks: AnthropicContentBlock[] = [
      { type: 'text', text: 'Let me check that.' },
      { type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: { city: 'Berlin' } },
      { type: 'tool_use', id: 'toolu_2', name: 'get_time', input: { zone: 'UTC' } },
    ];

    const result = extractToolCalls(blocks);

    expect(result).toHaveLength(2);
    expect(result[0]?.name).toBe('get_weather');
    expect(result[1]?.name).toBe('get_time');
  });

  it('should return empty array for blocks without tool calls', () => {
    const blocks: AnthropicContentBlock[] = [
      { type: 'text', text: 'Hello' },
      { type: 'text', text: 'World' },
    ];

    const result = extractToolCalls(blocks);

    expect(result).toHaveLength(0);
  });
});

describe('extractTextContent', () => {
  it('should extract text from blocks', () => {
    const blocks: AnthropicContentBlock[] = [
      { type: 'text', text: 'Hello ' },
      { type: 'tool_use', id: '1', name: 'test', input: {} },
      { type: 'text', text: 'World' },
    ];

    const result = extractTextContent(blocks);

    expect(result).toBe('Hello World');
  });

  it('should return empty string for blocks without text', () => {
    const blocks: AnthropicContentBlock[] = [
      { type: 'tool_use', id: '1', name: 'test', input: {} },
    ];

    const result = extractTextContent(blocks);

    expect(result).toBe('');
  });
});

describe('mapResponse', () => {
  it('should map messages response', () => {
    const response: AnthropicMessagesResponse = {
      id: 'msg_123',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'Hello, how can I help?' }],
      model: 'claude-sonnet-4-20250514',
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 5 },
    };

    const result = mapResponse(response, 'test-provider');

    expect(result.providerId).toBe('test-provider');
    expect(result.id).toBe('msg_123');
    expect(result.model).toBe('claude-sonnet-4-20250514');
    expect(result.content).toBe('Hello, how can I help?');
    expect(result.finishReason).toBe('stop');
    expect(result.usage.promptTokens).toBe(10);
    expect(result.usage.completionTokens).toBe(5);
    expect(result.toolCalls).toBeUndefined();
  });

  it('should map response with tool calls', () => {
    const response: AnthropicMessagesResponse = {
      id: 'msg_123',
      type: 'message',
      role: 'assistant',
      content: [
        { type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: { city: 'Berlin' } },
      ],
      model: 'claude-sonnet-4-20250514',
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 5 },
    };

    const result = mapResponse(response, 'test-provider');

    expect(result.content).toBe('');
    expect(result.finishReason).toBe('tool_calls');
    expect(result.toolCalls).toBeDefined();
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls?.[0]?.name).toBe('get_weather');
  });

  it('should handle mixed content and tool calls', () => {
    const response: AnthropicMessagesResponse = {
      id: 'msg_123',
      type: 'message',
      role: 'assistant',
      content: [
        { type: 'text', text: 'Let me check that for you.' },
        { type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: { city: 'Berlin' } },
      ],
      model: 'claude-sonnet-4-20250514',
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 10 },
    };

    const result = mapResponse(response, 'test-provider');

    expect(result.content).toBe('Let me check that for you.');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.finishReason).toBe('tool_calls');
  });
});

describe('Tool Call Accumulator', () => {
  it('should accumulate tool calls from stream events', () => {
    const accumulator = createToolCallAccumulator();

    // Simulate content_block_start
    updateToolCallAccumulator(accumulator, {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: {} },
    });

    // Simulate content_block_delta
    updateToolCallAccumulator(accumulator, {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '{"city":' },
    });

    updateToolCallAccumulator(accumulator, {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '"Berlin"}' },
    });

    const toolCalls = finalizeToolCalls(accumulator);

    expect(toolCalls).toBeDefined();
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls?.[0]?.name).toBe('get_weather');
    expect(toolCalls?.[0]?.arguments).toBe('{"city":"Berlin"}');
  });

  it('should return undefined for empty accumulator', () => {
    const accumulator = createToolCallAccumulator();
    const toolCalls = finalizeToolCalls(accumulator);

    expect(toolCalls).toBeUndefined();
  });
});

describe('mapStreamEvent', () => {
  it('should map message_start event', () => {
    const event: AnthropicStreamEvent = {
      type: 'message_start',
      message: {
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        content: [],
        model: 'claude-sonnet-4-20250514',
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 0 },
      },
    };

    const events = [...mapStreamEvent(event, 'test-provider', 'stream_123', 'claude-sonnet-4-20250514')];

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('stream.started');
    if (events[0]?.type === 'stream.started') {
      expect(events[0].id).toBe('msg_123');
      expect(events[0].model).toBe('claude-sonnet-4-20250514');
    }
  });

  it('should map content_block_delta text event', () => {
    const event: AnthropicStreamEvent = {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'Hello' },
    };

    const events = [...mapStreamEvent(event, 'test-provider', 'stream_123', 'claude-sonnet-4-20250514')];

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('stream.content_delta');
    if (events[0]?.type === 'stream.content_delta') {
      expect(events[0].delta).toBe('Hello');
    }
  });

  it('should ignore content_block_delta input_json_delta event', () => {
    const event: AnthropicStreamEvent = {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '{"city"' },
    };

    const events = [...mapStreamEvent(event, 'test-provider', 'stream_123', 'claude-sonnet-4-20250514')];

    expect(events).toHaveLength(0);
  });

  it('should map message_delta with usage', () => {
    const event: AnthropicStreamEvent = {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: 50 },
    };

    const events = [...mapStreamEvent(event, 'test-provider', 'stream_123', 'claude-sonnet-4-20250514')];

    const usageEvent = events.find((e) => e.type === 'stream.usage');
    expect(usageEvent).toBeDefined();
    if (usageEvent?.type === 'stream.usage') {
      expect(usageEvent.usage.completionTokens).toBe(50);
    }
  });

  it('should map message_stop event', () => {
    const event: AnthropicStreamEvent = {
      type: 'message_stop',
    };

    const events = [...mapStreamEvent(event, 'test-provider', 'stream_123', 'claude-sonnet-4-20250514')];

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('stream.finished');
  });

  it('should map error event', () => {
    const event: AnthropicStreamEvent = {
      type: 'error',
      error: { type: 'api_error', message: 'Something went wrong' },
    };

    const events = [...mapStreamEvent(event, 'test-provider', 'stream_123', 'claude-sonnet-4-20250514')];

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('stream.error');
    if (events[0]?.type === 'stream.error') {
      expect(events[0].error.message).toBe('Something went wrong');
    }
  });

  it('should ignore ping events', () => {
    const event: AnthropicStreamEvent = {
      type: 'ping',
    };

    const events = [...mapStreamEvent(event, 'test-provider', 'stream_123', 'claude-sonnet-4-20250514')];

    expect(events).toHaveLength(0);
  });
});

describe('extractStopReasonFromDelta', () => {
  it('should extract stop reason from message_delta', () => {
    const event = {
      type: 'message_delta' as const,
      delta: { stop_reason: 'tool_use', stop_sequence: null as string | null },
      usage: { output_tokens: 50 },
    };

    const result = extractStopReasonFromDelta(event);

    expect(result).toBe('tool_calls');
  });

  it('should return null when stop_reason is end_turn (mapped to stop)', () => {
    const event = {
      type: 'message_delta' as const,
      delta: { stop_reason: 'end_turn', stop_sequence: null as string | null },
      usage: { output_tokens: 50 },
    };

    const result = extractStopReasonFromDelta(event);

    expect(result).toBe('stop');
  });
});
