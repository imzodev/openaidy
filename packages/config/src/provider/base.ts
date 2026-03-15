/**
 * Base Provider Configuration
 *
 * This module defines the common configuration schema that all providers share.
 * Provider-specific configurations extend this base schema.
 */

import { z } from 'zod';
import { secretReferenceSchema, type SecretReference } from './secrets';

// =====================
// Provider Type Identifiers
// =====================

/**
 * Supported vendor families / adapter types
 */
export const vendorFamilySchema = z.enum([
  'openai-compatible',
  'anthropic',
  'gemini',
]);

/**
 * Vendor family type
 */
export type VendorFamily = z.infer<typeof vendorFamilySchema>;

// =====================
// Common Configuration Options
// =====================

/**
 * HTTP timeout configuration
 */
export const httpTimeoutSchema = z.object({
  /** Connection timeout in milliseconds */
  connectMs: z.number().positive().optional().default(5000),
  /** Request timeout in milliseconds */
  requestMs: z.number().positive().optional().default(60000),
  /** Read timeout in milliseconds */
  readMs: z.number().positive().optional().default(30000),
});

export type HttpTimeout = z.infer<typeof httpTimeoutSchema>;

/**
 * Retry configuration
 */
export const retrySchema = z.object({
  /** Maximum number of retry attempts */
  maxAttempts: z.number().int().min(0).max(10).optional().default(3),
  /** Base delay between retries in milliseconds */
  baseDelayMs: z.number().positive().optional().default(1000),
  /** Maximum delay between retries in milliseconds */
  maxDelayMs: z.number().positive().optional().default(30000),
  /** Whether to use exponential backoff */
  exponentialBackoff: z.boolean().optional().default(true),
  /** HTTP status codes that should trigger a retry */
  retryOnStatus: z.array(z.number()).optional().default([429, 500, 502, 503, 504]),
});

export type Retry = z.infer<typeof retrySchema>;

// =====================
// Base Provider Config Schema
// =====================

/**
 * Base provider configuration schema
 *
 * All provider-specific configs should extend this schema.
 */
export const baseProviderConfigSchema = z.object({
  /** Unique identifier for this provider configuration */
  id: z.string().min(1),

  /** Human-readable name for this provider */
  name: z.string().min(1),

  /** Vendor family / adapter type */
  vendorFamily: vendorFamilySchema,

  /** Whether this provider is enabled */
  enabled: z.boolean().optional().default(true),

  /** Default model to use when no model is specified */
  defaultModel: z.string().optional(),

  /** Base URL for API requests (provider-specific) */
  baseUrl: z.string().url().optional(),

  /** API key or secret reference */
  apiKey: secretReferenceSchema.or(z.string().min(1)).optional(),

  /** Organization ID (for providers that support it) */
  organizationId: z.string().optional(),

  /** HTTP timeout configuration */
  timeout: httpTimeoutSchema.optional(),

  /** Retry configuration */
  retry: retrySchema.optional(),

  /** Custom HTTP headers to include with requests */
  headers: z.record(z.string()).optional(),

  /** Priority for provider selection (higher = more preferred) */
  priority: z.number().int().min(0).max(100).optional().default(50),

  /** Provider-specific metadata */
  metadata: z.record(z.unknown()).optional(),
});

/**
 * Base provider configuration type
 */
export type BaseProviderConfig = z.infer<typeof baseProviderConfigSchema>;

// =====================
// Provider Config With Secrets
// =====================

/**
 * Schema for a resolved provider config (with secrets resolved)
 */
export const resolvedProviderConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  vendorFamily: vendorFamilySchema,
  enabled: z.boolean(),
  defaultModel: z.string().optional(),
  baseUrl: z.string().url().optional(),
  /** Resolved API key (actual value, not reference) */
  apiKey: z.string().optional(),
  organizationId: z.string().optional(),
  timeout: httpTimeoutSchema.optional(),
  retry: retrySchema.optional(),
  headers: z.record(z.string()).optional(),
  priority: z.number().int(),
  metadata: z.record(z.unknown()).optional(),
});

/**
 * Resolved provider configuration type (with secrets resolved)
 */
export type ResolvedProviderConfig = z.infer<typeof resolvedProviderConfigSchema>;

// =====================
// Helper Functions
// =====================

/**
 * Check if a value is a secret reference
 */
export function isSecretReference(value: unknown): value is SecretReference {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj['type'] === 'string' &&
    ['env', 'file', 'vault', 'inline'].includes(obj['type'] as string)
  );
}

/**
 * Get the API key value (resolving if it's a plain string)
 * Note: For actual secret resolution, use a SecretProvider
 */
export function getApiKeyLiteral(
  config: BaseProviderConfig
): string | SecretReference | undefined {
  return config.apiKey;
}

/**
 * Create a partial base provider config with defaults
 */
export function createBaseProviderConfig(
  partial: Partial<BaseProviderConfig> & { id: string; name: string; vendorFamily: VendorFamily }
): BaseProviderConfig {
  return baseProviderConfigSchema.parse(partial);
}
