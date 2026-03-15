/**
 * OpenAI-Compatible Provider Configuration
 *
 * Configuration schema for providers that use the OpenAI-compatible API format.
 * This includes OpenAI itself and many compatible providers/gateways.
 */

import { z } from 'zod';
import {
  baseProviderConfigSchema,
  type BaseProviderConfig,
} from './base';

// =====================
// OpenAI-Compatible Config Schema
// =====================

/**
 * OpenAI-compatible provider configuration schema
 */
export const openaiCompatibleProviderConfigSchema = baseProviderConfigSchema.extend({
  vendorFamily: z.literal('openai-compatible'),

  /** Default base URL for OpenAI API */
  baseUrl: z.string().url().optional().default('https://api.openai.com/v1'),

  /** Model to use for chat completions */
  chatModel: z.string().optional(),

  /** Model to use for embeddings */
  embeddingModel: z.string().optional(),

  /** Model to use for audio transcription */
  audioModel: z.string().optional(),

  /** Model to use for image generation */
  imageModel: z.string().optional(),

  /** Whether to use the Responses API format (newer) or Chat Completions API */
  useResponsesApi: z.boolean().optional().default(false),

  /** Enable function calling / tool use */
  enableTools: z.boolean().optional().default(true),

  /** Enable vision capabilities */
  enableVision: z.boolean().optional().default(false),

  /** Enable streaming responses */
  enableStreaming: z.boolean().optional().default(true),

  /** Default temperature for completions */
  defaultTemperature: z.number().min(0).max(2).optional().default(0.7),

  /** Default max tokens for completions */
  defaultMaxTokens: z.number().int().positive().optional().default(4096),
});

/**
 * OpenAI-compatible provider configuration type
 */
export type OpenAICompatibleProviderConfig = z.infer<
  typeof openaiCompatibleProviderConfigSchema
>;

// =====================
// Model Aliases
// =====================

/**
 * Common OpenAI model aliases
 */
export const OPENAI_MODEL_ALIASES = {
  'gpt-4': 'gpt-4',
  'gpt-4-turbo': 'gpt-4-turbo',
  'gpt-4o': 'gpt-4o',
  'gpt-4o-mini': 'gpt-4o-mini',
  'gpt-3.5-turbo': 'gpt-3.5-turbo',
  'o1': 'o1',
  'o1-mini': 'o1-mini',
  'o1-preview': 'o1-preview',
  'text-embedding-3-small': 'text-embedding-3-small',
  'text-embedding-3-large': 'text-embedding-3-large',
  'whisper-1': 'whisper-1',
  'dall-e-3': 'dall-e-3',
} as const;

/**
 * Common compatible provider model aliases (non-OpenAI)
 */
export const COMPATIBLE_MODEL_ALIASES = {
  // DeepSeek
  'deepseek-chat': 'deepseek-chat',
  'deepseek-coder': 'deepseek-coder',
  // Groq
  'llama-3.1-70b-versatile': 'llama-3.1-70b-versatile',
  'mixtral-8x7b-32768': 'mixtral-8x7b-32768',
  // Together AI
  'meta-llama/Llama-3-70b-chat-hf': 'meta-llama/Llama-3-70b-chat-hf',
  // Other
  'local-model': 'local-model',
} as const;

// =====================
// Helper Functions
// =====================

/**
 * Create an OpenAI-compatible provider configuration
 */
export function createOpenAICompatibleConfig(
  partial: Partial<OpenAICompatibleProviderConfig> & {
    id: string;
    name: string;
    apiKey: OpenAICompatibleProviderConfig['apiKey'];
  }
): OpenAICompatibleProviderConfig {
  return openaiCompatibleProviderConfigSchema.parse({
    vendorFamily: 'openai-compatible',
    ...partial,
  });
}

/**
 * Create a standard OpenAI provider configuration
 */
export function createOpenAIConfig(
  partial: Partial<OpenAICompatibleProviderConfig> & {
    id?: string;
    apiKey: OpenAICompatibleProviderConfig['apiKey'];
  }
): OpenAICompatibleProviderConfig {
  return openaiCompatibleProviderConfigSchema.parse({
    id: 'openai',
    name: 'OpenAI',
    vendorFamily: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
    chatModel: 'gpt-4o',
    embeddingModel: 'text-embedding-3-small',
    enableTools: true,
    enableVision: true,
    enableStreaming: true,
    ...partial,
  });
}

/**
 * Create a local/compatible provider configuration
 */
export function createCompatibleConfig(
  baseUrl: string,
  partial: Partial<OpenAICompatibleProviderConfig> & {
    id: string;
    name: string;
  }
): OpenAICompatibleProviderConfig {
  return openaiCompatibleProviderConfigSchema.parse({
    vendorFamily: 'openai-compatible',
    baseUrl,
    enableTools: true,
    enableVision: false,
    enableStreaming: true,
    ...partial,
  });
}

/**
 * Check if a config is an OpenAI-compatible config
 */
export function isOpenAICompatibleConfig(
  config: BaseProviderConfig
): config is OpenAICompatibleProviderConfig {
  return config.vendorFamily === 'openai-compatible';
}
