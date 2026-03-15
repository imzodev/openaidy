import { describe, it, expect } from 'vitest';
import {
  createProviderError,
  isProviderError,
  isRetryableCode,
  type ProviderErrorCode,
} from '../src/errors';

describe('Provider Errors', () => {
  describe('createProviderError', () => {
    it('should create a provider error with required fields', () => {
      const error = createProviderError(
        'provider.auth.invalid',
        'Invalid API key'
      );

      expect(error.code).toBe('provider.auth.invalid');
      expect(error.message).toBe('Invalid API key');
      expect(error.retryable).toBe(false);
      expect(error.cause).toBeUndefined();
      expect(error.providerId).toBeUndefined();
      expect(error.modelId).toBeUndefined();
      expect(error.retryAfterMs).toBeUndefined();
    });

    it('should create a provider error with all optional fields', () => {
      const cause = new Error('Original error');
      const error = createProviderError(
        'provider.rate_limited',
        'Rate limit exceeded',
        {
          cause,
          providerId: 'openai',
          modelId: 'gpt-4',
          retryAfterMs: 5000,
        }
      );

      expect(error.code).toBe('provider.rate_limited');
      expect(error.message).toBe('Rate limit exceeded');
      expect(error.cause).toBe(cause);
      expect(error.providerId).toBe('openai');
      expect(error.modelId).toBe('gpt-4');
      expect(error.retryAfterMs).toBe(5000);
      expect(error.retryable).toBe(true);
    });

    it('should create error for each error code', () => {
      const codes: ProviderErrorCode[] = [
        'provider.auth.invalid',
        'provider.auth.missing',
        'provider.rate_limited',
        'provider.timeout',
        'provider.unavailable',
        'provider.model_not_found',
        'provider.model_overloaded',
        'provider.invalid_request',
        'provider.invalid_response',
        'provider.stream_error',
        'provider.capability_unsupported',
        'provider.config_invalid',
        'provider.unknown',
      ];

      codes.forEach((code) => {
        const error = createProviderError(code, `Test error for ${code}`);
        expect(error.code).toBe(code);
        expect(error.message).toBe(`Test error for ${code}`);
      });
    });
  });

  describe('isRetryableCode', () => {
    it('should return true for retryable codes', () => {
      expect(isRetryableCode('provider.rate_limited')).toBe(true);
      expect(isRetryableCode('provider.timeout')).toBe(true);
      expect(isRetryableCode('provider.unavailable')).toBe(true);
      expect(isRetryableCode('provider.model_overloaded')).toBe(true);
      expect(isRetryableCode('provider.stream_error')).toBe(true);
    });

    it('should return false for non-retryable codes', () => {
      expect(isRetryableCode('provider.auth.invalid')).toBe(false);
      expect(isRetryableCode('provider.auth.missing')).toBe(false);
      expect(isRetryableCode('provider.model_not_found')).toBe(false);
      expect(isRetryableCode('provider.invalid_request')).toBe(false);
      expect(isRetryableCode('provider.invalid_response')).toBe(false);
      expect(isRetryableCode('provider.capability_unsupported')).toBe(false);
      expect(isRetryableCode('provider.config_invalid')).toBe(false);
      expect(isRetryableCode('provider.unknown')).toBe(false);
    });
  });

  describe('isProviderError', () => {
    it('should return true for valid provider errors', () => {
      const error = createProviderError('provider.timeout', 'Timeout');
      expect(isProviderError(error)).toBe(true);
    });

    it('should return false for non-provider errors', () => {
      expect(isProviderError(null)).toBe(false);
      expect(isProviderError(undefined)).toBe(false);
      expect(isProviderError('string')).toBe(false);
      expect(isProviderError(123)).toBe(false);
      expect(isProviderError({})).toBe(false);
      expect(isProviderError({ code: 'test' })).toBe(false);
      expect(isProviderError({ message: 'test' })).toBe(false);
      expect(isProviderError({ code: 123, message: 'test' })).toBe(false);
    });
  });
});
