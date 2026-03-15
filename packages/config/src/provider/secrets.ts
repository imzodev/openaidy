/**
 * Secret Handling Abstraction
 *
 * This module defines the types and interfaces for handling secrets
 * (API keys, tokens, etc.) in a provider-agnostic way.
 *
 * Secrets are referenced through a reference type, and resolved through
 * a secret provider interface. This abstraction allows secrets to be
 * stored in different backends (environment variables, vaults, etc.)
 * without the config package depending on any specific implementation.
 */

import { z } from 'zod';

// =====================
// Secret Reference Types
// =====================

/**
 * Types of secret sources
 */
export type SecretSourceType =
  | 'env' // Environment variable
  | 'file' // File path
  | 'vault' // External vault (e.g., HashiCorp Vault)
  | 'inline'; // Inline value (for development/testing only)

/**
 * Schema for secret reference
 */
export const secretReferenceSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('env'),
    /** Name of the environment variable */
    name: z.string().min(1),
  }),
  z.object({
    type: z.literal('file'),
    /** Path to the file containing the secret */
    path: z.string().min(1),
  }),
  z.object({
    type: z.literal('vault'),
    /** Path/key in the vault */
    key: z.string().min(1),
    /** Optional mount point for the vault */
    mount: z.string().optional(),
  }),
  z.object({
    type: z.literal('inline'),
    /** The actual secret value (use only for development/testing) */
    value: z.string(),
  }),
]);

/**
 * Secret reference - describes where to find a secret
 */
export type SecretReference = z.infer<typeof secretReferenceSchema>;

/**
 * Helper to create an environment variable secret reference
 */
export function envSecret(name: string): SecretReference {
  return { type: 'env', name };
}

/**
 * Helper to create a file secret reference
 */
export function fileSecret(path: string): SecretReference {
  return { type: 'file', path };
}

/**
 * Helper to create a vault secret reference
 */
export function vaultSecret(key: string, mount?: string): SecretReference {
  return { type: 'vault', key, ...(mount !== undefined && { mount }) };
}

/**
 * Helper to create an inline secret reference (for testing only)
 */
export function inlineSecret(value: string): SecretReference {
  return { type: 'inline', value };
}

// =====================
// Secret Resolution Types
// =====================

/**
 * Result of resolving a secret
 */
export type SecretResolutionResult =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: SecretResolutionError };

/**
 * Error during secret resolution
 */
export type SecretResolutionError = {
  readonly code: SecretResolutionErrorCode;
  readonly message: string;
  readonly cause?: unknown;
};

/**
 * Error codes for secret resolution failures
 */
export type SecretResolutionErrorCode =
  | 'secret.not_found'
  | 'secret.access_denied'
  | 'secret.invalid_reference'
  | 'secret.provider_unavailable'
  | 'secret.timeout'
  | 'secret.unknown';

/**
 * Creates a successful secret resolution result
 */
export function secretOk(value: string): SecretResolutionResult {
  return { ok: true, value };
}

/**
 * Creates a failed secret resolution result
 */
export function secretErr(
  code: SecretResolutionErrorCode,
  message: string,
  cause?: unknown
): SecretResolutionResult {
  const error: SecretResolutionError = { code, message };
  if (cause !== undefined) {
    (error as { cause: unknown }).cause = cause;
  }
  return { ok: false, error };
}

// =====================
// Secret Provider Interface
// =====================

/**
 * Secret provider interface
 *
 * Implementations of this interface are responsible for resolving
 * secret references to actual secret values.
 */
export interface SecretProvider {
  /**
   * Resolve a secret reference to its actual value
   */
  resolve(reference: SecretReference): Promise<SecretResolutionResult>;

  /**
   * Check if this provider can resolve the given reference type
   */
  canResolve(reference: SecretReference): boolean;

  /**
   * Optional: Validate that a secret reference is well-formed
   */
  validate?(reference: SecretReference): boolean;
}

/**
 * Base implementation of a secret provider that handles inline secrets
 */
export class InlineSecretProvider implements SecretProvider {
  canResolve(reference: SecretReference): boolean {
    return reference.type === 'inline';
  }

  async resolve(reference: SecretReference): Promise<SecretResolutionResult> {
    if (reference.type !== 'inline') {
      return secretErr(
        'secret.invalid_reference',
        'InlineSecretProvider can only resolve inline secrets'
      );
    }
    return secretOk(reference.value);
  }
}

/**
 * Environment variable secret provider
 */
export class EnvSecretProvider implements SecretProvider {
  private readonly envSource: Record<string, string | undefined>;

  constructor(envSource: Record<string, string | undefined> = process.env) {
    this.envSource = envSource;
  }

  canResolve(reference: SecretReference): boolean {
    return reference.type === 'env';
  }

  async resolve(reference: SecretReference): Promise<SecretResolutionResult> {
    if (reference.type !== 'env') {
      return secretErr(
        'secret.invalid_reference',
        'EnvSecretProvider can only resolve env secrets'
      );
    }

    const value = this.envSource[reference.name];
    if (value === undefined || value === '') {
      return secretErr(
        'secret.not_found',
        `Environment variable "${reference.name}" is not set or empty`
      );
    }

    return secretOk(value);
  }
}

// =====================
// Composite Secret Provider
// =====================

/**
 * Composite secret provider that delegates to multiple providers
 */
export class CompositeSecretProvider implements SecretProvider {
  private readonly providers: SecretProvider[];

  constructor(providers: SecretProvider[] = []) {
    this.providers = providers;
  }

  /**
   * Add a provider to the composite
   */
  addProvider(provider: SecretProvider): void {
    this.providers.push(provider);
  }

  canResolve(reference: SecretReference): boolean {
    return this.providers.some((p) => p.canResolve(reference));
  }

  async resolve(reference: SecretReference): Promise<SecretResolutionResult> {
    const provider = this.providers.find((p) => p.canResolve(reference));

    if (!provider) {
      return secretErr(
        'secret.provider_unavailable',
        `No provider available for secret type: ${reference.type}`
      );
    }

    return provider.resolve(reference);
  }
}

/**
 * Create a default secret provider with standard providers
 */
export function createDefaultSecretProvider(
  envSource: Record<string, string | undefined> = process.env
): CompositeSecretProvider {
  return new CompositeSecretProvider([
    new InlineSecretProvider(),
    new EnvSecretProvider(envSource),
  ]);
}
