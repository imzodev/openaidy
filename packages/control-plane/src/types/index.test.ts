/**
 * Control Plane Types Tests
 */

import { describe, it, expect } from 'vitest';
import {
  success,
  failure,
  createError,
  type ControlPlaneResult,
  type ControlPlaneError,
} from './index.js';

describe('Control Plane Types', () => {
  describe('success', () => {
    it('creates success result without data', () => {
      const result = success();
      expect(result.status).toBe('success');
      expect(result.data).toBeUndefined();
      expect(result.error).toBeUndefined();
    });

    it('creates success result with data', () => {
      const result = success({ id: 'test', value: 42 });
      expect(result.status).toBe('success');
      expect(result.data).toEqual({ id: 'test', value: 42 });
      expect(result.error).toBeUndefined();
    });

    it('creates success result with null data', () => {
      const result = success(null);
      expect(result.status).toBe('success');
      expect(result.data).toBeNull();
    });

    it('creates success result with array data', () => {
      const result = success([1, 2, 3]);
      expect(result.status).toBe('success');
      expect(result.data).toEqual([1, 2, 3]);
    });
  });

  describe('failure', () => {
    it('creates failure result with error', () => {
      const result = failure('error', createError('NOT_FOUND', 'Resource not found'));
      expect(result.status).toBe('error');
      expect(result.error?.code).toBe('NOT_FOUND');
      expect(result.error?.message).toBe('Resource not found');
      expect(result.data).toBeUndefined();
    });

    it('creates failure with different statuses', () => {
      const statuses = ['error', 'not_found', 'invalid', 'unauthorized', 'disabled'] as const;
      
      for (const status of statuses) {
        const result = failure(status, createError('INTERNAL_ERROR', 'Test'));
        expect(result.status).toBe(status);
      }
    });

    it('creates failure with error details', () => {
      const result = failure('error', createError('INVALID_INPUT', 'Invalid data', { field: 'email' }));
      expect(result.error?.details).toEqual({ field: 'email' });
    });
  });

  describe('createError', () => {
    it('creates error with code and message', () => {
      const error = createError('NOT_FOUND', 'Item not found');
      expect(error.code).toBe('NOT_FOUND');
      expect(error.message).toBe('Item not found');
      expect(error.details).toBeUndefined();
    });

    it('creates error with details', () => {
      const error = createError('INVALID_INPUT', 'Validation failed', { fields: ['email', 'name'] });
      expect(error.code).toBe('INVALID_INPUT');
      expect(error.message).toBe('Validation failed');
      expect(error.details).toEqual({ fields: ['email', 'name'] });
    });

    it('supports all error codes', () => {
      const codes = [
        'NOT_FOUND',
        'INVALID_INPUT',
        'UNAUTHORIZED',
        'DISABLED',
        'ALREADY_EXISTS',
        'EXPIRED',
        'INTERNAL_ERROR',
      ] as const;

      for (const code of codes) {
        const error = createError(code, 'Test message');
        expect(error.code).toBe(code);
      }
    });
  });

  describe('ControlPlaneResult type guard', () => {
    it('can check result type', () => {
      const successResult: ControlPlaneResult<{ id: string }> = success({ id: 'test' });
      const failureResult: ControlPlaneResult<never> = failure('error', createError('NOT_FOUND', 'Not found'));

      expect(successResult.status).toBe('success');
      expect(failureResult.status).toBe('error');
    });
  });
});
