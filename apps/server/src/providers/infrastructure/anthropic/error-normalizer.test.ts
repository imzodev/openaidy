/**
 * Tests for Anthropic Error Normalizer
 */

import { describe, it, expect } from 'vitest';
import { isAnthropicError, extractErrorMessage, normalizeError } from './error-normalizer';
import type { AnthropicErrorResponse } from './types';

describe('isAnthropicError', () => {
  it('should return true for Anthropic error response', () => {
    const error: AnthropicErrorResponse = {
      error: {
        type: 'invalid_request_error',
        message: 'Invalid request',
      },
    };

    expect(isAnthropicError(error)).toBe(true);
  });

  it('should return true for Anthropic error with details', () => {
    const error: AnthropicErrorResponse = {
      error: {
        type: 'invalid_request_error',
        message: 'Invalid request',
      },
    };

    expect(isAnthropicError(error)).toBe(true);
  });

  it('should return false for non-Anthropic error', () => {
    expect(isAnthropicError(null)).toBe(false);
    expect(isAnthropicError(undefined)).toBe(false);
    expect(isAnthropicError('error')).toBe(false);
    expect(isAnthropicError({ message: 'error' })).toBe(false);
    expect(isAnthropicError({ error: 'string' })).toBe(false);
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

  it('should extract message from Anthropic error', () => {
    const error: AnthropicErrorResponse = {
      error: {
        type: 'api_error',
        message: 'API error',
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
  describe('Anthropic error responses', () => {
    it('should normalize authentication_error', () => {
      const error: AnthropicErrorResponse = {
        error: {
          type: 'authentication_error',
          message: 'Invalid API key',
        },
      };

      const result = normalizeError(error, { providerId: 'anthropic', modelId: 'claude-sonnet-4-20250514' });

      expect(result.code).toBe('provider.auth.invalid');
      expect(result.message).toBe('Invalid API key');
      expect(result.providerId).toBe('anthropic');
      expect(result.modelId).toBe('claude-sonnet-4-20250514');
    });

    it('should normalize permission_error', () => {
      const error: AnthropicErrorResponse = {
        error: {
          type: 'permission_error',
          message: 'Permission denied',
        },
      };

      const result = normalizeError(error);

      expect(result.code).toBe('provider.auth.invalid');
    });

    it('should normalize rate_limit_error', () => {
      const error: AnthropicErrorResponse = {
        error: {
          type: 'rate_limit_error',
          message: 'Rate limit exceeded',
        },
      };

      const result = normalizeError(error);

      expect(result.code).toBe('provider.rate_limited');
    });

    it('should normalize overloaded_error', () => {
      const error: AnthropicErrorResponse = {
        error: {
          type: 'overloaded_error',
          message: 'Model overloaded',
        },
      };

      const result = normalizeError(error);

      expect(result.code).toBe('provider.model_overloaded');
      expect(result.retryable).toBe(true);
    });

    it('should normalize model_not_found_error', () => {
      const error: AnthropicErrorResponse = {
        error: {
          type: 'model_not_found_error',
          message: 'Model not found',
        },
      };

      const result = normalizeError(error);

      expect(result.code).toBe('provider.model_not_found');
    });

    it('should normalize invalid_request_error', () => {
      const error: AnthropicErrorResponse = {
        error: {
          type: 'invalid_request_error',
          message: 'Invalid request',
        },
      };

      const result = normalizeError(error);

      expect(result.code).toBe('provider.invalid_request');
    });

    it('should normalize api_error', () => {
      const error: AnthropicErrorResponse = {
        error: {
          type: 'api_error',
          message: 'Internal error',
        },
      };

      const result = normalizeError(error);

      expect(result.code).toBe('provider.unavailable');
    });

    it('should normalize timeout_error', () => {
      const error: AnthropicErrorResponse = {
        error: {
          type: 'timeout_error',
          message: 'Request timed out',
        },
      };

      const result = normalizeError(error);

      expect(result.code).toBe('provider.timeout');
    });
  });

  describe('HTTP Response errors', () => {
    it('should normalize 401 response', () => {
      const response = new Response(null, { status: 401, statusText: 'Unauthorized' });
      const result = normalizeError(response, { providerId: 'anthropic' });

      expect(result.code).toBe('provider.auth.invalid');
      expect(result.message).toContain('401');
      expect(result.providerId).toBe('anthropic');
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

    it('should normalize 529 response (Anthropic overloaded)', () => {
      const response = new Response(null, { status: 529, statusText: 'Overloaded' });
      const result = normalizeError(response);

      expect(result.code).toBe('provider.model_overloaded');
    });

    it('should normalize 500 response', () => {
      const response = new Response(null, { status: 500, statusText: 'Internal Server Error' });
      const result = normalizeError(response);

      expect(result.code).toBe('provider.unavailable');
    });
  });

  describe('Network errors', () => {
    it('should normalize TypeError network error', () => {
      const error = new TypeError('fetch failed');
      const result = normalizeError(error);

      expect(result.code).toBe('provider.unavailable');
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
      const result = normalizeError(error, { providerId: 'anthropic' });

      expect(result.providerId).toBe('anthropic');
    });

    it('should include modelId in error', () => {
      const error = new Error('Test');
      const result = normalizeError(error, { modelId: 'claude-sonnet-4-20250514' });

      expect(result.modelId).toBe('claude-sonnet-4-20250514');
    });

    it('should include cause in error', () => {
      const cause = new Error('Original error');
      const result = normalizeError(cause);

      expect(result.cause).toBe(cause);
    });
  });
});
