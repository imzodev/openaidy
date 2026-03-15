/**
 * Anthropic Error Normalizer
 *
 * Translates Anthropic-specific errors into the shared provider error model.
 */

import {
  createProviderError,
  type ProviderError,
  type ProviderErrorCode,
  type ProviderErrorOptions,
} from '@openaidy/runtime';
import type { AnthropicErrorResponse } from './types';

// =====================
// Error Code Mapping
// =====================

/**
 * Maps Anthropic error types to normalized provider error codes
 */
const ANTHROPIC_ERROR_CODE_MAP: Record<string, ProviderErrorCode> = {
  // Authentication errors
  authentication_error: 'provider.auth.invalid',
  permission_error: 'provider.auth.invalid',
  unauthorized: 'provider.auth.invalid',

  // Invalid request
  invalid_request_error: 'provider.invalid_request',
  validation_error: 'provider.invalid_request',

  // Rate limiting
  rate_limit_error: 'provider.rate_limited',
  overloaded_error: 'provider.model_overloaded',

  // Model errors
  model_not_found_error: 'provider.model_not_found',
  not_found_error: 'provider.model_not_found',

  // Server errors
  api_error: 'provider.unavailable',
  internal_error: 'provider.unavailable',

  // Timeout
  timeout_error: 'provider.timeout',

  // Content filter
  content_filter: 'provider.invalid_request',
};

// =====================
// Error Detection
// =====================

/**
 * Checks if a response is an Anthropic error response
 */
export function isAnthropicError(response: unknown): response is AnthropicErrorResponse {
  return (
    typeof response === 'object' &&
    response !== null &&
    'error' in response &&
    typeof (response as Record<string, unknown>).error === 'object'
  );
}

/**
 * Extracts error message from various error shapes
 */
export function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  if (isAnthropicError(error)) {
    return error.error.message;
  }

  if (typeof error === 'object' && error !== null) {
    if ('message' in error && typeof error.message === 'string') {
      return error.message;
    }
  }

  return 'Unknown error';
}

// =====================
// Error Normalization
// =====================

/**
 * Maps HTTP status code to provider error code
 */
function mapHttpStatusToErrorCode(status: number): ProviderErrorCode {
  if (status === 401) {
    return 'provider.auth.invalid';
  }
  if (status === 403) {
    return 'provider.auth.invalid';
  }
  if (status === 404) {
    return 'provider.model_not_found';
  }
  if (status === 429) {
    return 'provider.rate_limited';
  }
  if (status === 529) {
    // Anthropic-specific overloaded status
    return 'provider.model_overloaded';
  }
  if (status >= 500) {
    return 'provider.unavailable';
  }
  if (status >= 400) {
    return 'provider.invalid_request';
  }
  return 'provider.unknown';
}

/**
 * Extracts retry-after header value in milliseconds
 */
function extractRetryAfterMs(headers: Headers): number | undefined {
  const retryAfter = headers.get('retry-after');
  if (!retryAfter) return undefined;

  // Try parsing as seconds
  const seconds = parseInt(retryAfter, 10);
  if (!isNaN(seconds)) {
    return seconds * 1000;
  }

  // Try parsing as date
  const date = new Date(retryAfter);
  if (!isNaN(date.getTime())) {
    return Math.max(0, date.getTime() - Date.now());
  }

  return undefined;
}

/**
 * Builds error options, only including defined values
 */
function buildErrorOptions(
  providerId: string | undefined,
  modelId: string | undefined,
  cause: unknown,
  retryAfterMs?: number
): ProviderErrorOptions {
  const options: ProviderErrorOptions = { cause };

  if (providerId !== undefined) {
    (options as { providerId: string }).providerId = providerId;
  }
  if (modelId !== undefined) {
    (options as { modelId: string }).modelId = modelId;
  }
  if (retryAfterMs !== undefined) {
    (options as { retryAfterMs: number }).retryAfterMs = retryAfterMs;
  }

  return options;
}

/**
 * Normalizes an Anthropic API error to provider error
 */
export function normalizeError(
  error: unknown,
  options?: {
    providerId?: string;
    modelId?: string;
  }
): ProviderError {
  const providerId = options?.providerId;
  const modelId = options?.modelId;

  // Handle fetch Response objects
  if (error instanceof Response) {
    const code = mapHttpStatusToErrorCode(error.status);
    const retryAfterMs = extractRetryAfterMs(error.headers);

    const message = `HTTP ${error.status}: ${error.statusText}`;

    return createProviderError(code, message, buildErrorOptions(providerId, modelId, error, retryAfterMs));
  }

  // Handle Anthropic error response
  if (isAnthropicError(error)) {
    const anthropicError = error.error;

    // Map error type to provider error code
    const errorType = anthropicError.type.toLowerCase().replace(/[^a-z_]/g, '_');
    const code =
      ANTHROPIC_ERROR_CODE_MAP[errorType] ??
      ANTHROPIC_ERROR_CODE_MAP[anthropicError.type] ??
      'provider.unknown';

    return createProviderError(code, anthropicError.message, buildErrorOptions(providerId, modelId, error));
  }

  // Handle network errors
  if (error instanceof TypeError) {
    // fetch throws TypeError for network errors
    if (error.message.includes('fetch') || error.message.includes('network')) {
      return createProviderError('provider.unavailable', error.message, buildErrorOptions(providerId, modelId, error));
    }
  }

  // Handle AbortError (timeout)
  if (error instanceof Error && error.name === 'AbortError') {
    return createProviderError('provider.timeout', 'Request timed out', buildErrorOptions(providerId, modelId, error));
  }

  // Handle generic errors
  if (error instanceof Error) {
    return createProviderError('provider.unknown', error.message, buildErrorOptions(providerId, modelId, error));
  }

  // Fallback for unknown error types
  return createProviderError('provider.unknown', extractErrorMessage(error), buildErrorOptions(providerId, modelId, error));
}
