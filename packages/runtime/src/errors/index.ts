/**
 * Provider error codes - normalized across all vendor families
 */
export type ProviderErrorCode =
  | 'provider.auth.invalid'
  | 'provider.auth.missing'
  | 'provider.rate_limited'
  | 'provider.timeout'
  | 'provider.unavailable'
  | 'provider.model_not_found'
  | 'provider.model_overloaded'
  | 'provider.invalid_request'
  | 'provider.invalid_response'
  | 'provider.stream_error'
  | 'provider.capability_unsupported'
  | 'provider.config_invalid'
  | 'provider.unknown';

/**
 * Normalized provider error shape
 */
export type ProviderError = {
  readonly code: ProviderErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly cause?: unknown;
  readonly providerId?: string;
  readonly modelId?: string;
  readonly retryAfterMs?: number;
};

/**
 * Options for creating a provider error
 */
export type ProviderErrorOptions = {
  readonly cause?: unknown;
  readonly providerId?: string;
  readonly modelId?: string;
  readonly retryAfterMs?: number;
};

/**
 * Creates a normalized provider error
 */
export function createProviderError(
  code: ProviderErrorCode,
  message: string,
  options?: ProviderErrorOptions
): ProviderError {
  const retryable = isRetryableCode(code);
  const error: ProviderError = {
    code,
    message,
    retryable,
  };

  if (options?.cause !== undefined) {
    (error as { cause: unknown }).cause = options.cause;
  }
  if (options?.providerId !== undefined) {
    (error as { providerId: string }).providerId = options.providerId;
  }
  if (options?.modelId !== undefined) {
    (error as { modelId: string }).modelId = options.modelId;
  }
  if (options?.retryAfterMs !== undefined) {
    (error as { retryAfterMs: number }).retryAfterMs = options.retryAfterMs;
  }

  return error;
}

/**
 * Determines if an error code indicates a retryable failure
 */
export function isRetryableCode(code: ProviderErrorCode): boolean {
  return (
    code === 'provider.rate_limited' ||
    code === 'provider.timeout' ||
    code === 'provider.unavailable' ||
    code === 'provider.model_overloaded' ||
    code === 'provider.stream_error'
  );
}

/**
 * Type guard for ProviderError
 */
export function isProviderError(value: unknown): value is ProviderError {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj['code'] === 'string' &&
    typeof obj['message'] === 'string' &&
    typeof obj['retryable'] === 'boolean'
  );
}
