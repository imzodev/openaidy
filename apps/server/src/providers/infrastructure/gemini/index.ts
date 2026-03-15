/**
 * Gemini Provider Adapter
 *
 * This module provides a provider adapter for Google Gemini API.
 *
 * @example
 * ```typescript
 * import { createGeminiStudioProvider, createVertexAIGeminiProvider } from './infrastructure/gemini';
 *
 * // Create AI Studio provider
 * const gemini = createGeminiStudioProvider(process.env.GEMINI_API_KEY);
 *
 * // Create Vertex AI provider
 * const vertexai = createVertexAIGeminiProvider(
 *   process.env.GOOGLE_ACCESS_TOKEN,
 *   process.env.GOOGLE_CLOUD_PROJECT
 * );
 *
 * // Register with registry
 * registry.register(gemini);
 * registry.register(vertexai);
 * ```
 */

// Adapter implementation
export {
  GeminiProvider,
  createGeminiProvider,
  createGeminiStudioProvider,
  createVertexAIGeminiProvider,
} from './adapter';

// Request mapping
export {
  mapRole,
  mapMessage,
  mapMessages,
  extractSystemInstruction,
  mapTool,
  mapTools,
  mapToolChoice,
  mapGenerationConfig,
  mapRequest,
} from './request-mapper';

// Response mapping
export {
  isTextPart,
  isFunctionCallPart,
  mapUsage,
  mapFinishReason,
  mapFunctionCall,
  extractToolCalls,
  extractTextContent,
  mapResponse,
  mapStreamChunk,
} from './response-mapper';

// Error normalization
export { isGeminiError, extractErrorMessage, normalizeError } from './error-normalizer';

// Types
export type {
  GeminiTextPart,
  GeminiInlineDataPart,
  GeminiPart,
  GeminiRole,
  GeminiContent,
  GeminiFunctionDeclaration,
  GeminiTool,
  GeminiSafetySetting,
  GeminiGenerationConfig,
  GeminiGenerateContentRequest,
  GeminiCandidate,
  GeminiFunctionCallPart,
  GeminiGenerateContentResponse,
  GeminiStreamChunk,
  GeminiErrorResponse,
  GeminiModel,
  GeminiListModelsResponse,
  GeminiAdapterConfig,
} from './types';
