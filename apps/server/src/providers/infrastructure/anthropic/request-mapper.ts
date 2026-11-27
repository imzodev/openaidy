/**
 * Anthropic Request Mapper
 *
 * Maps normalized internal requests to Anthropic Messages API payloads.
 */

import type { Message, ModelRequest, ToolDefinition } from '@aidyagent/runtime';
import type {
  AnthropicMessage,
  AnthropicContentBlock,
  AnthropicTextBlock,
  AnthropicToolDefinition,
  AnthropicMessagesRequest,
} from './types';
import { resolveReasoningSupport } from '@aidyagent/shared-types';

const EPHEMERAL = { type: 'ephemeral' } as const;

// =====================
// Message Mapping
// =====================

/**
 * Maps a normalized message to Anthropic message format
 */
export function mapMessage(message: Message): AnthropicMessage | null {
  switch (message.role) {
    case 'system':
      // System messages are handled separately via the system field
      // Return null to indicate it should be extracted separately
      return null;

    case 'user': {
      // Attachments become content blocks: text plus base64 image blocks.
      // Anthropic has no audio input type, so audio attachments degrade to
      // a text note (the capability check upstream avoids this path for
      // audio-capable flows).
      if (message.attachments && message.attachments.length > 0) {
        const blocks: AnthropicContentBlock[] = [];
        if (message.content) {
          blocks.push({ type: 'text', text: message.content });
        }
        for (const attachment of message.attachments) {
          if (attachment.kind === 'image') {
            blocks.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: attachment.mimeType,
                data: attachment.data,
              },
            });
          } else {
            blocks.push({
              type: 'text',
              text: `[Audio attachment${attachment.name ? ` "${attachment.name}"` : ''} (${attachment.mimeType}) — this model cannot process audio input natively.]`,
            });
          }
        }
        return { role: 'user', content: blocks };
      }
      return {
        role: 'user',
        content: message.content,
      };
    }

    case 'assistant': {
      const blocks: AnthropicContentBlock[] = [];

      // Add text content if present
      if (message.content) {
        blocks.push({ type: 'text', text: message.content });
      }

      // Map tool calls to tool_use blocks
      if (message.toolCalls && message.toolCalls.length > 0) {
        for (const toolCall of message.toolCalls) {
          blocks.push({
            type: 'tool_use',
            id: toolCall.id,
            name: toolCall.name,
            input: JSON.parse(toolCall.arguments),
          });
        }
      }

      return {
        role: 'assistant',
        content: blocks.length > 0 ? blocks : [{ type: 'text', text: '' }],
      };
    }

    case 'tool':
      // Tool result is mapped as a user message with tool_result content
      return {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: message.toolCallId,
            content: message.content,
            ...(message.isError !== undefined
              ? { is_error: message.isError }
              : {}),
          },
        ],
      };

    default: {
      const _exhaustive: never = message;
      throw new Error(`Unknown message role: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

/**
 * Maps all messages to Anthropic format, filtering out system messages
 */
export function mapMessages(messages: readonly Message[]): AnthropicMessage[] {
  const mapped: AnthropicMessage[] = [];

  for (const message of messages) {
    const anthropicMessage = mapMessage(message);
    if (anthropicMessage !== null) {
      mapped.push(anthropicMessage);
    }
  }

  return mapped;
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
// Tool Mapping
// =====================

/**
 * Maps a normalized tool definition to Anthropic tool format
 */
export function mapTool(tool: ToolDefinition): AnthropicToolDefinition {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters as Record<string, unknown>,
  };
}

/**
 * Maps all tools to Anthropic format
 */
export function mapTools(
  tools: readonly ToolDefinition[],
): AnthropicToolDefinition[] {
  return tools.map(mapTool);
}

/**
 * Maps tool choice to Anthropic format
 */
export function mapToolChoice(
  toolChoice?: 'auto' | 'required' | 'none',
): { type: 'auto' } | { type: 'any' } | undefined {
  if (!toolChoice) return undefined;

  switch (toolChoice) {
    case 'auto':
      return { type: 'auto' };
    case 'required':
      return { type: 'any' };
    case 'none':
      // Anthropic doesn't have a 'none' type, so we don't pass tools
      return undefined;
    default:
      return undefined;
  }
}

/**
 * Rolling breakpoint on the newest message, so each tool round reads the
 * whole conversation so far from cache and only pays for what is new.
 * Empty text blocks can't carry `cache_control`, so those are skipped.
 */
function markLastMessageForCaching(messages: AnthropicMessage[]): void {
  const last = messages.at(-1);
  if (!last) return;
  if (typeof last.content === 'string') {
    if (last.content) {
      last.content = [
        { type: 'text', text: last.content, cache_control: EPHEMERAL },
      ];
    }
    return;
  }
  const block = last.content.at(-1);
  if (!block || (block.type === 'text' && !block.text)) return;
  last.content[last.content.length - 1] = {
    ...block,
    cache_control: EPHEMERAL,
  };
}

// =====================
// Request Mapping
// =====================

/**
 * Maps a normalized model request to Anthropic messages request
 */
export function mapRequest(
  request: ModelRequest,
  options?: {
    defaultMaxTokens?: number;
    defaultTemperature?: number;
    systemInstruction?: string;
    /** Add cache breakpoints on tools, the first system block and the last message. */
    promptCaching?: boolean;
  },
): AnthropicMessagesRequest {
  const promptCaching = options?.promptCaching ?? false;
  const anthropicRequest: AnthropicMessagesRequest = {
    model: request.model,
    messages: mapMessages(request.messages),
    max_tokens: request.maxTokens ?? options?.defaultMaxTokens ?? 4096,
  };

  if (promptCaching && !options?.systemInstruction) {
    // One block per system message so the stable prompt (first) can be
    // cached apart from per-request context that follows it.
    const blocks: AnthropicTextBlock[] = request.messages
      .filter((msg) => msg.role === 'system' && msg.content)
      .map((msg) => ({ type: 'text', text: msg.content }));
    const first = blocks[0];
    if (first) {
      blocks[0] = { ...first, cache_control: EPHEMERAL };
      anthropicRequest.system = blocks;
    }
  } else {
    const systemInstruction =
      options?.systemInstruction ?? extractSystemInstruction(request.messages);
    if (systemInstruction) {
      anthropicRequest.system = systemInstruction;
    }
  }

  if (promptCaching) {
    markLastMessageForCaching(anthropicRequest.messages);
  }

  // Add optional fields
  if (request.temperature !== undefined) {
    anthropicRequest.temperature = request.temperature;
  } else if (options?.defaultTemperature !== undefined) {
    anthropicRequest.temperature = options.defaultTemperature;
  }

  if (request.topP !== undefined) {
    anthropicRequest.top_p = request.topP;
  }

  // Effort only: adaptive thinking needs its signed thinking blocks replayed
  // in tool loops, which this adapter doesn't keep yet.
  const effort = request.reasoningEffort;
  if (
    effort &&
    effort !== 'off' &&
    resolveReasoningSupport(request.model)?.style === 'anthropic-effort'
  ) {
    anthropicRequest.output_config = { effort };
  }

  if (request.stopSequences !== undefined && request.stopSequences.length > 0) {
    anthropicRequest.stop_sequences = [...request.stopSequences];
  }

  if (request.stream !== undefined) {
    anthropicRequest.stream = request.stream;
  }

  // Map tools if present
  if (request.tools && request.tools.length > 0) {
    const tools = mapTools(request.tools);
    const lastTool = tools.at(-1);
    if (promptCaching && lastTool) {
      tools[tools.length - 1] = { ...lastTool, cache_control: EPHEMERAL };
    }
    anthropicRequest.tools = tools;

    const toolChoice = mapToolChoice(request.toolChoice);
    if (toolChoice) {
      anthropicRequest.tool_choice = toolChoice;
    }
  }

  // Pass through metadata
  if (request.metadata) {
    anthropicRequest.metadata = request.metadata;
  }

  return anthropicRequest;
}
