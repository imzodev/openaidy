/**
 * Control Plane - Types Tests
 * 
 * Tests for workflow result types and helper functions.
 */

import { describe, expect, it } from 'vitest';
import { success, failure, type WorkflowResult, type WorkflowErrorCode } from './types.js';

describe('Workflow Result Types', () => {
  describe('success()', () => {
    it('creates a successful result with data', () => {
      const result = success({ name: 'test', value: 42 });
      
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ name: 'test', value: 42 });
      expect(result.error).toBeUndefined();
    });

    it('creates a successful result with string data', () => {
      const result = success('hello world');
      
      expect(result.success).toBe(true);
      expect(result.data).toBe('hello world');
    });

    it('creates a successful result with array data', () => {
      const result = success([1, 2, 3]);
      
      expect(result.success).toBe(true);
      expect(result.data).toEqual([1, 2, 3]);
    });

    it('creates a successful result with null data', () => {
      const result = success(null);
      
      expect(result.success).toBe(true);
      expect(result.data).toBeNull();
    });
  });

  describe('failure()', () => {
    it('creates a failed result with error code and message', () => {
      const result = failure('INTERNAL_ERROR', 'Something went wrong');
      
      expect(result.success).toBe(false);
      expect(result.data).toBeUndefined();
      expect(result.error).toBeDefined();
      expect(result.error?.code).toBe('INTERNAL_ERROR');
      expect(result.error?.message).toBe('Something went wrong');
      expect(result.error?.details).toBeUndefined();
    });

    it('creates a failed result with details', () => {
      const result = failure(
        'PAIRING_REQUEST_NOT_FOUND',
        'Request not found',
        { requestId: 'abc-123' },
      );
      
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PAIRING_REQUEST_NOT_FOUND');
      expect(result.error?.message).toBe('Request not found');
      expect(result.error?.details).toEqual({ requestId: 'abc-123' });
    });

    it('creates bootstrap admin error', () => {
      const result = failure(
        'BOOTSTRAP_ADMIN_TOKEN_EXPIRED',
        'Token has expired',
        { expiresAt: '2024-01-01T00:00:00Z' },
      );
      
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('BOOTSTRAP_ADMIN_TOKEN_EXPIRED');
    });

    it('creates pairing request error', () => {
      const result = failure(
        'PAIRING_REQUEST_ALREADY_PROCESSED',
        'Request already approved',
        { requestId: 'xyz-789', status: 'approved' },
      );
      
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PAIRING_REQUEST_ALREADY_PROCESSED');
    });
  });

  describe('Type narrowing', () => {
    it('can narrow success result', () => {
      const result: WorkflowResult<{ id: string }> = success({ id: '123' });
      
      if (result.success) {
        expect(result.data?.id).toBe('123');
      } else {
        expect.fail('Should be success');
      }
    });

    it('can narrow failure result', () => {
      const result: WorkflowResult<{ id: string }> = failure('INVALID_INPUT', 'Invalid');
      
      if (!result.success) {
        expect(result.error?.code).toBe('INVALID_INPUT');
      } else {
        expect.fail('Should be failure');
      }
    });
  });
});
