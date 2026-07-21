/**
 * OpenAI-Compatible Response Mapper
 *
 * Maps OpenAI API responses to normalized internal response shapes.
 */

import type {
  ModelResponse,
  ModelStreamEvent,
  ToolCallRequest,
  UsageInfo,
  FinishReason,
} from '@openaidy/runtime';
import type {
  OpenAIChatCompletionResponse,
  OpenAIStreamChunk,
  OpenAIToolCall,
} from './types';

// =====================
// Usage Mapping
// =====================

/**
 * Maps OpenAI usage to normalized usage info
 */
export function mapUsage(
  usage: OpenAIChatCompletionResponse['usage'],
): UsageInfo {
  const cachedTokens = usage.prompt_tokens_details?.cached_tokens;
  return {
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
    ...(cachedTokens !== undefined && { cacheReadTokens: cachedTokens }),
  };
}

// =====================
// Finish Reason Mapping
// =====================

/**
 * Maps OpenAI finish reason to normalized finish reason
 */
export function mapFinishReason(
  reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null,
): FinishReason {
  if (reason === null) {
    return 'stop';
  }

  switch (reason) {
    case 'stop':
      return 'stop';
    case 'length':
      return 'length';
    case 'tool_calls':
      return 'tool_calls';
    case 'content_filter':
      return 'content_filter';
    default:
      return 'error';
  }
}

// =====================
// Tool Call Mapping
// =====================

/**
 * Maps an OpenAI tool call to normalized tool call request
 */
export function mapToolCall(toolCall: OpenAIToolCall): ToolCallRequest {
  return {
    id: toolCall.id,
    name: toolCall.function.name,
    arguments: toolCall.function.arguments,
  };
}

/**
 * Maps all tool calls to normalized format
 */
export function mapToolCalls(toolCalls: OpenAIToolCall[]): ToolCallRequest[] {
  return toolCalls.map(mapToolCall);
}

// =====================
// Response Mapping
// =====================

/**
 * Maps an OpenAI chat completion response to normalized model response
 */
export function mapResponse(
  response: OpenAIChatCompletionResponse,
  providerId: string,
): ModelResponse {
  const choice = response.choices[0];
  if (!choice) {
    throw new Error('OpenAI response has no choices');
  }

  const hasToolCalls =
    choice.message.tool_calls && choice.message.tool_calls.length > 0;

  const modelResponse: ModelResponse = {
    id: response.id,
    model: response.model,
    providerId,
    content: choice.message.content ?? '',
    usage: mapUsage(response.usage),
    finishReason: mapFinishReason(choice.finish_reason),
    created: new Date(response.created * 1000).toISOString(),
    ...(hasToolCalls
      ? { toolCalls: mapToolCalls(choice.message.tool_calls!) }
      : {}),
  };

  return modelResponse;
}

// =====================
// Stream Event Mapping
// =====================

/**
 * Accumulator for streaming tool calls
 * OpenAI streams tool call arguments incrementally
 */
export type ToolCallAccumulator = Map<
  number,
  { id: string; name: string; arguments: string }
>;

/**
 * Creates an empty tool call accumulator
 */
export function createToolCallAccumulator(): ToolCallAccumulator {
  return new Map();
}

/**
 * Updates tool call accumulator with delta
 */
export function updateToolCallAccumulator(
  accumulator: ToolCallAccumulator,
  delta: OpenAIStreamChunk['choices'][0]['delta']['tool_calls'],
): void {
  if (!delta) return;

  for (const toolCallDelta of delta) {
    const index = toolCallDelta.index;
    const existing = accumulator.get(index);

    if (existing) {
      // Append to existing
      if (toolCallDelta.function?.arguments) {
        existing.arguments += toolCallDelta.function.arguments;
      }
    } else {
      // Create new entry
      accumulator.set(index, {
        id: toolCallDelta.id ?? '',
        name: toolCallDelta.function?.name ?? '',
        arguments: toolCallDelta.function?.arguments ?? '',
      });
    }
  }
}

/**
 * Converts accumulated tool calls to normalized format
 */
export function finalizeToolCalls(
  accumulator: ToolCallAccumulator,
): ToolCallRequest[] | undefined {
  if (accumulator.size === 0) return undefined;

  const toolCalls: ToolCallRequest[] = [];
  for (const [index, tc] of Array.from(accumulator.entries()).sort(
    ([a], [b]) => a - b,
  )) {
    toolCalls.push({
      id: tc.id || `tool_${index}`,
      name: tc.name,
      arguments: tc.arguments,
    });
  }

  return toolCalls.length > 0 ? toolCalls : undefined;
}

/**
 * Maps an OpenAI stream chunk to normalized stream events
 */
export function* mapStreamChunk(
  chunk: OpenAIStreamChunk,
  providerId: string,
  responseId: string,
): Generator<ModelStreamEvent> {
  const choice = chunk.choices[0];
  if (!choice) return;

  const timestamp = new Date(chunk.created * 1000).toISOString();

  // Content delta
  if (choice.delta.content) {
    yield {
      type: 'stream.content_delta',
      timestamp,
      id: responseId,
      delta: choice.delta.content,
    };
  }

  // Usage (may appear at end of stream)
  if (chunk.usage) {
    yield {
      type: 'stream.usage',
      timestamp,
      id: responseId,
      usage: mapUsage(chunk.usage),
    };
  }
}
