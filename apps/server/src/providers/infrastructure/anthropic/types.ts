/**
 * Anthropic Provider Types
 *
 * Type definitions for the Anthropic provider adapter.
 */

// =====================
// Anthropic API Types
// =====================

/**
 * Anthropic message role
 */
export type AnthropicMessageRole = 'user' | 'assistant';

/**
 * Anthropic content block types
 */
export type AnthropicTextBlock = {
  type: 'text';
  text: string;
};

export type AnthropicImageBlock = {
  type: 'image';
  source: {
    type: 'base64';
    media_type: string;
    data: string;
  };
};

export type AnthropicToolUseBlock = {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type AnthropicToolResultBlock = {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
};

/**
 * Anthropic content block union
 */
export type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicImageBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock;

/**
 * Anthropic message
 */
export type AnthropicMessage = {
  role: AnthropicMessageRole;
  content: string | AnthropicContentBlock[];
};

/**
 * Anthropic tool definition
 */
export type AnthropicToolDefinition = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

/**
 * Anthropic messages API request
 */
export type AnthropicMessagesRequest = {
  model: string;
  messages: AnthropicMessage[];
  system?: string;
  max_tokens: number;
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
  tools?: AnthropicToolDefinition[];
  tool_choice?:
    | { type: 'auto' }
    | { type: 'any' }
    | { type: 'tool'; name: string };
  stream?: boolean;
  metadata?: Record<string, unknown>;
};

/**
 * Anthropic messages API response
 */
export type AnthropicMessagesResponse = {
  id: string;
  type: 'message';
  role: 'assistant';
  content: AnthropicContentBlock[];
  model: string;
  stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | null;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
};

/**
 * Anthropic streaming event types
 */
export type AnthropicStreamEvent =
  | { type: 'message_start'; message: AnthropicMessagesResponse }
  | {
      type: 'content_block_start';
      index: number;
      content_block: AnthropicContentBlock;
    }
  | {
      type: 'content_block_delta';
      index: number;
      delta:
        | { type: 'text_delta'; text: string }
        | { type: 'input_json_delta'; partial_json: string };
    }
  | { type: 'content_block_stop'; index: number }
  | {
      type: 'message_delta';
      delta: { stop_reason: string; stop_sequence: string | null };
      usage: { output_tokens: number };
    }
  | { type: 'message_stop' }
  | { type: 'ping' }
  | { type: 'error'; error: AnthropicErrorResponse['error'] };

/**
 * Anthropic error response
 */
export type AnthropicErrorResponse = {
  error: {
    type: string;
    message: string;
  };
};

/**
 * Anthropic model info
 */
export type AnthropicModel = {
  id: string;
  type: 'model';
  display_name: string;
};

/**
 * Anthropic models list response
 */
export type AnthropicModelsListResponse = {
  data: AnthropicModel[];
  has_more: boolean;
};

// =====================
// Adapter Configuration
// =====================

/**
 * Anthropic adapter configuration
 */
export type AnthropicAdapterConfig = {
  /** API key for authentication */
  apiKey: string;
  /** Base URL for Anthropic API */
  baseUrl?: string;
  /** Anthropic API version header */
  apiVersion?: string;
  /** Default model to use */
  defaultModel?: string;
  /** Request timeout in milliseconds */
  timeoutMs?: number;
  /** Enable streaming support */
  enableStreaming?: boolean;
  /** Enable tool/function calling */
  enableTools?: boolean;
  /** Enable vision capabilities */
  enableVision?: boolean;
  /** Provider ID override */
  providerId?: string;
  /** Provider name override */
  providerName?: string;
  /** Default max tokens (required by Anthropic) */
  defaultMaxTokens?: number;
  /** Default temperature */
  defaultTemperature?: number;
  /** Beta features to enable */
  betas?: string[];
  /** Custom headers */
  headers?: Record<string, string>;
};
