/**
 * Gemini Error Normalizer
 *
 * Translates Gemini-specific errors into the shared provider error model.
 */

import {
  createProviderError,
  type ProviderError,
  type ProviderErrorCode,
  type ProviderErrorOptions,
} from '@openaidy/runtime';
import type { GeminiErrorResponse } from './types';

// =====================
// Error Code Mapping
// =====================

/**
 * Maps Gemini error status/reason to normalized provider error codes
 */
const GEMINI_ERROR_CODE_MAP: Record<string, ProviderErrorCode> = {
  // Authentication errors
  UNAUTHENTICATED: 'provider.auth.invalid',
  'PERMISSION_DENIED': 'provider.auth.invalid',
  
  // Invalid request
  INVALID_ARGUMENT: 'provider.invalid_request',
  BAD_REQUEST: 'provider.invalid_request',
  
  // Rate limiting
  RESOURCE_EXHAUSTED: 'provider.rate_limited',
  
  // Model errors
  NOT_FOUND: 'provider.model_not_found',
  
  // Server errors
  INTERNAL: 'provider.unavailable',
  UNAVAILABLE: 'provider.unavailable',
  DEADLINE_EXCEEDED: 'provider.timeout',
  
  // Content filter
  BLOCKED_BY_SAFETY: 'provider.invalid_request',
};

// =====================
// Error Detection
// =====================

/**
 * Checks if a response is a Gemini error response
 */
export function isGeminiError(response: unknown): response is GeminiErrorResponse {
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
  
  if (isGeminiError(error)) {
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
 * Normalizes a Gemini API error to provider error
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
  
  // Handle Gemini error response
  if (isGeminiError(error)) {
    const geminiError = error.error;
    
    // Check status field first, then details for reason
    let code: ProviderErrorCode = 'provider.unknown';
    
    if (geminiError.status) {
      const mappedCode = GEMINI_ERROR_CODE_MAP[geminiError.status];
      if (mappedCode) {
        code = mappedCode;
      }
    }
    
    // If status didn't map, try details
    if (code === 'provider.unknown' && geminiError.details) {
      const detailWithReason = geminiError.details.find((d) => d.reason && GEMINI_ERROR_CODE_MAP[d.reason]);
      if (detailWithReason?.reason) {
        const mappedCode = GEMINI_ERROR_CODE_MAP[detailWithReason.reason];
        if (mappedCode) {
          code = mappedCode;
        }
      }
    }
    
    return createProviderError(code, geminiError.message, buildErrorOptions(providerId, modelId, error));
  }
  
  // Handle network errors
  if (error instanceof TypeError) {
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
