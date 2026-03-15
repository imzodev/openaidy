/**
 * Anthropic Provider Adapter
 *
 * This module provides a provider adapter for Anthropic Claude API.
 *
 * @example
 * ```typescript
 * import { createClaudeProvider, createAnthropicProvider } from './infrastructure/anthropic';
 *
 * // Create standard Anthropic provider
 * const claude = createClaudeProvider(process.env.ANTHROPIC_API_KEY);
 *
 * // Create custom Anthropic provider
 * const custom = createAnthropicProvider({
 *   apiKey: process.env.ANTHROPIC_API_KEY,
 *   defaultModel: 'claude-opus-4-20250514',
 * });
 *
 * // Register with registry
 * registry.register(claude);
 * ```
 */

// Adapter implementation
export {
  AnthropicProvider,
  createAnthropicProvider,
  createClaudeProvider,
  createClaudeModelProvider,
} from './adapter';

// Request mapping
export {
  mapMessage,
  mapMessages,
  extractSystemInstruction,
  mapTool,
  mapTools,
  mapToolChoice,
  mapRequest,
} from './request-mapper';

// Response mapping
export {
  isTextBlock,
  isToolUseBlock,
  mapUsage,
  mapStopReason,
  mapToolUse,
  extractToolCalls,
  extractTextContent,
  mapResponse,
  createToolCallAccumulator,
  updateToolCallAccumulator,
  finalizeToolCalls,
  mapStreamEvent,
  extractStopReasonFromDelta,
} from './response-mapper';

// Error normalization
export { isAnthropicError, extractErrorMessage, normalizeError } from './error-normalizer';

// Types
export type {
  AnthropicMessageRole,
  AnthropicTextBlock,
  AnthropicImageBlock,
  AnthropicToolUseBlock,
  AnthropicToolResultBlock,
  AnthropicContentBlock,
  AnthropicMessage,
  AnthropicToolDefinition,
  AnthropicMessagesRequest,
  AnthropicMessagesResponse,
  AnthropicStreamEvent,
  AnthropicErrorResponse,
  AnthropicModel,
  AnthropicModelsListResponse,
  AnthropicAdapterConfig,
} from './types';
