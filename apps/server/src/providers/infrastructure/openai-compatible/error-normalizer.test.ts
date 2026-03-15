/**
 * Tests for OpenAI-Compatible Error Normalizer
 */

import { describe, it, expect } from 'vitest';
import { isOpenAIError, extractErrorMessage, normalizeError } from './error-normalizer';
import type { OpenAIErrorResponse } from './types';

describe('isOpenAIError', () => {
  it('should return true for OpenAI error response', () => {
    const error: OpenAIErrorResponse = {
      error: {
        message: 'Invalid API key',
        type: 'invalid_request_error',
        code: 'invalid_api_key',
      },
    };

    expect(isOpenAIError(error)).toBe(true);
  });

  it('should return false for non-OpenAI error', () => {
    expect(isOpenAIError(null)).toBe(false);
    expect(isOpenAIError(undefined)).toBe(false);
    expect(isOpenAIError('error')).toBe(false);
    expect(isOpenAIError({ message: 'error' })).toBe(false);
    expect(isOpenAIError({ error: 'string' })).toBe(false);
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

  it('should extract message from OpenAI error', () => {
    const error: OpenAIErrorResponse = {
      error: {
        message: 'API error',
        type: 'invalid_request_error',
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
  describe('OpenAI error responses', () => {
    it('should normalize invalid_api_key error', () => {
      const error: OpenAIErrorResponse = {
        error: {
          message: 'Invalid API key provided',
          type: 'invalid_request_error',
          code: 'invalid_api_key',
        },
      };

      const result = normalizeError(error, { providerId: 'test', modelId: 'gpt-4' });

      expect(result.code).toBe('provider.auth.invalid');
      expect(result.message).toBe('Invalid API key provided');
      expect(result.providerId).toBe('test');
      expect(result.modelId).toBe('gpt-4');
      expect(result.retryable).toBe(false);
    });

    it('should normalize rate_limit_exceeded error', () => {
      const error: OpenAIErrorResponse = {
        error: {
          message: 'Rate limit exceeded',
          type: 'rate_limit_error',
          code: 'rate_limit_exceeded',
        },
      };

      const result = normalizeError(error);

      expect(result.code).toBe('provider.rate_limited');
      expect(result.retryable).toBe(true);
    });

    it('should normalize model_not_found error', () => {
      const error: OpenAIErrorResponse = {
        error: {
          message: 'Model not found',
          type: 'invalid_request_error',
          code: 'model_not_found',
        },
      };

      const result = normalizeError(error);

      expect(result.code).toBe('provider.model_not_found');
    });
  });

  describe('HTTP Response errors', () => {
    it('should normalize 401 response', () => {
      const response = new Response(null, { status: 401, statusText: 'Unauthorized' });
      const result = normalizeError(response, { providerId: 'test' });

      expect(result.code).toBe('provider.auth.invalid');
      expect(result.message).toContain('401');
      expect(result.providerId).toBe('test');
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
  });

  describe('Network errors', () => {
    it('should normalize TypeError network error', () => {
      const error = new TypeError('fetch failed');
      const result = normalizeError(error);

      expect(result.code).toBe('provider.unavailable');
      expect(result.retryable).toBe(true);
    });

    it('should normalize AbortError as timeout', () => {
      const error = new Error('The operation was aborted');
      error.name = 'AbortError';
      const result = normalizeError(error);

      expect(result.code).toBe('provider.timeout');
      expect(result.retryable).toBe(true); // timeout is retryable
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
});
