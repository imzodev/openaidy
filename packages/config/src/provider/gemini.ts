/**
 * Gemini Provider Configuration
 *
 * Configuration schema for Google Gemini API provider.
 */

import { z } from 'zod';
import { baseProviderConfigSchema, type BaseProviderConfig } from './base';

// =====================
// Gemini Config Schema
// =====================

/**
 * Gemini provider configuration schema
 */
export const geminiProviderConfigSchema = baseProviderConfigSchema.extend({
  vendorFamily: z.literal('gemini'),

  /** Base URL for Gemini API */
  baseUrl: z
    .string()
    .url()
    .optional()
    .default('https://generativelanguage.googleapis.com/v1beta'),

  /** Google Cloud project ID (optional, for Vertex AI) */
  projectId: z.string().optional(),

  /** Google Cloud region (for Vertex AI) */
  region: z.string().optional().default('us-central1'),

  /** Use Vertex AI instead of AI Studio */
  useVertexAI: z.boolean().optional().default(false),

  /** Default model for generation */
  defaultModel: z.string().optional().default('gemini-2.0-flash'),

  /** Model to use for embeddings */
  embeddingModel: z.string().optional().default('text-embedding-004'),

  /** Safety settings */
  safetySettings: z
    .array(
      z.object({
        category: z.enum([
          'HARM_CATEGORY_HARASSMENT',
          'HARM_CATEGORY_HATE_SPEECH',
          'HARM_CATEGORY_SEXUALLY_EXPLICIT',
          'HARM_CATEGORY_DANGEROUS_CONTENT',
          'HARM_CATEGORY_CIVIC_INTEGRITY',
        ]),
        threshold: z.enum([
          'BLOCK_NONE',
          'BLOCK_LOW_AND_ABOVE',
          'BLOCK_MEDIUM_AND_ABOVE',
          'BLOCK_ONLY_HIGH',
        ]),
      })
    )
    .optional(),

  /** Generation config */
  generationConfig: z
    .object({
      temperature: z.number().min(0).max(2).optional(),
      topP: z.number().min(0).max(1).optional(),
      topK: z.number().int().positive().optional(),
      candidateCount: z.number().int().min(1).max(8).optional(),
      maxOutputTokens: z.number().int().positive().optional(),
      stopSequences: z.array(z.string()).optional(),
      responseMimeType: z.enum(['text/plain', 'application/json']).optional(),
    })
    .optional(),

  /** Enable tool/function calling */
  enableTools: z.boolean().optional().default(true),

  /** Enable vision capabilities */
  enableVision: z.boolean().optional().default(true),

  /** Enable audio input */
  enableAudioInput: z.boolean().optional().default(true),

  /** Enable streaming responses */
  enableStreaming: z.boolean().optional().default(true),

  /** Default temperature for completions */
  defaultTemperature: z.number().min(0).max(2).optional().default(0.7),

  /** Default max tokens for completions */
  defaultMaxTokens: z.number().int().positive().optional().default(8192),

  /** System instruction to prepend to all messages */
  systemInstruction: z.string().optional(),
});

/**
 * Gemini provider configuration type
 */
export type GeminiProviderConfig = z.infer<typeof geminiProviderConfigSchema>;

// =====================
// Model Aliases
// =====================

/**
 * Google Gemini model aliases
 */
export const GEMINI_MODEL_ALIASES = {
  'gemini-2.5-pro-preview-06-05': 'gemini-2.5-pro-preview-06-05',
  'gemini-2.5-pro': 'gemini-2.5-pro-preview-06-05',
  'gemini-2.0-flash': 'gemini-2.0-flash',
  'gemini-2.0-flash-lite': 'gemini-2.0-flash-lite',
  'gemini-1.5-pro': 'gemini-1.5-pro',
  'gemini-1.5-flash': 'gemini-1.5-flash',
  'gemini-1.5-flash-8b': 'gemini-1.5-flash-8b',
  'gemini-1.0-pro': 'gemini-1.0-pro',
  'text-embedding-004': 'text-embedding-004',
  'text-embedding-005': 'text-embedding-005',
} as const;

/**
 * Embedding model aliases
 */
export const GEMINI_EMBEDDING_ALIASES = {
  'text-embedding-004': 'text-embedding-004',
  'text-embedding-005': 'text-embedding-005',
  'text-multilingual-embedding-002': 'text-multilingual-embedding-002',
} as const;

/**
 * Model family types for Gemini
 */
export type GeminiModelFamily = 'gemini-2.5' | 'gemini-2.0' | 'gemini-1.5' | 'gemini-1.0';

/**
 * Get the model family for a given model ID
 */
export function getGeminiModelFamily(modelId: string): GeminiModelFamily | null {
  if (modelId.startsWith('gemini-2.5') || modelId.includes('2.5')) {
    return 'gemini-2.5';
  }
  if (modelId.startsWith('gemini-2.0') || modelId.includes('2.0-flash')) {
    return 'gemini-2.0';
  }
  if (modelId.startsWith('gemini-1.5') || modelId.includes('1.5')) {
    return 'gemini-1.5';
  }
  if (modelId.startsWith('gemini-1.0') || modelId === 'gemini-pro') {
    return 'gemini-1.0';
  }
  return null;
}

// =====================
// Helper Functions
// =====================

/**
 * Create a Gemini provider configuration (AI Studio)
 */
export function createGeminiConfig(
  partial: Partial<GeminiProviderConfig> & {
    id?: string;
    apiKey: GeminiProviderConfig['apiKey'];
  }
): GeminiProviderConfig {
  return geminiProviderConfigSchema.parse({
    id: 'gemini',
    name: 'Google Gemini',
    vendorFamily: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    useVertexAI: false,
    defaultModel: 'gemini-2.0-flash',
    embeddingModel: 'text-embedding-004',
    enableTools: true,
    enableVision: true,
    enableAudioInput: true,
    enableStreaming: true,
    defaultMaxTokens: 8192,
    ...partial,
  });
}

/**
 * Create a Vertex AI Gemini provider configuration
 */
export function createVertexAIGeminiConfig(
  partial: Partial<GeminiProviderConfig> & {
    id?: string;
    projectId: string;
    apiKey: GeminiProviderConfig['apiKey'];
  }
): GeminiProviderConfig {
  return geminiProviderConfigSchema.parse({
    id: 'vertexai-gemini',
    name: 'Vertex AI Gemini',
    vendorFamily: 'gemini',
    useVertexAI: true,
    region: 'us-central1',
    defaultModel: 'gemini-2.0-flash',
    embeddingModel: 'text-embedding-004',
    enableTools: true,
    enableVision: true,
    enableAudioInput: true,
    enableStreaming: true,
    defaultMaxTokens: 8192,
    ...partial,
  });
}

/**
 * Check if a config is a Gemini config
 */
export function isGeminiConfig(
  config: BaseProviderConfig
): config is GeminiProviderConfig {
  return config.vendorFamily === 'gemini';
}

/**
 * Check if a model supports audio input
 */
export function supportsAudioInput(modelId: string): boolean {
  const family = getGeminiModelFamily(modelId);
  return family !== null && family !== 'gemini-1.0';
}

/**
 * Check if a model is an embedding model
 */
export function isEmbeddingModel(modelId: string): boolean {
  return modelId.includes('embedding');
}
