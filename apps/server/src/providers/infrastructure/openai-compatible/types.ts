/**
 * OpenAI-Compatible Provider Types
 *
 * Type definitions for the OpenAI-compatible provider adapter.
 */

// =====================
// OpenAI API Types (subset used by adapter)
// =====================

/**
 * OpenAI message role
 */
export type OpenAIMessageRole = 'system' | 'user' | 'assistant' | 'tool';

/**
 * OpenAI message content part (text)
 */
export type OpenAITextContentPart = {
  type: 'text';
  text: string;
};

/**
 * OpenAI message content part (image, as a data: or https: URL)
 */
export type OpenAIImageContentPart = {
  type: 'image_url';
  image_url: {
    url: string;
  };
};

/**
 * OpenAI message content part (audio input)
 */
export type OpenAIAudioContentPart = {
  type: 'input_audio';
  input_audio: {
    data: string;
    format: string;
  };
};

/**
 * OpenAI message content part union
 */
export type OpenAIContentPart =
  | OpenAITextContentPart
  | OpenAIImageContentPart
  | OpenAIAudioContentPart;

/**
 * OpenAI message content (can be string or array of parts)
 */
export type OpenAIMessageContent = string | OpenAIContentPart[];

/**
 * OpenAI tool call
 */
export type OpenAIToolCall = {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
};

/**
 * OpenAI message
 */
export type OpenAIMessage = {
  role: OpenAIMessageRole;
  content: OpenAIMessageContent | null;
  name?: string;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
};

/**
 * OpenAI tool definition
 */
export type OpenAIToolDefinition = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

/**
 * OpenAI chat completion request
 */
export type OpenAIChatCompletionRequest = {
  model: string;
  messages: OpenAIMessage[];
  tools?: OpenAIToolDefinition[];
  tool_choice?:
    | 'auto'
    | 'required'
    | 'none'
    | { type: 'function'; function: { name: string } };
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string | string[];
  stream?: boolean;
  stream_options?: { include_usage?: boolean };
  metadata?: Record<string, unknown>;
};

/**
 * OpenAI chat completion response
 */
export type OpenAIChatCompletionResponse = {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: 'assistant';
      content: string | null;
      tool_calls?: OpenAIToolCall[];
    };
    finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
};

/**
 * OpenAI streaming chunk
 */
export type OpenAIStreamChunk = {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: 'assistant';
      content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: 'function';
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
};

/**
 * OpenAI error response
 */
export type OpenAIErrorResponse = {
  error: {
    message: string;
    type: string;
    param?: string | null;
    code?: string | null;
  };
};

/**
 * OpenAI model
 */
export type OpenAIModel = {
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
};

/**
 * OpenAI model list response
 */
export type OpenAIModelListResponse = {
  object: 'list';
  data: OpenAIModel[];
};

// =====================
// Adapter Configuration
// =====================

/**
 * OpenAI-compatible adapter configuration
 */
export type OpenAICompatibleAdapterConfig = {
  /** API key for authentication */
  apiKey: string;
  /** Base URL for API requests */
  baseUrl?: string;
  /** Default model to use */
  defaultModel?: string;
  /** Organization ID (optional) */
  organizationId?: string;
  /** Custom headers to include with requests */
  headers?: Record<string, string>;
  /** Request timeout in milliseconds */
  timeoutMs?: number;
  /** Enable streaming support */
  enableStreaming?: boolean;
  /** Enable tool/function calling */
  enableTools?: boolean;
  /** Provider ID override */
  providerId?: string;
  /** Provider name override */
  providerName?: string;
  /**
   * Optional callback that returns the current credential (e.g. an
   * OAuth access token) for the provider. When supplied, this is
   * consulted on every outgoing request so freshly-persisted
   * credentials are picked up without restarting the server. The
   * returned value overrides the `apiKey` field for the
   * `Authorization: Bearer …` header.
   */
  credentialProvider?: (providerId: string) => Promise<string | null>;
};
