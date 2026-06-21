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
  sanitizeJsonSchemaForGemini,
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
        // Real signature attached so the dummy fallback does not
        // kick in (see the dedicated dummy-fallback test below).
        {
          id: 'call_123',
          name: 'get_weather',
          arguments: '{"city": "Berlin"}',
          thoughtSignature: 'sig_real',
        },
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
      thoughtSignature: 'sig_real',
    });
  });

  it('should map assistant message with only tool calls (no content)', () => {
    const message: Message = {
      role: 'assistant',
      content: '', // Empty content when only tool calls
      toolCalls: [
        {
          id: 'call_123',
          name: 'get_weather',
          arguments: '{"city": "Berlin"}',
          thoughtSignature: 'sig_real',
        },
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
      thoughtSignature: 'sig_real',
    });
  });

  it('should attach a thought_signature to a functionCall part when present on the toolCall', () => {
    // The Gemini API requires `thought_signature` on at least the
    // first functionCall part of a multi-function-call turn when
    // that turn is replayed in a follow-up request — see
    // https://ai.google.dev/gemini-api/docs/thought-signatures.
    // The signature is captured from the original model response
    // on `ToolCallRequest.thoughtSignature` and re-emitted here.
    const message: Message = {
      role: 'assistant',
      content: '',
      toolCalls: [
        {
          id: 'call_1',
          name: 'workspace_list',
          arguments: '{}',
          thoughtSignature: 'sig_abc123',
        },
      ],
    };
    const result = mapMessage(message);
    expect(result.parts[0]).toEqual({
      functionCall: { name: 'workspace_list', args: {} },
      thoughtSignature: 'sig_abc123',
    });
  });

  it('should attach the documented dummy signature to the first functionCall part when no real signature is present', () => {
    // Gemini 3.x family (`gemini-3.1-flash-lite` and others)
    // mandates a `thought_signature` on the first functionCall
    // part of every assistant turn that has function calls. When
    // the model did not emit a real signature (older Gemini
    // versions, or a field that was dropped on the way through
    // the DB), Google's docs explicitly allow a documented
    // dummy to skip the validator:
    //   https://ai.google.dev/gemini-api/docs/thought-signatures
    //   "you can set the following dummy signatures of either
    //    'context_engineering_is_the_way_to_go' or
    //    'skip_thought_signature_validator' in the thought
    //    signature field to skip validation."
    const message: Message = {
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'call_1', name: 'workspace_list', arguments: '{}' }],
    };
    const result = mapMessage(message);
    expect(result.parts[0]).toEqual({
      functionCall: { name: 'workspace_list', args: {} },
      thoughtSignature: 'skip_thought_signature_validator',
    });
  });

  it('should attach the dummy to the first part only; parallel function calls remain signature-less', () => {
    // Per the docs, only the FIRST functionCall part of a
    // multi-part turn is validated. The dummy must therefore
    // attach to index 0, not to subsequent parallel calls.
    const message: Message = {
      role: 'assistant',
      content: '',
      toolCalls: [
        { id: 'call_1', name: 'a', arguments: '{}' },
        { id: 'call_2', name: 'b', arguments: '{}' },
      ],
    };
    const result = mapMessage(message);
    const parts = result.parts as Array<Record<string, unknown>>;
    expect(parts[0]?.thoughtSignature).toBe('skip_thought_signature_validator');
    expect('thoughtSignature' in (parts[1] ?? {})).toBe(false);
  });

  it('real signature wins over the dummy fallback', () => {
    // If the first toolCall carries a real signature, the dummy
    // must NOT replace it.
    const message: Message = {
      role: 'assistant',
      content: '',
      toolCalls: [
        {
          id: 'call_1',
          name: 'workspace_list',
          arguments: '{}',
          thoughtSignature: 'sig_real',
        },
      ],
    };
    const result = mapMessage(message);
    expect(result.parts[0]).toEqual({
      functionCall: { name: 'workspace_list', args: {} },
      thoughtSignature: 'sig_real',
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

  it('wraps a non-JSON tool result (e.g. `Error: ...`) into an error envelope', () => {
    // This is the exact failure mode that produces
    //   Unexpected token 'E', "Error: Fai"... is not valid JSON
    // in production: builtin tools (e.g. `web_fetch`) on failure
    // return `{ ok: false, error }` which the session loop stores
    // as `Error: Failed to extract content from "www.youtube.com"...`
    // in `Message.content`. The previous implementation fed that
    // straight into `JSON.parse` and crashed the next request.
    const message: Message = {
      role: 'tool',
      toolCallId: 'web_fetch',
      content:
        'Error: Failed to extract content from "www.youtube.com". This page likely requires JavaScript to render.',
    };
    const result = mapMessage(message);

    expect(result.parts[0]).toEqual({
      functionResponse: {
        name: 'web_fetch',
        response: {
          ok: false,
          error:
            'Error: Failed to extract content from "www.youtube.com". This page likely requires JavaScript to render.',
        },
      },
    });
  });

  it('returns an empty response object for an empty tool result', () => {
    const message: Message = {
      role: 'tool',
      toolCallId: 'noop',
      content: '',
    };
    const result = mapMessage(message);
    expect(result.parts[0]).toEqual({
      functionResponse: {
        name: 'noop',
        response: {},
      },
    });
  });

  it('treats `isError: true` as an error envelope even when the content is valid JSON', () => {
    const message: Message = {
      role: 'tool',
      toolCallId: 'api_call',
      content: '{"code": 404, "detail": "Not found"}',
      isError: true,
    };
    const result = mapMessage(message);
    expect(result.parts[0]).toEqual({
      functionResponse: {
        name: 'api_call',
        response: {
          ok: false,
          error: '{"code": 404, "detail": "Not found"}',
        },
      },
    });
  });

  it('wraps a non-object JSON tool result (e.g. a bare string) into a result envelope', () => {
    // A tool that returned `"hello"` as JSON — `JSON.parse` succeeds
    // but the result is a string, not an object, which Gemini
    // rejects. Wrap under a `result` key.
    const message: Message = {
      role: 'tool',
      toolCallId: 'greet',
      content: '"hello"',
    };
    const result = mapMessage(message);
    expect(result.parts[0]).toEqual({
      functionResponse: {
        name: 'greet',
        response: { result: '"hello"' },
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
    const messages: Message[] = [{ role: 'user', content: 'Hi' }];
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

  it('should strip additionalProperties and $schema from parameters (mldev API rejects them)', () => {
    // Gemini's Developer API rejects JSON-Schema-specific fields.
    // mapTool must remove them so the request doesn't fail with
    // "Unknown name 'additionalProperties' at '…parameters'".
    const tool = {
      name: 'do_thing',
      description: 'Do a thing',
      parameters: {
        type: 'object',
        properties: {
          input: { type: 'string' },
        },
        required: ['input'],
        additionalProperties: false,
        $schema: 'https://json-schema.org/draft/2020-12/schema',
      },
    } as unknown as ToolDefinition;

    const result = mapTool(tool);

    expect(result.parameters).toEqual({
      type: 'object',
      properties: { input: { type: 'string' } },
      required: ['input'],
    });
    expect(result.parameters).not.toHaveProperty('additionalProperties');
    expect(result.parameters).not.toHaveProperty('$schema');
  });

  it('should strip unsupported keys recursively inside properties', () => {
    const tool = {
      name: 'do_thing',
      description: 'Do a thing',
      parameters: {
        type: 'object',
        properties: {
          nested: {
            type: 'object',
            properties: {
              leaf: { type: 'string', additionalProperties: false },
            },
            additionalProperties: { type: 'string' },
          },
        },
      },
    } as unknown as ToolDefinition;

    const result = mapTool(tool);

    const properties = result.parameters?.['properties'] as
      | Record<string, unknown>
      | undefined;
    const nested = properties?.['nested'] as
      | Record<string, unknown>
      | undefined;
    expect(nested).toEqual({
      type: 'object',
      properties: {
        leaf: { type: 'string' },
      },
    });
  });

  it('should preserve Gemini extensions like anyOf and propertyOrdering', () => {
    const tool = {
      name: 'do_thing',
      description: 'Do a thing',
      parameters: {
        type: 'object',
        anyOf: [{ type: 'string' }, { type: 'integer' }],
        propertyOrdering: ['a', 'b'],
      },
    } as unknown as ToolDefinition;

    const result = mapTool(tool);

    expect(result.parameters?.['anyOf']).toEqual([
      { type: 'string' },
      { type: 'integer' },
    ]);
    expect(result.parameters?.['propertyOrdering']).toEqual(['a', 'b']);
  });

  it('should not include a parameters field when the tool has none', () => {
    // Real ToolDefinitions always carry parameters, but the gemini
    // adapter must tolerate the absence and just omit the field —
    // sending `parameters: {}` would be wrong.
    const tool = {
      name: 'ping',
      description: 'Ping',
    } as unknown as ToolDefinition;

    const result = mapTool(tool);

    expect(result).not.toHaveProperty('parameters');
  });
});

describe('sanitizeJsonSchemaForGemini', () => {
  it('returns undefined for non-object input', () => {
    expect(sanitizeJsonSchemaForGemini(null)).toBeUndefined();
    expect(sanitizeJsonSchemaForGemini(undefined)).toBeUndefined();
    expect(sanitizeJsonSchemaForGemini('string')).toBeUndefined();
    expect(sanitizeJsonSchemaForGemini(42)).toBeUndefined();
    expect(sanitizeJsonSchemaForGemini([])).toBeUndefined();
  });

  it('drops a flat list of unsupported keys', () => {
    expect(
      sanitizeJsonSchemaForGemini({
        type: 'object',
        additionalProperties: false,
        $schema: 'http://json-schema.org/draft-07/schema#',
        $id: 'foo',
        $ref: '#/defs/x',
        $defs: { x: { type: 'string' } },
        $comment: 'wat',
        additional_properties: false,
        examples: ['x', 'y'],
      }),
    ).toEqual({ type: 'object' });
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

  it('should replace `::` with `:` in MCP-style tool names (Gemini rejects two colons)', () => {
    // MCP servers expose tools as `<server>::<tool>`. Gemini's
    // `generateContent` rejects function names containing "more
    // than one colon" with
    //   "Function name contains more than one colon: github::create_or_update_file".
    // The mapper must sanitize the `::` so the request goes
    // through.
    const tools: ToolDefinition[] = [
      {
        name: 'github::create_or_update_file',
        description: 'Create or update a file in a GitHub repo',
        parameters: { type: 'object' },
      },
      {
        name: 'get_weather',
        description: 'Get weather',
        parameters: { type: 'object' },
      },
    ];

    const result = mapTools(tools);

    expect(result[0]?.functionDeclarations?.[0]?.name).toBe(
      'github:create_or_update_file',
    );
    expect(result[0]?.functionDeclarations?.[1]?.name).toBe('get_weather');
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

    // Gemini expects `systemInstruction` to be a Content object
    // (`{ parts: [{ text }] }`), NOT a bare `{ text }` — the latter
    // is rejected with "Unknown name 'text' at 'system_instruction'".
    expect(result.systemInstruction).toEqual({
      parts: [{ text: 'Be helpful' }],
    });
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

    const result = mapRequest(request, {
      systemInstruction: 'Override instruction',
    });

    expect(result.systemInstruction).toEqual({
      parts: [{ text: 'Override instruction' }],
    });
  });

  it('should include tools when present', () => {
    const request: ModelRequest = {
      model: 'gemini-2.0-flash',
      messages: [{ role: 'user', content: 'Hello' }],
      tools: [
        {
          name: 'get_weather',
          description: 'Get weather',
          parameters: { type: 'object' },
        },
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
        {
          name: 'get_weather',
          description: 'Get weather',
          parameters: { type: 'object' },
        },
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

    const safetySettings = [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
    ];
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
