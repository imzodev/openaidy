/**
 * Tests for Anthropic Request Mapper
 */

import { describe, it, expect } from 'vitest';
import {
  mapMessage,
  mapMessages,
  extractSystemInstruction,
  mapTool,
  mapTools,
  mapToolChoice,
  mapRequest,
} from './request-mapper';
import type { Message, ModelRequest, ToolDefinition } from '@openaidy/runtime';

describe('mapMessage', () => {
  it('should return null for system message', () => {
    const message: Message = { role: 'system', content: 'You are helpful.' };
    const result = mapMessage(message);
    expect(result).toBeNull();
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
      content: [{ type: 'text', text: 'Hi there!' }],
    });
  });

  it('should map assistant message with tool calls', () => {
    const message: Message = {
      role: 'assistant',
      content: 'Let me check that.',
      toolCalls: [
        { id: 'toolu_123', name: 'get_weather', arguments: '{"city": "Berlin"}' },
      ],
    };
    const result = mapMessage(message);

    expect(result).toEqual({
      role: 'assistant',
      content: [
        { type: 'text', text: 'Let me check that.' },
        { type: 'tool_use', id: 'toolu_123', name: 'get_weather', input: { city: 'Berlin' } },
      ],
    });
  });

  it('should map assistant message with only tool calls (empty content)', () => {
    const message: Message = {
      role: 'assistant',
      content: '', // Empty content is falsy, so no text block added
      toolCalls: [
        { id: 'toolu_123', name: 'get_weather', arguments: '{"city": "Berlin"}' },
      ],
    };
    const result = mapMessage(message);

    expect(result?.role).toBe('assistant');
    // Empty content is falsy, so only tool_use block is added
    expect(result?.content).toHaveLength(1);
    expect(result?.content[0]).toEqual({
      type: 'tool_use',
      id: 'toolu_123',
      name: 'get_weather',
      input: { city: 'Berlin' },
    });
  });

  it('should map tool result message', () => {
    const message: Message = {
      role: 'tool',
      toolCallId: 'toolu_123',
      content: '{"temp": 20}',
    };
    const result = mapMessage(message);

    expect(result).toEqual({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'toolu_123',
          content: '{"temp": 20}',
        },
      ],
    });
  });

  it('should map tool result message with error flag', () => {
    const message: Message = {
      role: 'tool',
      toolCallId: 'toolu_123',
      content: 'Error occurred',
      isError: true,
    };
    const result = mapMessage(message);

    expect(result).toEqual({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'toolu_123',
          content: 'Error occurred',
          is_error: true,
        },
      ],
    });
  });
});

describe('mapMessages', () => {
  it('should map all messages and filter out system messages', () => {
    const messages: Message[] = [
      { role: 'system', content: 'Be helpful' },
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello!' },
    ];
    const result = mapMessages(messages);

    expect(result).toHaveLength(2);
    expect(result[0]?.role).toBe('user');
    expect(result[1]?.role).toBe('assistant');
  });
});

describe('extractSystemInstruction', () => {
  it('should extract system instruction from messages', () => {
    const messages: Message[] = [
      { role: 'system', content: 'Be helpful' },
      { role: 'user', content: 'Hi' },
    ];
    const result = extractSystemInstruction(messages);

    expect(result).toBe('Be helpful');
  });

  it('should join multiple system messages', () => {
    const messages: Message[] = [
      { role: 'system', content: 'Be helpful' },
      { role: 'system', content: 'Be concise' },
      { role: 'user', content: 'Hi' },
    ];
    const result = extractSystemInstruction(messages);

    expect(result).toBe('Be helpful\n\nBe concise');
  });

  it('should return undefined when no system messages', () => {
    const messages: Message[] = [
      { role: 'user', content: 'Hi' },
    ];
    const result = extractSystemInstruction(messages);

    expect(result).toBeUndefined();
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
      name: 'get_weather',
      description: 'Get weather for a city',
      input_schema: {
        type: 'object',
        properties: {
          city: { type: 'string', description: 'City name' },
        },
        required: ['city'],
      },
    });
  });
});

describe('mapTools', () => {
  it('should map tools to Anthropic format', () => {
    const tools: ToolDefinition[] = [
      { name: 'tool1', description: 'Tool 1', parameters: { type: 'object' } },
      { name: 'tool2', description: 'Tool 2', parameters: { type: 'object' } },
    ];

    const result = mapTools(tools);

    expect(result).toHaveLength(2);
    expect(result[0]?.name).toBe('tool1');
    expect(result[1]?.name).toBe('tool2');
  });
});

describe('mapToolChoice', () => {
  it('should map auto to { type: auto }', () => {
    const result = mapToolChoice('auto');
    expect(result).toEqual({ type: 'auto' });
  });

  it('should map required to { type: any }', () => {
    const result = mapToolChoice('required');
    expect(result).toEqual({ type: 'any' });
  });

  it('should return undefined for none', () => {
    const result = mapToolChoice('none');
    expect(result).toBeUndefined();
  });

  it('should return undefined for undefined', () => {
    const result = mapToolChoice(undefined);
    expect(result).toBeUndefined();
  });
});

describe('mapRequest', () => {
  it('should map basic request', () => {
    const request: ModelRequest = {
      model: 'claude-sonnet-4-20250514',
      messages: [{ role: 'user', content: 'Hello' }],
    };

    const result = mapRequest(request);

    expect(result.model).toBe('claude-sonnet-4-20250514');
    expect(result.messages).toHaveLength(1);
    expect(result.max_tokens).toBeDefined();
  });

  it('should include system instruction from messages', () => {
    const request: ModelRequest = {
      model: 'claude-sonnet-4-20250514',
      messages: [
        { role: 'system', content: 'Be helpful' },
        { role: 'user', content: 'Hello' },
      ],
    };

    const result = mapRequest(request);

    expect(result.system).toBe('Be helpful');
    expect(result.messages).toHaveLength(1); // system message filtered out
  });

  it('should use provided system instruction over messages', () => {
    const request: ModelRequest = {
      model: 'claude-sonnet-4-20250514',
      messages: [
        { role: 'system', content: 'Be helpful' },
        { role: 'user', content: 'Hello' },
      ],
    };

    const result = mapRequest(request, { systemInstruction: 'Override instruction' });

    expect(result.system).toBe('Override instruction');
  });

  it('should include tools when present', () => {
    const request: ModelRequest = {
      model: 'claude-sonnet-4-20250514',
      messages: [{ role: 'user', content: 'Hello' }],
      tools: [
        { name: 'get_weather', description: 'Get weather', parameters: { type: 'object' } },
      ],
    };

    const result = mapRequest(request);

    expect(result.tools).toBeDefined();
    expect(result.tools).toHaveLength(1);
  });

  it('should include tool choice when set', () => {
    const request: ModelRequest = {
      model: 'claude-sonnet-4-20250514',
      messages: [{ role: 'user', content: 'Hello' }],
      tools: [
        { name: 'get_weather', description: 'Get weather', parameters: { type: 'object' } },
      ],
      toolChoice: 'auto',
    };

    const result = mapRequest(request);

    expect(result.tool_choice).toEqual({ type: 'auto' });
  });

  it('should include generation config with defaults', () => {
    const request: ModelRequest = {
      model: 'claude-sonnet-4-20250514',
      messages: [{ role: 'user', content: 'Hello' }],
    };

    const result = mapRequest(request, {
      defaultMaxTokens: 8192,
      defaultTemperature: 0.5,
    });

    expect(result.max_tokens).toBe(8192);
    expect(result.temperature).toBe(0.5);
  });

  it('should prefer request values over defaults', () => {
    const request: ModelRequest = {
      model: 'claude-sonnet-4-20250514',
      messages: [{ role: 'user', content: 'Hello' }],
      maxTokens: 1000,
      temperature: 0.9,
    };

    const result = mapRequest(request, {
      defaultMaxTokens: 8192,
      defaultTemperature: 0.5,
    });

    expect(result.max_tokens).toBe(1000);
    expect(result.temperature).toBe(0.9);
  });

  it('should map topP', () => {
    const request: ModelRequest = {
      model: 'claude-sonnet-4-20250514',
      messages: [{ role: 'user', content: 'Hello' }],
      topP: 0.9,
    };

    const result = mapRequest(request);

    expect(result.top_p).toBe(0.9);
  });

  it('should map stopSequences', () => {
    const request: ModelRequest = {
      model: 'claude-sonnet-4-20250514',
      messages: [{ role: 'user', content: 'Hello' }],
      stopSequences: ['STOP', 'END'],
    };

    const result = mapRequest(request);

    expect(result.stop_sequences).toEqual(['STOP', 'END']);
  });

  it('should map stream flag', () => {
    const request: ModelRequest = {
      model: 'claude-sonnet-4-20250514',
      messages: [{ role: 'user', content: 'Hello' }],
      stream: true,
    };

    const result = mapRequest(request);

    expect(result.stream).toBe(true);
  });
});
