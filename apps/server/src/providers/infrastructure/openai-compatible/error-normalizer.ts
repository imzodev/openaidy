/**
 * OpenAI-Compatible Error Normalizer
 *
 * Translates OpenAI-specific errors into the shared provider error model.
 */

import {
  createProviderError,
  type ProviderError,
  type ProviderErrorCode,
  type ProviderErrorOptions,
} from '@openaidy/runtime';
import type { OpenAIErrorResponse } from './types';

// =====================
// Error Code Mapping
// =====================

/**
 * Maps OpenAI error types to normalized provider error codes
 */
const OPENAI_ERROR_CODE_MAP: Record<string, ProviderErrorCode> = {
  // Authentication errors
  invalid_api_key: 'provider.auth.invalid',
  invalid_request_error: 'provider.invalid_request',
  insufficient_quota: 'provider.rate_limited',

  // Rate limiting
  rate_limit_exceeded: 'provider.rate_limited',

  // Model errors
  model_not_found: 'provider.model_not_found',

  // Server errors
  server_error: 'provider.unavailable',

  // Timeout
  timeout: 'provider.timeout',

  // Content filter
  content_filter: 'provider.invalid_request',
};

// =====================
// Error Detection
// =====================

/**
 * Checks if a response is an OpenAI error response
 */
export function isOpenAIError(response: unknown): response is OpenAIErrorResponse {
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

  if (isOpenAIError(error)) {
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
 * Normalizes an OpenAI API error to provider error
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

    // Try to extract error details from response body
    const message = `HTTP ${error.status}: ${error.statusText}`;

    return createProviderError(code, message, buildErrorOptions(providerId, modelId, error, retryAfterMs));
  }

  // Handle OpenAI error response
  if (isOpenAIError(error)) {
    const openAIError = error.error;
    // Check code first (more specific), then type
    const code =
      OPENAI_ERROR_CODE_MAP[openAIError.code ?? ''] ??
      OPENAI_ERROR_CODE_MAP[openAIError.type] ??
      'provider.unknown';

    return createProviderError(code, openAIError.message, buildErrorOptions(providerId, modelId, error));
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
