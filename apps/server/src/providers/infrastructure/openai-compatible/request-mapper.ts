/**
 * OpenAI-Compatible Request Mapper
 *
 * Maps normalized internal requests to OpenAI-compatible API payloads.
 */

import type { Message, ModelRequest, ToolDefinition } from '@openaidy/runtime';
import type {
  OpenAIMessage,
  OpenAIChatCompletionRequest,
  OpenAIToolDefinition,
} from './types';

// =====================
// Message Mapping
// =====================

/**
 * Maps a normalized message to OpenAI message format
 */
export function mapMessage(message: Message): OpenAIMessage {
  switch (message.role) {
    case 'system':
      return {
        role: 'system',
        content: message.content,
      };

    case 'user':
      return {
        role: 'user',
        content: message.content,
      };

    case 'assistant': {
      const openAIMsg: OpenAIMessage = {
        role: 'assistant',
        content: message.content ?? null,
      };

      // Map tool calls if present
      if (message.toolCalls && message.toolCalls.length > 0) {
        openAIMsg.tool_calls = message.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: {
            name: tc.name,
            arguments: tc.arguments,
          },
        }));
      }

      return openAIMsg;
    }

    case 'tool':
      return {
        role: 'tool',
        content: message.content,
        tool_call_id: message.toolCallId,
      };

    default: {
      // Exhaustive check
      const _exhaustive: never = message;
      throw new Error(`Unknown message role: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

/**
 * Maps all messages to OpenAI format
 */
export function mapMessages(messages: readonly Message[]): OpenAIMessage[] {
  return messages.map(mapMessage);
}

// =====================
// Tool Mapping
// =====================

/**
 * Maps a normalized tool definition to OpenAI tool format
 */
export function mapTool(tool: ToolDefinition): OpenAIToolDefinition {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters as Record<string, unknown>,
    },
  };
}

/**
 * Maps all tools to OpenAI format
 */
export function mapTools(tools: readonly ToolDefinition[]): OpenAIToolDefinition[] {
  return tools.map(mapTool);
}

/**
 * Maps tool choice to OpenAI format
 */
export function mapToolChoice(
  toolChoice?: 'auto' | 'required' | 'none'
): 'auto' | 'required' | 'none' | undefined {
  return toolChoice;
}

// =====================
// Request Mapping
// =====================

/**
 * Maps a normalized model request to OpenAI chat completion request
 */
export function mapRequest(request: ModelRequest): OpenAIChatCompletionRequest {
  const openAIRequest: OpenAIChatCompletionRequest = {
    model: request.model,
    messages: mapMessages(request.messages),
  };

  // Add optional fields
  if (request.maxTokens !== undefined) {
    openAIRequest.max_tokens = request.maxTokens;
  }

  if (request.temperature !== undefined) {
    openAIRequest.temperature = request.temperature;
  }

  if (request.topP !== undefined) {
    openAIRequest.top_p = request.topP;
  }

  if (request.stopSequences !== undefined && request.stopSequences.length > 0) {
    if (request.stopSequences.length === 1 && request.stopSequences[0]) {
      openAIRequest.stop = request.stopSequences[0];
    } else {
      openAIRequest.stop = [...request.stopSequences];
    }
  }

  if (request.stream !== undefined) {
    openAIRequest.stream = request.stream;
  }

  // Map tools if present
  if (request.tools && request.tools.length > 0) {
    openAIRequest.tools = mapTools(request.tools);
    const mappedToolChoice = mapToolChoice(request.toolChoice);
    if (mappedToolChoice !== undefined) {
      openAIRequest.tool_choice = mappedToolChoice;
    }
  }

  // Pass through metadata
  if (request.metadata) {
    openAIRequest.metadata = request.metadata;
  }

  return openAIRequest;
}
