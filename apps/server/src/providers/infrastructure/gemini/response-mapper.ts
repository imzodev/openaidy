/**
 * Gemini Response Mapper
 *
 * Maps Gemini API responses to normalized internal format.
 */

import type { ToolCallRequest, UsageInfo, FinishReason } from '@openaidy/runtime';
import type {
  GeminiGenerateContentResponse,
  GeminiCandidate,
  GeminiStreamChunk,
  GeminiPart,
  GeminiFunctionCallPart,
} from './types';

// =====================
// Type Guards
// =====================

/**
 * Checks if a part is a text part
 */
export function isTextPart(part: GeminiPart): part is { text: string } {
  return 'text' in part;
}

/**
 * Checks if a part is a function call part
 */
export function isFunctionCallPart(part: GeminiPart): part is GeminiFunctionCallPart {
  return 'functionCall' in part;
}

// =====================
// Usage Mapping
// =====================

/**
 * Maps Gemini usage metadata to normalized usage info
 */
export function mapUsage(
  usageMetadata?: GeminiGenerateContentResponse['usageMetadata']
): UsageInfo {
  if (!usageMetadata) {
    return {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    };
  }
  
  return {
    promptTokens: usageMetadata.promptTokenCount,
    completionTokens: usageMetadata.candidatesTokenCount,
    totalTokens: usageMetadata.totalTokenCount,
  };
}

// =====================
// Finish Reason Mapping
// =====================

/**
 * Maps Gemini finish reason to normalized finish reason
 */
export function mapFinishReason(
  finishReason?: GeminiCandidate['finishReason']
): FinishReason {
  switch (finishReason) {
    case 'STOP':
      return 'stop';
    case 'MAX_TOKENS':
      return 'length';
    case 'SAFETY':
    case 'RECITATION':
      return 'content_filter';
    case 'TOOL_CALLS':
      return 'tool_calls';
    default:
      return 'stop';
  }
}

// =====================
// Tool Call Mapping
// =====================

/**
 * Maps a Gemini function call to normalized tool call
 */
export function mapFunctionCall(
  functionCall: GeminiFunctionCallPart['functionCall']
): ToolCallRequest {
  return {
    id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
    name: functionCall.name,
    arguments: JSON.stringify(functionCall.args),
  };
}

/**
 * Extracts tool calls from Gemini parts
 */
export function extractToolCalls(parts: GeminiPart[]): ToolCallRequest[] {
  const toolCalls: ToolCallRequest[] = [];
  
  for (const part of parts) {
    if (isFunctionCallPart(part)) {
      toolCalls.push(mapFunctionCall(part.functionCall));
    }
  }
  
  return toolCalls;
}

// =====================
// Response Mapping
// =====================

/**
 * Extracts text content from Gemini parts
 */
export function extractTextContent(parts: GeminiPart[]): string {
  const textParts: string[] = [];
  
  for (const part of parts) {
    if (isTextPart(part)) {
      textParts.push(part.text);
    }
  }
  
  return textParts.join('');
}

/**
 * Maps Gemini generate content response to normalized model response
 */
export function mapResponse(
  response: GeminiGenerateContentResponse,
  providerId: string
): {
  id: string;
  model: string;
  providerId: string;
  content: string;
  toolCalls?: ToolCallRequest[];
  usage: UsageInfo;
  finishReason: FinishReason;
  created: string;
} {
  const candidate = response.candidates[0];
  
  if (!candidate) {
    return {
      id: `gemini_${Date.now()}`,
      model: 'unknown',
      providerId,
      content: '',
      usage: mapUsage(response.usageMetadata),
      finishReason: 'stop',
      created: new Date().toISOString(),
    };
  }
  
  const parts = candidate.content.parts;
  const content = extractTextContent(parts);
  const toolCalls = extractToolCalls(parts);

  const result = {
    id: `gemini_${Date.now()}`,
    model: 'gemini-model', // Will be overwritten by adapter
    providerId,
    content,
    usage: mapUsage(response.usageMetadata),
    finishReason: mapFinishReason(candidate.finishReason),
    created: new Date().toISOString(),
  };

  // Only add toolCalls if there are any (exactOptionalPropertyTypes compatibility)
  if (toolCalls.length > 0) {
    return { ...result, toolCalls };
  }

  return result;
}

// =====================
// Stream Mapping
// =====================

/**
 * Maps Gemini stream chunk to normalized stream events
 */
export function* mapStreamChunk(
  chunk: GeminiStreamChunk,
  providerId: string,
  streamId: string
): Generator<
  | { type: 'stream.content_delta'; timestamp: string; id: string; delta: string }
  | { type: 'stream.tool_call'; timestamp: string; id: string; toolCall: ToolCallRequest }
  | { type: 'stream.usage'; timestamp: string; id: string; usage: UsageInfo }
> {
  const candidate = chunk.candidates[0];
  if (!candidate) return;
  
  const timestamp = new Date().toISOString();
  
  // Handle content deltas
  if (candidate.content.parts) {
    for (const part of candidate.content.parts) {
      if (isTextPart(part) && part.text) {
        yield {
          type: 'stream.content_delta',
          timestamp,
          id: streamId,
          delta: part.text,
        };
      } else if (isFunctionCallPart(part)) {
        yield {
          type: 'stream.tool_call',
          timestamp,
          id: streamId,
          toolCall: mapFunctionCall(part.functionCall),
        };
      }
    }
  }
  
  // Handle usage metadata
  if (chunk.usageMetadata) {
    yield {
      type: 'stream.usage',
      timestamp,
      id: streamId,
      usage: mapUsage(chunk.usageMetadata),
    };
  }
}
