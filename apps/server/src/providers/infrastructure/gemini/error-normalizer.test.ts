/**
 * Tests for Gemini Error Normalizer
 */

import { describe, it, expect } from 'vitest';
import { isGeminiError, extractErrorMessage, normalizeError } from './error-normalizer';
import type { GeminiErrorResponse } from './types';

describe('isGeminiError', () => {
  it('should return true for Gemini error response', () => {
    const error: GeminiErrorResponse = {
      error: {
        code: 400,
        message: 'Invalid request',
        status: 'INVALID_ARGUMENT',
      },
    };

    expect(isGeminiError(error)).toBe(true);
  });

  it('should return true for Gemini error with details', () => {
    const error: GeminiErrorResponse = {
      error: {
        code: 400,
        message: 'Invalid request',
        status: 'INVALID_ARGUMENT',
        details: [
          { '@type': 'type.googleapis.com/google.rpc.BadRequest', reason: 'INVALID_ARGUMENT' },
        ],
      },
    };

    expect(isGeminiError(error)).toBe(true);
  });

  it('should return false for non-Gemini error', () => {
    expect(isGeminiError(null)).toBe(false);
    expect(isGeminiError(undefined)).toBe(false);
    expect(isGeminiError('error')).toBe(false);
    expect(isGeminiError({ message: 'error' })).toBe(false);
    expect(isGeminiError({ error: 'string' })).toBe(false);
  });
});

describe('extractErrorMessage', () => {
  it('should extract message from Error', () => {
    const error = new Error('Test error');
    expect(extractErrorMessage(error)).toBe('Test error');
  });

  it('should extract message from string', () => {
    expect(extractErrorMessage('String error')).toBe('String error');
  });

  it('should extract message from Gemini error', () => {
    const error: GeminiErrorResponse = {
      error: {
        code: 400,
        message: 'API error',
        status: 'INVALID_ARGUMENT',
      },
    };

    expect(extractErrorMessage(error)).toBe('API error');
  });

  it('should extract message from object with message', () => {
    expect(extractErrorMessage({ message: 'Object error' })).toBe('Object error');
  });

  it('should return default for unknown format', () => {
    expect(extractErrorMessage({})).toBe('Unknown error');
    expect(extractErrorMessage(null)).toBe('Unknown error');
  });
});

describe('normalizeError', () => {
  describe('Gemini error responses', () => {
    it('should normalize UNAUTHENTICATED error', () => {
      const error: GeminiErrorResponse = {
        error: {
          code: 401,
          message: 'Invalid API key',
          status: 'UNAUTHENTICATED',
        },
      };

      const result = normalizeError(error, { providerId: 'gemini', modelId: 'gemini-2.0-flash' });

      expect(result.code).toBe('provider.auth.invalid');
      expect(result.message).toBe('Invalid API key');
      expect(result.providerId).toBe('gemini');
      expect(result.modelId).toBe('gemini-2.0-flash');
    });

    it('should normalize PERMISSION_DENIED error', () => {
      const error: GeminiErrorResponse = {
        error: {
          code: 403,
          message: 'Permission denied',
          status: 'PERMISSION_DENIED',
        },
      };

      const result = normalizeError(error);

      expect(result.code).toBe('provider.auth.invalid');
    });

    it('should normalize RESOURCE_EXHAUSTED error (rate limit)', () => {
      const error: GeminiErrorResponse = {
        error: {
          code: 429,
          message: 'Resource exhausted',
          status: 'RESOURCE_EXHAUSTED',
        },
      };

      const result = normalizeError(error);

      expect(result.code).toBe('provider.rate_limited');
      expect(result.retryable).toBe(true);
    });

    it('should normalize NOT_FOUND error', () => {
      const error: GeminiErrorResponse = {
        error: {
          code: 404,
          message: 'Model not found',
          status: 'NOT_FOUND',
        },
      };

      const result = normalizeError(error);

      expect(result.code).toBe('provider.model_not_found');
    });

    it('should normalize INVALID_ARGUMENT error', () => {
      const error: GeminiErrorResponse = {
        error: {
          code: 400,
          message: 'Invalid argument',
          status: 'INVALID_ARGUMENT',
        },
      };

      const result = normalizeError(error);

      expect(result.code).toBe('provider.invalid_request');
    });

    it('should normalize INTERNAL error', () => {
      const error: GeminiErrorResponse = {
        error: {
          code: 500,
          message: 'Internal error',
          status: 'INTERNAL',
        },
      };

      const result = normalizeError(error);

      expect(result.code).toBe('provider.unavailable');
      expect(result.retryable).toBe(true);
    });

    it('should normalize UNAVAILABLE error', () => {
      const error: GeminiErrorResponse = {
        error: {
          code: 503,
          message: 'Service unavailable',
          status: 'UNAVAILABLE',
        },
      };

      const result = normalizeError(error);

      expect(result.code).toBe('provider.unavailable');
      expect(result.retryable).toBe(true);
    });

    it('should normalize DEADLINE_EXCEEDED error (timeout)', () => {
      const error: GeminiErrorResponse = {
        error: {
          code: 504,
          message: 'Deadline exceeded',
          status: 'DEADLINE_EXCEEDED',
        },
      };

      const result = normalizeError(error);

      expect(result.code).toBe('provider.timeout');
    });

    it('should normalize BLOCKED_BY_SAFETY error', () => {
      const error: GeminiErrorResponse = {
        error: {
          code: 400,
          message: 'Blocked by safety',
          status: 'BLOCKED_BY_SAFETY',
        },
      };

      const result = normalizeError(error);

      expect(result.code).toBe('provider.invalid_request');
    });

    it('should normalize error with details', () => {
      // When status is set, it takes precedence over details
      const error: GeminiErrorResponse = {
        error: {
          code: 400,
          message: 'Invalid request',
          status: 'RESOURCE_EXHAUSTED',
          details: [
            { '@type': 'type.googleapis.com/google.rpc.BadRequest', reason: 'INVALID_ARGUMENT' },
          ],
        },
      };

      const result = normalizeError(error);

      expect(result.code).toBe('provider.rate_limited');
    });

    it('should use details reason when status is not mapped', () => {
      const error: GeminiErrorResponse = {
        error: {
          code: 400,
          message: 'Custom error',
          status: 'CUSTOM_STATUS',
          details: [
            { '@type': 'type.googleapis.com/google.rpc.BadRequest', reason: 'RESOURCE_EXHAUSTED' },
          ],
        },
      };

      const result = normalizeError(error);

      expect(result.code).toBe('provider.rate_limited');
    });
  });

  describe('HTTP Response errors', () => {
    it('should normalize 401 response', () => {
      const response = new Response(null, { status: 401, statusText: 'Unauthorized' });
      const result = normalizeError(response, { providerId: 'gemini' });

      expect(result.code).toBe('provider.auth.invalid');
      expect(result.message).toContain('401');
      expect(result.providerId).toBe('gemini');
    });

    it('should normalize 403 response', () => {
      const response = new Response(null, { status: 403, statusText: 'Forbidden' });
      const result = normalizeError(response);

      expect(result.code).toBe('provider.auth.invalid');
    });

    it('should normalize 429 response', () => {
      const headers = new Headers({ 'retry-after': '30' });
      const response = new Response(null, { status: 429, statusText: 'Too Many Requests', headers });
      const result = normalizeError(response);

      expect(result.code).toBe('provider.rate_limited');
      expect(result.retryAfterMs).toBe(30000);
    });

    it('should normalize 404 response', () => {
      const response = new Response(null, { status: 404, statusText: 'Not Found' });
      const result = normalizeError(response);

      expect(result.code).toBe('provider.model_not_found');
    });

    it('should normalize 500 response', () => {
      const response = new Response(null, { status: 500, statusText: 'Internal Server Error' });
      const result = normalizeError(response);

      expect(result.code).toBe('provider.unavailable');
      expect(result.retryable).toBe(true);
    });

    it('should normalize 503 response', () => {
      const response = new Response(null, { status: 503, statusText: 'Service Unavailable' });
      const result = normalizeError(response);

      expect(result.code).toBe('provider.unavailable');
      expect(result.retryable).toBe(true);
    });
  });

  describe('Network errors', () => {
    it('should normalize TypeError network error', () => {
      const error = new TypeError('fetch failed');
      const result = normalizeError(error);

      expect(result.code).toBe('provider.unavailable');
      expect(result.retryable).toBe(true);
    });

    it('should normalize network error', () => {
      const error = new TypeError('network error');
      const result = normalizeError(error);

      expect(result.code).toBe('provider.unavailable');
    });
  });

  describe('Timeout errors', () => {
    it('should normalize AbortError as timeout', () => {
      const error = new Error('The operation was aborted');
      error.name = 'AbortError';
      const result = normalizeError(error);

      expect(result.code).toBe('provider.timeout');
      expect(result.retryable).toBe(true);
    });
  });

  describe('Generic errors', () => {
    it('should normalize generic Error', () => {
      const error = new Error('Something went wrong');
      const result = normalizeError(error);

      expect(result.code).toBe('provider.unknown');
      expect(result.message).toBe('Something went wrong');
    });

    it('should normalize unknown error types', () => {
      const result = normalizeError('Unknown error string');

      expect(result.code).toBe('provider.unknown');
      expect(result.message).toBe('Unknown error string');
    });
  });

  describe('Error options', () => {
    it('should include providerId in error', () => {
      const error = new Error('Test');
      const result = normalizeError(error, { providerId: 'gemini' });

      expect(result.providerId).toBe('gemini');
    });

    it('should include modelId in error', () => {
      const error = new Error('Test');
      const result = normalizeError(error, { modelId: 'gemini-2.0-flash' });

      expect(result.modelId).toBe('gemini-2.0-flash');
    });

    it('should include cause in error', () => {
      const cause = new Error('Original error');
      const result = normalizeError(cause);

      expect(result.cause).toBe(cause);
    });
  });
});
