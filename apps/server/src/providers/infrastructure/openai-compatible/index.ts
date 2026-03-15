/**
 * OpenAI-Compatible Provider Adapter
 *
 * This module provides a provider adapter for OpenAI and OpenAI-compatible APIs.
 *
 * @example
 * ```typescript
 * import { createOpenAIProvider, createCompatibleProvider } from './infrastructure/openai-compatible';
 *
 * // Create standard OpenAI provider
 * const openai = createOpenAIProvider(process.env.OPENAI_API_KEY);
 *
 * // Create custom compatible provider
 * const local = createCompatibleProvider('http://localhost:11434/v1', 'local-key');
 *
 * // Register with registry
 * registry.register(openai);
 * registry.register(local);
 * ```
 */

// Adapter implementation
export {
  OpenAICompatibleProvider,
  createOpenAICompatibleProvider,
  createOpenAIProvider,
  createCompatibleProvider,
} from './adapter';

// Request mapping
export { mapMessage, mapMessages, mapTool, mapTools, mapToolChoice, mapRequest } from './request-mapper';

// Response mapping
export {
  mapUsage,
  mapFinishReason,
  mapToolCall,
  mapToolCalls,
  mapResponse,
  mapStreamChunk,
  createToolCallAccumulator,
  updateToolCallAccumulator,
  finalizeToolCalls,
} from './response-mapper';

// Error normalization
export { isOpenAIError, extractErrorMessage, normalizeError } from './error-normalizer';

// Types
export type {
  OpenAIMessageRole,
  OpenAITextContentPart,
  OpenAIMessageContent,
  OpenAIToolCall,
  OpenAIMessage,
  OpenAIToolDefinition,
  OpenAIChatCompletionRequest,
  OpenAIChatCompletionResponse,
  OpenAIStreamChunk,
  OpenAIErrorResponse,
  OpenAIModel,
  OpenAIModelListResponse,
  OpenAICompatibleAdapterConfig,
} from './types';
