/**
 * Tests for OpenAI-Compatible Request Mapper
 */

import { describe, it, expect } from 'vitest';
import { mapMessage, mapMessages, mapTool, mapToolChoice, mapRequest } from './request-mapper';
import type { Message, ModelRequest, ToolDefinition } from '@openaidy/runtime';

describe('mapMessage', () => {
  it('should map system message', () => {
    const message: Message = { role: 'system', content: 'You are helpful.' };
    const result = mapMessage(message);

    expect(result).toEqual({
      role: 'system',
      content: 'You are helpful.',
    });
  });

  it('should map user message', () => {
    const message: Message = { role: 'user', content: 'Hello!' };
    const result = mapMessage(message);

    expect(result).toEqual({
      role: 'user',
      content: 'Hello!',
    });
  });

  it('should map assistant message without tool calls', () => {
    const message: Message = { role: 'assistant', content: 'Hi there!' };
    const result = mapMessage(message);

    expect(result).toEqual({
      role: 'assistant',
      content: 'Hi there!',
    });
  });

  it('should map assistant message with tool calls', () => {
    const message: Message = {
      role: 'assistant',
      content: 'Let me check that.',
      toolCalls: [
        { id: 'call_123', name: 'get_weather', arguments: '{"city": "Berlin"}' },
      ],
    };
    const result = mapMessage(message);

    expect(result).toEqual({
      role: 'assistant',
      content: 'Let me check that.',
      tool_calls: [
        { id: 'call_123', type: 'function', function: { name: 'get_weather', arguments: '{"city": "Berlin"}' } },
      ],
    });
  });

  it('should map tool result message', () => {
    const message: Message = {
      role: 'tool',
      toolCallId: 'call_123',
      content: '{"temp": 20}',
    };
    const result = mapMessage(message);

    expect(result).toEqual({
      role: 'tool',
      content: '{"temp": 20}',
      tool_call_id: 'call_123',
    });
  });
});

describe('mapMessages', () => {
  it('should map all messages', () => {
    const messages: Message[] = [
      { role: 'system', content: 'Be helpful' },
      { role: 'user', content: 'Hi' },
    ];
    const result = mapMessages(messages);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ role: 'system', content: 'Be helpful' });
    expect(result[1]).toEqual({ role: 'user', content: 'Hi' });
  });
});

describe('mapTool', () => {
  it('should map tool definition', () => {
    const tool: ToolDefinition = {
      name: 'get_weather',
      description: 'Get weather for a city',
      parameters: {
        type: 'object',
        properties: {
          city: { type: 'string', description: 'City name' },
        },
        required: ['city'],
      },
    };

    const result = mapTool(tool);

    expect(result).toEqual({
      type: 'function',
      function: {
        name: 'get_weather',
        description: 'Get weather for a city',
        parameters: {
          type: 'object',
          properties: {
            city: { type: 'string', description: 'City name' },
          },
          required: ['city'],
        },
      },
    });
  });
});

describe('mapToolChoice', () => {
  it('should pass through valid tool choices', () => {
    expect(mapToolChoice('auto')).toBe('auto');
    expect(mapToolChoice('required')).toBe('required');
    expect(mapToolChoice('none')).toBe('none');
    expect(mapToolChoice(undefined)).toBeUndefined();
  });
});

describe('mapRequest', () => {
  it('should map basic request', () => {
    const request: ModelRequest = {
      model: 'gpt-4',
      messages: [
        { role: 'user', content: 'Hello' },
      ],
    };

    const result = mapRequest(request);

    expect(result).toEqual({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello' }],
    });
  });

  it('should map request with all options', () => {
    const request: ModelRequest = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello' }],
      maxTokens: 100,
      temperature: 0.5,
      topP: 0.9,
      stopSequences: ['STOP'],
      stream: true,
      tools: [{ name: 'test', description: 'Test tool', parameters: { type: 'object' } }],
      toolChoice: 'auto',
      metadata: { key: 'value' },
    };

    const result = mapRequest(request);

    expect(result.model).toBe('gpt-4');
    expect(result.max_tokens).toBe(100);
    expect(result.temperature).toBe(0.5);
    expect(result.top_p).toBe(0.9);
    expect(result.stop).toBe('STOP');
    expect(result.stream).toBe(true);
    expect(result.tools).toHaveLength(1);
    expect(result.tool_choice).toBe('auto');
    expect(result.metadata).toEqual({ key: 'value' });
  });

  it('should map multiple stop sequences as array', () => {
    const request: ModelRequest = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello' }],
      stopSequences: ['STOP', 'END'],
    };

    const result = mapRequest(request);

    expect(result.stop).toEqual(['STOP', 'END']);
  });
});
