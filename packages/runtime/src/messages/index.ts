/**
 * Message role types - vendor-neutral
 */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/**
 * Base message shape
 */
export type BaseMessage = {
  readonly role: MessageRole;
  readonly content: string;
};

/**
 * System message
 */
export type SystemMessage = BaseMessage & {
  readonly role: 'system';
};

/**
 * Inline media attachment on a user message — bytes are carried as base64
 * so the per-vendor request mappers can emit provider-specific content
 * blocks (Anthropic `image`, OpenAI `image_url`/`input_audio`, Gemini
 * `inlineData`) without touching disk.
 */
export type MessageAttachment = {
  readonly kind: 'image' | 'audio';
  readonly mimeType: string;
  /** Base64-encoded bytes (no data: URI prefix) */
  readonly data: string;
  readonly name?: string;
};

/**
 * User message
 */
export type UserMessage = BaseMessage & {
  readonly role: 'user';
  /** Inline image/audio media to send alongside the text content */
  readonly attachments?: readonly MessageAttachment[];
};

/**
 * Assistant message (may include tool calls and reasoning content)
 */
export type AssistantMessage = BaseMessage & {
  readonly role: 'assistant';
  readonly toolCalls?: readonly ToolCallRequest[];
  readonly reasoningContent?: string;
};

/**
 * Tool result message
 */
export type ToolResultMessage = {
  readonly role: 'tool';
  readonly toolCallId: string;
  readonly content: string;
  readonly isError?: boolean;
};

/**
 * Union of all message types
 */
export type Message =
  | SystemMessage
  | UserMessage
  | AssistantMessage
  | ToolResultMessage;

/**
 * Type guard for system message
 */
export function isSystemMessage(message: Message): message is SystemMessage {
  return message.role === 'system';
}

/**
 * Type guard for user message
 */
export function isUserMessage(message: Message): message is UserMessage {
  return message.role === 'user';
}

/**
 * Type guard for assistant message
 */
export function isAssistantMessage(
  message: Message,
): message is AssistantMessage {
  return message.role === 'assistant';
}

/**
 * Type guard for tool result message
 */
export function isToolResultMessage(
  message: Message,
): message is ToolResultMessage {
  return message.role === 'tool';
}

/**
 * Tool call request shape (from assistant to tool)
 */
export type ToolCallRequest = {
  readonly id: string;
  readonly name: string;
  readonly arguments: string; // JSON string
  /**
   * Gemini-specific opaque thought-signature token returned by the
   * model on the original functionCall part. The Gemini API
   * *requires* a thought signature on at least the first
   * functionCall part of a multi-function-call assistant turn when
   * that turn is replayed in a follow-up request — see
   * https://ai.google.dev/gemini-api/docs/thought-signatures.
   * Other providers (OpenAI, Anthropic, etc.) ignore this field.
   */
  readonly thoughtSignature?: string;
};
