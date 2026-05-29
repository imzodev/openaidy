import type { Message, ToolCallRequest } from '../messages';
import type { ToolDefinition } from '../tools';
import type { ProviderError } from '../errors';

/**
 * Provider capability flags
 */
export type ProviderCapability =
  | 'text_generation'
  | 'streaming'
  | 'tool_calls'
  | 'vision'
  | 'audio_input'
  | 'audio_output'
  | 'embedding';

/**
 * Provider descriptor - identifies and describes a provider
 */
export type ProviderDescriptor = {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly capabilities: readonly ProviderCapability[];
  readonly vendorFamily: string; // e.g., 'openai-compatible', 'anthropic', 'gemini'
};

/**
 * Model descriptor - describes a specific model within a provider
 */
export type ModelDescriptor = {
  readonly id: string;
  readonly providerId: string;
  readonly name: string;
  readonly description?: string;
  readonly capabilities: readonly ProviderCapability[];
  readonly contextWindow?: number;
  readonly maxOutputTokens?: number;
};

/**
 * Usage information returned after model invocation
 */
export type UsageInfo = {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
};

/**
 * Finish reason for model response
 */
export type FinishReason =
  | 'stop'
  | 'length'
  | 'tool_calls'
  | 'content_filter'
  | 'error';

/**
 * Normalized model request shape
 */
export type ModelRequest = {
  readonly model: string;
  readonly messages: readonly Message[];
  readonly tools?: readonly ToolDefinition[];
  readonly toolChoice?: 'auto' | 'required' | 'none';
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly topP?: number;
  readonly stopSequences?: readonly string[];
  readonly stream?: boolean;
  readonly metadata?: Record<string, unknown>;
};

/**
 * Normalized model response shape (non-streaming)
 */
export type ModelResponse = {
  readonly id: string;
  readonly model: string;
  readonly providerId: string;
  readonly content: string;
  readonly toolCalls?: readonly ToolCallRequest[];
  readonly reasoningContent?: string;
  readonly usage: UsageInfo;
  readonly finishReason: FinishReason;
  readonly created: string; // ISO timestamp
};

/**
 * Stream event types
 */
export type ModelStreamEventType =
  | 'stream.started'
  | 'stream.content_delta'
  | 'stream.tool_call'
  | 'stream.usage'
  | 'stream.finished'
  | 'stream.error';

/**
 * Base stream event
 */
export type BaseStreamEvent<TType extends ModelStreamEventType> = {
  readonly type: TType;
  readonly timestamp: string;
};

/**
 * Stream started event
 */
export type StreamStartedEvent = BaseStreamEvent<'stream.started'> & {
  readonly id: string;
  readonly model: string;
  readonly providerId: string;
};

/**
 * Content delta event
 */
export type StreamContentDeltaEvent =
  BaseStreamEvent<'stream.content_delta'> & {
    readonly id: string;
    readonly delta: string;
  };

/**
 * Tool call event (during streaming)
 */
export type StreamToolCallEvent = BaseStreamEvent<'stream.tool_call'> & {
  readonly id: string;
  readonly toolCall: ToolCallRequest;
};

/**
 * Usage event (may come at end of stream)
 */
export type StreamUsageEvent = BaseStreamEvent<'stream.usage'> & {
  readonly id: string;
  readonly usage: UsageInfo;
};

/**
 * Stream finished event
 */
export type StreamFinishedEvent = BaseStreamEvent<'stream.finished'> & {
  readonly id: string;
  readonly finishReason: FinishReason;
  readonly reasoningContent?: string;
};

/**
 * Stream error event
 */
export type StreamErrorEvent = BaseStreamEvent<'stream.error'> & {
  readonly id: string;
  readonly error: ProviderError;
};

/**
 * Union of all stream event types
 */
export type ModelStreamEvent =
  | StreamStartedEvent
  | StreamContentDeltaEvent
  | StreamToolCallEvent
  | StreamUsageEvent
  | StreamFinishedEvent
  | StreamErrorEvent;

/**
 * Type guards for stream events
 */
export function isStreamStartedEvent(
  event: ModelStreamEvent,
): event is StreamStartedEvent {
  return event.type === 'stream.started';
}

export function isStreamContentDeltaEvent(
  event: ModelStreamEvent,
): event is StreamContentDeltaEvent {
  return event.type === 'stream.content_delta';
}

export function isStreamToolCallEvent(
  event: ModelStreamEvent,
): event is StreamToolCallEvent {
  return event.type === 'stream.tool_call';
}

export function isStreamUsageEvent(
  event: ModelStreamEvent,
): event is StreamUsageEvent {
  return event.type === 'stream.usage';
}

export function isStreamFinishedEvent(
  event: ModelStreamEvent,
): event is StreamFinishedEvent {
  return event.type === 'stream.finished';
}

export function isStreamErrorEvent(
  event: ModelStreamEvent,
): event is StreamErrorEvent {
  return event.type === 'stream.error';
}

/**
 * Provider invocation result (either success or error)
 */
export type ProviderResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ProviderError };

/**
 * Model provider interface - all adapters must implement this
 */
export interface ModelProvider {
  /**
   * Returns the provider descriptor
   */
  readonly descriptor: ProviderDescriptor;

  /**
   * Lists available models for this provider
   */
  listModels(): Promise<ProviderResult<readonly ModelDescriptor[]>>;

  /**
   * Returns a specific model descriptor
   */
  getModel(modelId: string): Promise<ProviderResult<ModelDescriptor>>;

  /**
   * Check if a capability is supported
   */
  hasCapability(capability: ProviderCapability): boolean;

  /**
   * Invoke the model (non-streaming)
   */
  invoke(request: ModelRequest): Promise<ProviderResult<ModelResponse>>;

  /**
   * Invoke the model (streaming)
   * Returns an async iterable of stream events
   */
  invokeStream(
    request: ModelRequest,
  ): AsyncIterable<ProviderResult<ModelStreamEvent>>;
}

/**
 * Helper to create a successful result
 */
export function ok<T>(value: T): ProviderResult<T> {
  return { ok: true, value };
}

/**
 * Helper to create an error result
 */
export function err<T>(error: ProviderError): ProviderResult<T> {
  return { ok: false, error };
}
