/**
 * Anthropic Provider Configuration
 *
 * Configuration schema for Anthropic Claude API provider.
 */

import { z } from 'zod';
import { baseProviderConfigSchema, type BaseProviderConfig } from './base';

// =====================
// Anthropic Config Schema
// =====================

/**
 * Anthropic provider configuration schema
 */
export const anthropicProviderConfigSchema = baseProviderConfigSchema.extend({
  vendorFamily: z.literal('anthropic'),

  /** Base URL for Anthropic API */
  baseUrl: z
    .string()
    .url()
    .optional()
    .default('https://api.anthropic.com/v1'),

  /** Anthropic API version */
  apiVersion: z.string().optional().default('2023-06-01'),

  /** Default model for completions */
  defaultModel: z.string().optional().default('claude-sonnet-4-20250514'),

  /** Model to use for messages */
  messagesModel: z.string().optional(),

  /** Beta features to enable */
  betas: z.array(z.string()).optional(),

  /** Enable extended thinking (for supported models) */
  enableExtendedThinking: z.boolean().optional().default(false),

  /** Maximum thinking budget in tokens */
  maxThinkingTokens: z.number().int().positive().optional(),

  /** Enable tool use */
  enableTools: z.boolean().optional().default(true),

  /** Enable vision capabilities */
  enableVision: z.boolean().optional().default(true),

  /** Enable streaming responses */
  enableStreaming: z.boolean().optional().default(true),

  /** Default max tokens for completions (required by Anthropic API) */
  defaultMaxTokens: z.number().int().positive().optional().default(4096),

  /** Default temperature for completions */
  defaultTemperature: z.number().min(0).max(1).optional().default(0.7),

  /** System prompt to prepend to all messages */
  systemPrompt: z.string().optional(),
});

/**
 * Anthropic provider configuration type
 */
export type AnthropicProviderConfig = z.infer<typeof anthropicProviderConfigSchema>;

// =====================
// Model Aliases
// =====================

/**
 * Anthropic Claude model aliases
 */
export const ANTHROPIC_MODEL_ALIASES = {
  'claude-opus-4-20250514': 'claude-opus-4-20250514',
  'claude-opus-4': 'claude-opus-4-20250514',
  'claude-sonnet-4-20250514': 'claude-sonnet-4-20250514',
  'claude-sonnet-4': 'claude-sonnet-4-20250514',
  'claude-3-5-sonnet-20241022': 'claude-3-5-sonnet-20241022',
  'claude-3-5-sonnet': 'claude-3-5-sonnet-20241022',
  'claude-3-5-haiku-20241022': 'claude-3-5-haiku-20241022',
  'claude-3-5-haiku': 'claude-3-5-haiku-20241022',
  'claude-3-opus-20240229': 'claude-3-opus-20240229',
  'claude-3-opus': 'claude-3-opus-20240229',
  'claude-3-sonnet-20240229': 'claude-3-sonnet-20240229',
  'claude-3-sonnet': 'claude-3-sonnet-20240229',
  'claude-3-haiku-20240307': 'claude-3-haiku-20240307',
  'claude-3-haiku': 'claude-3-haiku-20240307',
} as const;

/**
 * Model family types for Anthropic
 */
export type AnthropicModelFamily = 'claude-4' | 'claude-3.5' | 'claude-3';

/**
 * Get the model family for a given model ID
 */
export function getAnthropicModelFamily(
  modelId: string
): AnthropicModelFamily | null {
  if (modelId.startsWith('claude-opus-4') || modelId.startsWith('claude-sonnet-4')) {
    return 'claude-4';
  }
  if (modelId.includes('3-5') || modelId.includes('3.5')) {
    return 'claude-3.5';
  }
  if (modelId.startsWith('claude-3')) {
    return 'claude-3';
  }
  return null;
}

// =====================
// Helper Functions
// =====================

/**
 * Create an Anthropic provider configuration
 */
export function createAnthropicConfig(
  partial: Partial<AnthropicProviderConfig> & {
    id?: string;
    apiKey: AnthropicProviderConfig['apiKey'];
  }
): AnthropicProviderConfig {
  return anthropicProviderConfigSchema.parse({
    id: 'anthropic',
    name: 'Anthropic',
    vendorFamily: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    apiVersion: '2023-06-01',
    defaultModel: 'claude-sonnet-4-20250514',
    enableTools: true,
    enableVision: true,
    enableStreaming: true,
    defaultMaxTokens: 4096,
    ...partial,
  });
}

/**
 * Check if a config is an Anthropic config
 */
export function isAnthropicConfig(
  config: BaseProviderConfig
): config is AnthropicProviderConfig {
  return config.vendorFamily === 'anthropic';
}

/**
 * Check if a model supports extended thinking
 */
export function supportsExtendedThinking(modelId: string): boolean {
  const family = getAnthropicModelFamily(modelId);
  return family === 'claude-4';
}
