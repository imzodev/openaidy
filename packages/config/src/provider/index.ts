/**
 * Provider Configuration Module
 *
 * This module exports all provider configuration schemas and utilities
 * for managing provider settings in OpenAidy.
 *
 * @example
 * ```typescript
 * import {
 *   createOpenAIConfig,
 *   createAnthropicConfig,
 *   createGeminiConfig,
 *   createDefaultSecretProvider,
 *   envSecret,
 * } from '@openaidy/config';
 *
 * // Create a secret provider
 * const secretProvider = createDefaultSecretProvider();
 *
 * // Create provider configurations
 * const openaiConfig = createOpenAIConfig({
 *   apiKey: envSecret('OPENAI_API_KEY'),
 * });
 *
 * const anthropicConfig = createAnthropicConfig({
 *   apiKey: envSecret('ANTHROPIC_API_KEY'),
 * });
 *
 * const geminiConfig = createGeminiConfig({
 *   apiKey: envSecret('GOOGLE_API_KEY'),
 * });
 * ```
 */

// Base types and schemas
export {
  // Schemas
  baseProviderConfigSchema,
  resolvedProviderConfigSchema,
  vendorFamilySchema,
  httpTimeoutSchema,
  retrySchema,
  // Types
  type BaseProviderConfig,
  type ResolvedProviderConfig,
  type VendorFamily,
  type HttpTimeout,
  type Retry,
  // Helpers
  isSecretReference,
  getApiKeyLiteral,
  createBaseProviderConfig,
} from './base';

// OpenAI-compatible provider (custom HTTP adapter)
export {
  // Schema
  openaiCompatibleProviderConfigSchema,
  // Type
  type OpenAICompatibleProviderConfig,
  // Model aliases
  OPENAI_MODEL_ALIASES,
  COMPATIBLE_MODEL_ALIASES,
  // Helpers
  createOpenAICompatibleConfig,
  createOpenAIConfig,
  createCompatibleConfig,
  isOpenAICompatibleConfig,
} from './openai-compatible';

// Anthropic provider
export {
  // Schema
  anthropicProviderConfigSchema,
  // Type
  type AnthropicProviderConfig,
  // Model aliases
  ANTHROPIC_MODEL_ALIASES,
  // Types
  type AnthropicModelFamily,
  // Helpers
  createAnthropicConfig,
  isAnthropicConfig,
  getAnthropicModelFamily,
  supportsExtendedThinking,
} from './anthropic';

// Gemini provider
export {
  // Schema
  geminiProviderConfigSchema,
  // Type
  type GeminiProviderConfig,
  // Model aliases
  GEMINI_MODEL_ALIASES,
  GEMINI_EMBEDDING_ALIASES,
  // Types
  type GeminiModelFamily,
  // Helpers
  createGeminiConfig,
  createVertexAIGeminiConfig,
  isGeminiConfig,
  getGeminiModelFamily,
  supportsAudioInput,
  isEmbeddingModel,
} from './gemini';

// Secret handling
export {
  // Schemas
  secretReferenceSchema,
  // Types
  type SecretSourceType,
  type SecretReference,
  type SecretResolutionResult,
  type SecretResolutionError,
  type SecretResolutionErrorCode,
  // Secret provider interface
  type SecretProvider,
  // Implementations
  InlineSecretProvider,
  EnvSecretProvider,
  CompositeSecretProvider,
  // Result helpers
  secretOk,
  secretErr,
  // Reference helpers
  envSecret,
  fileSecret,
  vaultSecret,
  inlineSecret,
  // Factory
  createDefaultSecretProvider,
} from './secrets';

// Re-export union types
import { z } from 'zod';
import { openaiCompatibleProviderConfigSchema } from './openai-compatible';
import { anthropicProviderConfigSchema } from './anthropic';
import { geminiProviderConfigSchema } from './gemini';

/**
 * Union schema for any provider configuration
 */
export const providerConfigSchema = z.discriminatedUnion('vendorFamily', [
  openaiCompatibleProviderConfigSchema,
  anthropicProviderConfigSchema,
  geminiProviderConfigSchema,
]);

/**
 * Any provider configuration type
 */
export type ProviderConfig = z.infer<typeof providerConfigSchema>;

// =====================
// Config Resolution Utilities
// =====================

import type { SecretProvider, SecretResolutionResult } from './secrets';
import type { BaseProviderConfig, ResolvedProviderConfig } from './base';

/**
 * Options for resolving provider configuration
 */
export type ResolveConfigOptions = {
  /** Secret provider to use for resolving secrets */
  secretProvider: SecretProvider;
};

/**
 * Resolve a provider configuration by resolving any secret references
 */
export async function resolveProviderConfig(
  config: BaseProviderConfig,
  options: ResolveConfigOptions,
): Promise<
  SecretResolutionResult | { ok: true; value: ResolvedProviderConfig }
> {
  const { secretProvider } = options;

  // Resolve API key if it's a secret reference
  let resolvedApiKey: string | undefined;
  if (config.apiKey !== undefined) {
    if (typeof config.apiKey === 'string') {
      resolvedApiKey = config.apiKey;
    } else {
      const result = await secretProvider.resolve(config.apiKey);
      if (!result.ok) {
        return result;
      }
      resolvedApiKey = result.value;
    }
  }

  // Build resolved config
  const resolved: ResolvedProviderConfig = {
    id: config.id,
    name: config.name,
    vendorFamily: config.vendorFamily,
    enabled: config.enabled ?? true,
    ...(config.defaultModel !== undefined && {
      defaultModel: config.defaultModel,
    }),
    ...(config.baseUrl !== undefined && { baseUrl: config.baseUrl }),
    ...(resolvedApiKey !== undefined && { apiKey: resolvedApiKey }),
    ...(config.organizationId !== undefined && {
      organizationId: config.organizationId,
    }),
    ...(config.timeout !== undefined && { timeout: config.timeout }),
    ...(config.retry !== undefined && { retry: config.retry }),
    ...(config.headers !== undefined && { headers: config.headers }),
    priority: config.priority ?? 50,
    ...(config.metadata !== undefined && { metadata: config.metadata }),
  };

  return { ok: true, value: resolved };
}

/**
 * Validate a provider configuration
 */
export function validateProviderConfig(
  config: unknown,
): { ok: true; value: ProviderConfig } | { ok: false; error: string } {
  const result = providerConfigSchema.safeParse(config);
  if (result.success) {
    return { ok: true, value: result.data };
  }
  return {
    ok: false,
    error: result.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; '),
  };
}
