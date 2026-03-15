/**
 * Anthropic Response Mapper
 *
 * Maps Anthropic Messages API responses to normalized internal format.
 */

import type {
  ToolCallRequest,
  UsageInfo,
  FinishReason,
  ModelResponse,
  ModelStreamEvent,
} from '@openaidy/runtime';
import type {
  AnthropicMessagesResponse,
  AnthropicContentBlock,
  AnthropicToolUseBlock,
  AnthropicTextBlock,
  AnthropicStreamEvent,
} from './types';

// =====================
// Type Guards
// =====================

/**
 * Checks if a content block is a text block
 */
export function isTextBlock(block: AnthropicContentBlock): block is AnthropicTextBlock {
  return block.type === 'text';
}

/**
 * Checks if a content block is a tool use block
 */
export function isToolUseBlock(block: AnthropicContentBlock): block is AnthropicToolUseBlock {
  return block.type === 'tool_use';
}

// =====================
// Usage Mapping
// =====================

/**
 * Maps Anthropic usage to normalized usage info
 */
export function mapUsage(usage: AnthropicMessagesResponse['usage']): UsageInfo {
  return {
    promptTokens: usage.input_tokens,
    completionTokens: usage.output_tokens,
    totalTokens: usage.input_tokens + usage.output_tokens,
  };
}

// =====================
// Finish Reason Mapping
// =====================

/**
 * Maps Anthropic stop reason to normalized finish reason
 */
export function mapStopReason(
  stopReason: AnthropicMessagesResponse['stop_reason']
): FinishReason {
  switch (stopReason) {
    case 'end_turn':
      return 'stop';
    case 'max_tokens':
      return 'length';
    case 'stop_sequence':
      return 'stop';
    case 'tool_use':
      return 'tool_calls';
    default:
      return 'stop';
  }
}

// =====================
// Tool Call Mapping
// =====================

/**
 * Maps an Anthropic tool use block to normalized tool call request
 */
export function mapToolUse(toolUse: AnthropicToolUseBlock): ToolCallRequest {
  return {
    id: toolUse.id,
    name: toolUse.name,
    arguments: JSON.stringify(toolUse.input),
  };
}

/**
 * Extracts tool calls from Anthropic content blocks
 */
export function extractToolCalls(blocks: AnthropicContentBlock[]): ToolCallRequest[] {
  const toolCalls: ToolCallRequest[] = [];

  for (const block of blocks) {
    if (isToolUseBlock(block)) {
      toolCalls.push(mapToolUse(block));
    }
  }

  return toolCalls;
}

// =====================
// Response Mapping
// =====================

/**
 * Extracts text content from Anthropic content blocks
 */
export function extractTextContent(blocks: AnthropicContentBlock[]): string {
  const textParts: string[] = [];

  for (const block of blocks) {
    if (isTextBlock(block)) {
      textParts.push(block.text);
    }
  }

  return textParts.join('');
}

/**
 * Maps an Anthropic messages response to normalized model response
 */
export function mapResponse(
  response: AnthropicMessagesResponse,
  providerId: string
): ModelResponse {
  const content = extractTextContent(response.content);
  const toolCalls = extractToolCalls(response.content);

  const result: ModelResponse = {
    id: response.id,
    model: response.model,
    providerId,
    content,
    usage: mapUsage(response.usage),
    finishReason: mapStopReason(response.stop_reason),
    created: new Date().toISOString(),
  };

  // Only add toolCalls if there are any
  if (toolCalls.length > 0) {
    return { ...result, toolCalls };
  }

  return result;
}

// =====================
// Stream Event Mapping
// =====================

/**
 * Accumulator for streaming tool calls
 * Anthropic streams tool input incrementally
 */
export type ToolCallAccumulator = Map<
  number,
  { id: string; name: string; input: string }
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
  event: Extract<AnthropicStreamEvent, { type: 'content_block_start' | 'content_block_delta' }>
): void {
  if (event.type === 'content_block_start') {
    const block = event.content_block;
    if (block.type === 'tool_use') {
      accumulator.set(event.index, {
        id: block.id,
        name: block.name,
        input: '',
      });
    }
  } else if (event.type === 'content_block_delta') {
    const existing = accumulator.get(event.index);
    if (existing && event.delta.type === 'input_json_delta') {
      existing.input += event.delta.partial_json;
    }
  }
}

/**
 * Converts accumulated tool calls to normalized format
 */
export function finalizeToolCalls(
  accumulator: ToolCallAccumulator
): ToolCallRequest[] | undefined {
  if (accumulator.size === 0) return undefined;

  const toolCalls: ToolCallRequest[] = [];
  for (const [index, tc] of Array.from(accumulator.entries()).sort(
    ([a], [b]) => a - b
  )) {
    toolCalls.push({
      id: tc.id || `tool_${index}`,
      name: tc.name,
      arguments: tc.input,
    });
  }

  return toolCalls.length > 0 ? toolCalls : undefined;
}

/**
 * Maps Anthropic stream events to normalized stream events
 */
export function* mapStreamEvent(
  event: AnthropicStreamEvent,
  providerId: string,
  streamId: string,
  model: string
): Generator<ModelStreamEvent> {
  const timestamp = new Date().toISOString();

  switch (event.type) {
    case 'message_start':
      yield {
        type: 'stream.started',
        timestamp,
        id: event.message.id,
        model: event.message.model,
        providerId,
      };
      break;

    case 'content_block_delta':
      if (event.delta.type === 'text_delta') {
        yield {
          type: 'stream.content_delta',
          timestamp,
          id: streamId,
          delta: event.delta.text,
        };
      }
      break;

    case 'message_delta':
      if (event.usage) {
        yield {
          type: 'stream.usage',
          timestamp,
          id: streamId,
          usage: {
            promptTokens: 0, // Not provided in delta
            completionTokens: event.usage.output_tokens,
            totalTokens: event.usage.output_tokens,
          },
        };
      }
      break;

    case 'message_stop':
      yield {
        type: 'stream.finished',
        timestamp,
        id: streamId,
        finishReason: 'stop', // Will be updated by adapter
      };
      break;

    case 'error':
      yield {
        type: 'stream.error',
        timestamp,
        id: streamId,
        error: {
          code: 'provider.unknown',
          message: event.error.message,
          retryable: false,
        },
      };
      break;

    // Ignore other event types
    case 'content_block_start':
    case 'content_block_stop':
    case 'ping':
      break;
  }
}

/**
 * Extracts stop reason from message_delta event
 */
export function extractStopReasonFromDelta(
  event: Extract<AnthropicStreamEvent, { type: 'message_delta' }>
): FinishReason | null {
  if (!event.delta.stop_reason) return null;
  return mapStopReason(event.delta.stop_reason as AnthropicMessagesResponse['stop_reason']);
}
