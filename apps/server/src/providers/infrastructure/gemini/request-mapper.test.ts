/**
 * Tests for Gemini Request Mapper
 */

import { describe, it, expect } from 'vitest';
import {
  mapRole,
  mapMessage,
  mapMessages,
  extractSystemInstruction,
  mapTool,
  mapTools,
  mapToolChoice,
  mapGenerationConfig,
  mapRequest,
} from './request-mapper';
import type { Message, ModelRequest, ToolDefinition } from '@openaidy/runtime';

describe('mapRole', () => {
  it('should map user role', () => {
    expect(mapRole('user')).toBe('user');
  });

  it('should map assistant role to model', () => {
    expect(mapRole('assistant')).toBe('model');
  });

  it('should map system role to user', () => {
    expect(mapRole('system')).toBe('user');
  });

  it('should map tool role to user', () => {
    expect(mapRole('tool')).toBe('user');
  });
});

describe('mapMessage', () => {
  it('should map system message', () => {
    const message: Message = { role: 'system', content: 'You are helpful.' };
    const result = mapMessage(message);

    expect(result).toEqual({
      role: 'user',
      parts: [{ text: 'You are helpful.' }],
    });
  });

  it('should map user message', () => {
    const message: Message = { role: 'user', content: 'Hello!' };
    const result = mapMessage(message);

    expect(result).toEqual({
      role: 'user',
      parts: [{ text: 'Hello!' }],
    });
  });

  it('should map assistant message without tool calls', () => {
    const message: Message = { role: 'assistant', content: 'Hi there!' };
    const result = mapMessage(message);

    expect(result).toEqual({
      role: 'model',
      parts: [{ text: 'Hi there!' }],
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

    expect(result.role).toBe('model');
    expect(result.parts).toHaveLength(2);
    expect(result.parts[0]).toEqual({ text: 'Let me check that.' });
    expect(result.parts[1]).toEqual({
      functionCall: {
        name: 'get_weather',
        args: { city: 'Berlin' },
      },
    });
  });

  it('should map assistant message with only tool calls (no content)', () => {
    const message: Message = {
      role: 'assistant',
      content: '', // Empty content when only tool calls
      toolCalls: [
        { id: 'call_123', name: 'get_weather', arguments: '{"city": "Berlin"}' },
      ],
    };
    const result = mapMessage(message);

    expect(result.role).toBe('model');
    expect(result.parts).toHaveLength(1);
    expect(result.parts[0]).toEqual({
      functionCall: {
        name: 'get_weather',
        args: { city: 'Berlin' },
      },
    });
  });

  it('should map tool result message', () => {
    const message: Message = {
      role: 'tool',
      toolCallId: 'get_weather',
      content: '{"temp": 20}',
    };
    const result = mapMessage(message);

    expect(result.role).toBe('user');
    expect(result.parts).toHaveLength(1);
    expect(result.parts[0]).toEqual({
      functionResponse: {
        name: 'get_weather',
        response: { temp: 20 },
      },
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
    expect(result[1]?.role).toBe('model');
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
      parameters: {
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
  it('should map tools to Gemini format', () => {
    const tools: ToolDefinition[] = [
      { name: 'tool1', description: 'Tool 1', parameters: { type: 'object' } },
      { name: 'tool2', description: 'Tool 2', parameters: { type: 'object' } },
    ];

    const result = mapTools(tools);

    expect(result).toHaveLength(1);
    expect(result[0]?.functionDeclarations).toHaveLength(2);
    expect(result[0]?.functionDeclarations?.[0]?.name).toBe('tool1');
    expect(result[0]?.functionDeclarations?.[1]?.name).toBe('tool2');
  });

  it('should return empty array for empty tools', () => {
    const result = mapTools([]);
    expect(result).toHaveLength(0);
  });
});

describe('mapToolChoice', () => {
  it('should map auto to AUTO', () => {
    const result = mapToolChoice('auto');
    expect(result).toEqual({
      functionCallingConfig: { mode: 'AUTO' },
    });
  });

  it('should map required to ANY', () => {
    const result = mapToolChoice('required');
    expect(result).toEqual({
      functionCallingConfig: { mode: 'ANY' },
    });
  });

  it('should map none to NONE', () => {
    const result = mapToolChoice('none');
    expect(result).toEqual({
      functionCallingConfig: { mode: 'NONE' },
    });
  });

  it('should return undefined for undefined', () => {
    const result = mapToolChoice(undefined);
    expect(result).toBeUndefined();
  });
});

describe('mapGenerationConfig', () => {
  it('should map temperature', () => {
    const request: ModelRequest = {
      model: 'gemini-2.0-flash',
      messages: [],
      temperature: 0.7,
    };

    const result = mapGenerationConfig(request);

    expect(result.temperature).toBe(0.7);
  });

  it('should map maxTokens to maxOutputTokens', () => {
    const request: ModelRequest = {
      model: 'gemini-2.0-flash',
      messages: [],
      maxTokens: 1000,
    };

    const result = mapGenerationConfig(request);

    expect(result.maxOutputTokens).toBe(1000);
  });

  it('should use default temperature from options', () => {
    const request: ModelRequest = {
      model: 'gemini-2.0-flash',
      messages: [],
    };

    const result = mapGenerationConfig(request, { defaultTemperature: 0.5 });

    expect(result.temperature).toBe(0.5);
  });

  it('should use default maxTokens from options', () => {
    const request: ModelRequest = {
      model: 'gemini-2.0-flash',
      messages: [],
    };

    const result = mapGenerationConfig(request, { defaultMaxTokens: 2048 });

    expect(result.maxOutputTokens).toBe(2048);
  });

  it('should prefer request values over defaults', () => {
    const request: ModelRequest = {
      model: 'gemini-2.0-flash',
      messages: [],
      temperature: 0.9,
      maxTokens: 500,
    };

    const result = mapGenerationConfig(request, {
      defaultTemperature: 0.5,
      defaultMaxTokens: 2048,
    });

    expect(result.temperature).toBe(0.9);
    expect(result.maxOutputTokens).toBe(500);
  });

  it('should map topP', () => {
    const request: ModelRequest = {
      model: 'gemini-2.0-flash',
      messages: [],
      topP: 0.9,
    };

    const result = mapGenerationConfig(request);

    expect(result.topP).toBe(0.9);
  });

  it('should map stopSequences', () => {
    const request: ModelRequest = {
      model: 'gemini-2.0-flash',
      messages: [],
      stopSequences: ['STOP', 'END'],
    };

    const result = mapGenerationConfig(request);

    expect(result.stopSequences).toEqual(['STOP', 'END']);
  });

  it('should return empty config for request with no generation params', () => {
    const request: ModelRequest = {
      model: 'gemini-2.0-flash',
      messages: [],
    };

    const result = mapGenerationConfig(request);

    expect(result).toEqual({});
  });
});

describe('mapRequest', () => {
  it('should map basic request', () => {
    const request: ModelRequest = {
      model: 'gemini-2.0-flash',
      messages: [{ role: 'user', content: 'Hello' }],
    };

    const result = mapRequest(request);

    expect(result.contents).toHaveLength(1);
    expect(result.contents[0]).toEqual({
      role: 'user',
      parts: [{ text: 'Hello' }],
    });
  });

  it('should include system instruction from messages', () => {
    const request: ModelRequest = {
      model: 'gemini-2.0-flash',
      messages: [
        { role: 'system', content: 'Be helpful' },
        { role: 'user', content: 'Hello' },
      ],
    };

    const result = mapRequest(request);

    expect(result.systemInstruction).toEqual({ text: 'Be helpful' });
    expect(result.contents).toHaveLength(1); // system message filtered out
  });

  it('should use provided system instruction over messages', () => {
    const request: ModelRequest = {
      model: 'gemini-2.0-flash',
      messages: [
        { role: 'system', content: 'Be helpful' },
        { role: 'user', content: 'Hello' },
      ],
    };

    const result = mapRequest(request, { systemInstruction: 'Override instruction' });

    expect(result.systemInstruction).toEqual({ text: 'Override instruction' });
  });

  it('should include tools when present', () => {
    const request: ModelRequest = {
      model: 'gemini-2.0-flash',
      messages: [{ role: 'user', content: 'Hello' }],
      tools: [
        { name: 'get_weather', description: 'Get weather', parameters: { type: 'object' } },
      ],
    };

    const result = mapRequest(request);

    expect(result.tools).toBeDefined();
    expect(result.tools).toHaveLength(1);
    expect(result.tools?.[0]?.functionDeclarations).toHaveLength(1);
  });

  it('should include tool config when toolChoice is set', () => {
    const request: ModelRequest = {
      model: 'gemini-2.0-flash',
      messages: [{ role: 'user', content: 'Hello' }],
      tools: [
        { name: 'get_weather', description: 'Get weather', parameters: { type: 'object' } },
      ],
      toolChoice: 'auto',
    };

    const result = mapRequest(request);

    expect(result.toolConfig).toEqual({
      functionCallingConfig: { mode: 'AUTO' },
    });
  });

  it('should include safety settings when provided', () => {
    const request: ModelRequest = {
      model: 'gemini-2.0-flash',
      messages: [{ role: 'user', content: 'Hello' }],
    };

    const safetySettings = [{ category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' }];
    const result = mapRequest(request, { safetySettings });

    expect(result.safetySettings).toEqual(safetySettings);
  });

  it('should include generation config with defaults', () => {
    const request: ModelRequest = {
      model: 'gemini-2.0-flash',
      messages: [{ role: 'user', content: 'Hello' }],
    };

    const result = mapRequest(request, {
      defaultTemperature: 0.7,
      defaultMaxTokens: 4096,
    });

    expect(result.generationConfig?.temperature).toBe(0.7);
    expect(result.generationConfig?.maxOutputTokens).toBe(4096);
  });
});
