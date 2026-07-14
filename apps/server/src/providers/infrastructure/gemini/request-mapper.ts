/**
 * Gemini Request Mapper
 *
 * Maps normalized internal requests to Gemini API payloads.
 */

import type { Message, ModelRequest, ToolDefinition } from '@openaidy/runtime';
import type {
  GeminiContent,
  GeminiPart,
  GeminiTool,
  GeminiFunctionDeclaration,
  GeminiGenerateContentRequest,
  GeminiGenerationConfig,
  GeminiSafetySetting,
} from './types';
import { sanitizeGeminiFunctionName } from './name-mapping';

// =====================
// Message Mapping
// =====================

/**
 * Maps a normalized message role to Gemini role
 */
export function mapRole(role: Message['role']): 'user' | 'model' {
  switch (role) {
    case 'user':
      return 'user';
    case 'assistant':
      return 'model';
    case 'system':
    case 'tool':
      // System and tool messages are handled differently in Gemini
      // System is passed via systemInstruction
      // Tool results are mapped to user messages with functionResponse
      return 'user';
    default: {
      const _exhaustive: never = role;
      throw new Error(`Unknown message role: ${_exhaustive}`);
    }
  }
}

/**
 * Maps a normalized message to Gemini content format
 */
export function mapMessage(message: Message): GeminiContent {
  switch (message.role) {
    case 'system':
      // System messages are handled separately via systemInstruction
      // If we reach here, treat as user message
      return {
        role: 'user',
        parts: [{ text: message.content }],
      };

    case 'user': {
      // Attachments become inlineData parts (Gemini accepts both image and
      // audio bytes inline as base64).
      if (message.attachments && message.attachments.length > 0) {
        const parts: GeminiPart[] = [];
        if (message.content) {
          parts.push({ text: message.content });
        }
        for (const attachment of message.attachments) {
          parts.push({
            inlineData: {
              mimeType: attachment.mimeType,
              data: attachment.data,
            },
          });
        }
        return { role: 'user', parts };
      }
      return {
        role: 'user',
        parts: [{ text: message.content }],
      };
    }

    case 'assistant': {
      const parts: GeminiPart[] = [];

      // Add text content if present
      if (message.content) {
        parts.push({ text: message.content });
      }

      // Map tool calls to function calls. The Gemini API *requires*
      // a `thought_signature` on at least the first functionCall
      // part of a multi-function-call assistant turn when that
      // turn is replayed in a follow-up request — missing
      // signatures cause "Function call is missing a
      // thought_signature in functionCall parts" 4xx errors. The
      // signature is captured from the original model response
      // (see `response-mapper.ts`) and round-tripped on the
      // `toolCall.thoughtSignature` field. Per the docs, only
      // the first functionCall part of a parallel-function-call
      // turn carries a signature; we attach the field whenever
      // it's present, which is harmless.
      //
      // Fallback for models that do *not* emit a thought
      // signature (older Gemini 2.5 turn-by-turn behaviour, or
      // any race condition where the field was dropped on the
      // way through the DB): the docs explicitly allow a dummy
      // signature to skip the validator — see the FAQ at
      // https://ai.google.dev/gemini-api/docs/thought-signatures:
      //
      //   "you can set the following dummy signatures of either
      //    'context_engineering_is_the_way_to_go' or
      //    'skip_thought_signature_validator' in the thought
      //    signature field to skip validation."
      //
      // We attach the dummy to the FIRST functionCall part (the
      // only one the API actually validates); subsequent
      // parallel function calls in the same turn are left
      // untouched per the docs.
      if (message.toolCalls && message.toolCalls.length > 0) {
        for (const [idx, toolCall] of message.toolCalls.entries()) {
          const part: GeminiPart = {
            functionCall: {
              name: toolCall.name,
              args: JSON.parse(toolCall.arguments),
            },
            // Real signature always wins; the dummy fallback only
            // kicks in on the FIRST functionCall part when no
            // real signature is present (so the API doesn't 4xx
            // the request — see `DUMMY_THOUGHT_SIGNATURE` above).
            ...(toolCall.thoughtSignature
              ? { thoughtSignature: toolCall.thoughtSignature }
              : idx === 0
                ? { thoughtSignature: DUMMY_THOUGHT_SIGNATURE }
                : {}),
          };
          parts.push(part);
        }
      }

      // Ensure at least one part
      if (parts.length === 0) {
        parts.push({ text: '' });
      }

      return {
        role: 'model',
        parts,
      };
    }

    case 'tool':
      // Tool result is mapped as a function response. The Gemini
      // `functionResponse.response` field must be a JSON object
      // (not a string) — a bare string like `"Error: Failed to…"`
      // produces
      //   Unexpected token 'E', "Error: Fai"... is not valid JSON
      // at `JSON.parse` time. Most builtin tools return their
      // success payload as a JSON string (e.g. `{"temp": 20}`), but
      // error paths persist the message prefixed with `Error: ` and
      // never attempt to serialize it. Decode defensively:
      //   - empty content      → `{}`
      //   - valid JSON string  → parse it
      //   - anything else      → wrap as `{ ok: false, error: ... }`
      //     (mirrors the `present_choices` `INTERRUPT_CHOICES`
      //     envelope so the model always sees a structured payload)
      return {
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: message.toolCallId ?? 'unknown',
              response: parseToolResponseContent(
                message.content,
                message.isError,
              ),
            },
          } as GeminiPart,
        ],
      };

    default: {
      const _exhaustive: never = message;
      throw new Error(`Unknown message role: ${_exhaustive}`);
    }
  }
}

/**
 * Maps all messages to Gemini content format
 * Filters out system messages (handled via systemInstruction)
 */
export function mapMessages(messages: readonly Message[]): GeminiContent[] {
  return messages.filter((msg) => msg.role !== 'system').map(mapMessage);
}

/**
 * Extracts system instruction from messages
 */
export function extractSystemInstruction(
  messages: readonly Message[],
): string | undefined {
  const systemMessages = messages.filter((msg) => msg.role === 'system');
  if (systemMessages.length === 0) return undefined;
  return systemMessages.map((msg) => msg.content).join('\n\n');
}

// =====================
// JSON Schema sanitization
// =====================

/**
 * Fields of a JSON Schema that the Gemini Developer API (`mldev`)
 * rejects on a function declaration's `parameters` object. The
 * upstream API's strict-proto definition doesn't include them, and
 * Google's official Python SDK explicitly raises client-side if
 * `additionalProperties` is present (see
 * `_raise_for_unsupported_mldev_properties` in `python-genai`).
 *
 * Leaving them in causes errors like:
 *   "Invalid JSON payload received. Unknown name 'additionalProperties'
 *    at 'tools[0].function_declarations[0].parameters'."
 *
 * The Gemini-specific extensions we DO want to keep (`anyOf`, `items`,
 * `properties`, `propertyOrdering`, `nullable`, etc.) are listed in
 * the official `Schema` type and pass through untouched.
 */
const UNSUPPORTED_JSON_SCHEMA_KEYS: readonly string[] = [
  'additionalProperties',
  'additional_properties',
  '$schema',
  '$id',
  '$ref',
  '$defs',
  '$comment',
  'examples',
];

/**
 * Sentinel `thought_signature` value that tells the Gemini API to
 * skip the validator instead of rejecting a function-call turn
 * whose real signature was lost (e.g. older models that don't
 * emit one, or a field that was dropped somewhere on the way
 * through the DB). Documented as a workaround in the FAQ at
 * https://ai.google.dev/gemini-api/docs/thought-signatures:
 *   "you can set the following dummy signatures of either
 *    'context_engineering_is_the_way_to_go' or
 *    'skip_thought_signature_validator' in the thought signature
 *    field to skip validation."
 * We use the shorter, more explicit of the two.
 */
const DUMMY_THOUGHT_SIGNATURE = 'skip_thought_signature_validator' as const;

/**
 * Recursively strip JSON-Schema-specific fields that the Gemini
 * Developer API rejects. The walker preserves the original object
 * structure — only the unsupported keys are removed, arrays are
 * traversed, and nested object schemas (under `properties.*`,
 * `items`, `anyOf[*]`) are sanitized in turn.
 */
export function sanitizeJsonSchemaForGemini(
  schema: unknown,
): Record<string, unknown> | undefined {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return undefined;
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (UNSUPPORTED_JSON_SCHEMA_KEYS.includes(key)) continue;

    if (key === 'properties' && value && typeof value === 'object') {
      const cleaned: Record<string, unknown> = {};
      for (const [propName, propSchema] of Object.entries(value)) {
        const sanitized = sanitizeJsonSchemaForGemini(propSchema);
        if (sanitized !== undefined) cleaned[propName] = sanitized;
      }
      if (Object.keys(cleaned).length > 0) out[key] = cleaned;
      continue;
    }

    if (key === 'items' || key === 'contains') {
      const sanitized = sanitizeJsonSchemaForGemini(value);
      if (sanitized !== undefined) out[key] = sanitized;
      continue;
    }

    if (key === 'anyOf' || key === 'oneOf' || key === 'allOf') {
      if (Array.isArray(value)) {
        const cleanedArray = value
          .map((item) => sanitizeJsonSchemaForGemini(item))
          .filter((item) => item !== undefined);
        if (cleanedArray.length > 0) out[key] = cleanedArray;
      }
      continue;
    }

    out[key] = value;
  }
  return out;
}

// =====================
// Tool Mapping
// =====================

/**
 * Maps a normalized tool definition to Gemini function declaration.
 *
 * Note: this function does NOT sanitize the function name. The
 * `::` → `:` translation (for MCP-style names) is performed by
 * `mapRequest` because the inverse mapping is needed to recover
 * the original name on the response side.
 */
export function mapTool(tool: ToolDefinition): GeminiFunctionDeclaration {
  const sanitizedParameters = tool.parameters
    ? sanitizeJsonSchemaForGemini(tool.parameters)
    : undefined;
  return {
    name: tool.name,
    description: tool.description,
    ...(sanitizedParameters ? { parameters: sanitizedParameters } : {}),
  };
}

/**
 * Maps all tools to Gemini tool format. Function names are
 * sanitized (`::` → `:`) so MCP-style names are API-valid; the
 * inverse mapping is built by `buildFunctionNameMap` and consumed
 * by the response mapper.
 */
export function mapTools(tools: readonly ToolDefinition[]): GeminiTool[] {
  if (tools.length === 0) return [];

  return [
    {
      functionDeclarations: tools.map((tool) => ({
        ...mapTool(tool),
        name: sanitizeGeminiFunctionName(tool.name),
      })),
    },
  ];
}

/**
 * Maps tool choice to Gemini function calling config
 */
export function mapToolChoice(
  toolChoice?: 'auto' | 'required' | 'none',
): { functionCallingConfig: { mode: 'AUTO' | 'ANY' | 'NONE' } } | undefined {
  if (!toolChoice) return undefined;

  const modeMap: Record<string, 'AUTO' | 'ANY' | 'NONE'> = {
    auto: 'AUTO',
    required: 'ANY',
    none: 'NONE',
  };

  const mode = modeMap[toolChoice];
  if (!mode) return undefined;

  return {
    functionCallingConfig: {
      mode,
    },
  };
}

// =====================
// Generation Config Mapping
// =====================

/**
 * Maps request parameters to Gemini generation config
 */
export function mapGenerationConfig(
  request: ModelRequest,
  defaults?: {
    defaultTemperature?: number;
    defaultMaxTokens?: number;
  },
): GeminiGenerationConfig {
  const config: GeminiGenerationConfig = {};

  if (request.temperature !== undefined) {
    config.temperature = request.temperature;
  } else if (defaults?.defaultTemperature !== undefined) {
    config.temperature = defaults.defaultTemperature;
  }

  if (request.maxTokens !== undefined) {
    config.maxOutputTokens = request.maxTokens;
  } else if (defaults?.defaultMaxTokens !== undefined) {
    config.maxOutputTokens = defaults.defaultMaxTokens;
  }

  if (request.topP !== undefined) {
    config.topP = request.topP;
  }

  if (request.stopSequences !== undefined && request.stopSequences.length > 0) {
    config.stopSequences = [...request.stopSequences];
  }

  return config;
}

// =====================
// Request Mapping
// =====================

/**
 * Maps a normalized model request to Gemini generate content request
 */
export function mapRequest(
  request: ModelRequest,
  options?: {
    defaultTemperature?: number;
    defaultMaxTokens?: number;
    safetySettings?: GeminiSafetySetting[];
    systemInstruction?: string;
  },
): GeminiGenerateContentRequest {
  // Extract system instruction from messages or use provided one
  const systemFromMessages = extractSystemInstruction(request.messages);
  const systemInstruction = options?.systemInstruction ?? systemFromMessages;

  // Build generation config options, filtering out undefined values
  const genConfigOptions: {
    defaultTemperature?: number;
    defaultMaxTokens?: number;
  } = {};
  if (options?.defaultTemperature !== undefined) {
    genConfigOptions.defaultTemperature = options.defaultTemperature;
  }
  if (options?.defaultMaxTokens !== undefined) {
    genConfigOptions.defaultMaxTokens = options.defaultMaxTokens;
  }

  const geminiRequest: GeminiGenerateContentRequest = {
    contents: mapMessages(request.messages),
    generationConfig: mapGenerationConfig(request, genConfigOptions),
  };

  // Add system instruction if present. The Gemini API expects a
  // `Content` object (`{ parts: [{ text }] }`), NOT a bare `{ text }`
  // — a top-level `text` field on `system_instruction` is rejected
  // with "Unknown name 'text' at 'system_instruction': Cannot find
  // field." This mirrors the official Google Gen AI SDK
  // (`_Content_to_mldev` in `python-genai/models.py`), which always
  // produces `{ parts: [...] }`.
  if (systemInstruction) {
    geminiRequest.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  // Add safety settings if provided
  if (options?.safetySettings && options.safetySettings.length > 0) {
    geminiRequest.safetySettings = options.safetySettings;
  }

  // Map tools if present
  if (request.tools && request.tools.length > 0) {
    geminiRequest.tools = mapTools(request.tools);

    const toolConfig = mapToolChoice(request.toolChoice);
    if (toolConfig) {
      geminiRequest.toolConfig = toolConfig;
    }
  }

  return geminiRequest;
}

// =====================
// Tool Result Envelope Decoding
// =====================

/**
 * Decode a `Message.content` (a string) into the object shape that
 * Gemini's `functionResponse.response` field expects. Three cases:
 *
 *   1. Empty / whitespace-only content → `{}`.
 *   2. Valid JSON object (the success path for most builtin tools) →
 *      returned as-is.
 *   3. Anything else — plain text like `"Error: Failed to extract
 *      content from \"www.youtube.com\"..."` — wrapped in an
 *      `{ ok: false, error }` envelope so the parser never sees
 *      `JSON.parse("Error: Fai…")` and throws.
 *
 * The `isError` flag on the message is preferred when present (so
 * the envelope becomes `{ ok: false, error }` even if the content
 * happens to be parseable JSON, e.g. a structured error payload).
 */
function parseToolResponseContent(
  content: string | undefined,
  isError?: boolean,
): Record<string, unknown> {
  if (!content || content.trim() === '') {
    return isError ? { ok: false, error: '' } : {};
  }

  // If the caller marked this as an error result, always wrap in
  // the error envelope — even if the content happens to be valid
  // JSON (e.g. a structured error payload from a tool that does
  // proper error reporting).
  if (isError) {
    return { ok: false, error: content };
  }

  // Success path: try to parse as JSON object. If it parses to an
  // object, return it; otherwise wrap as a string-valued response.
  try {
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { result: content };
  } catch {
    // Not valid JSON — typical for tool error strings (the
    // `sessions/service.ts` loop prefixes them with `"Error: "`).
    // Wrap in a structured envelope so Gemini gets a valid object.
    return { ok: false, error: content };
  }
}
