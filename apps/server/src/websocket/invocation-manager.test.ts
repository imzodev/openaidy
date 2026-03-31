/**
 * Tests for Node Invocation Manager
 * 
 * Issue #127: WebSocket: complete session streaming and real session mutation behavior
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { InvocationManager } from './invocation-manager';
import type { ConnectionManager } from './connection-manager';
import type { FastifyBaseLogger } from 'fastify';
import {
  createWSMessage,
  WS_ERROR_CODES,
  type NodeRpcResponse,
  type NodeRpcError,
} from '@openaidy/shared-types';

// Mock logger
const mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  child: () => mockLogger,
  level: 'info',
  silent: false,
} as unknown as FastifyBaseLogger;

// Mock connection manager
const mockConnectionManager = {
  send: vi.fn().mockReturnValue(true),
  registerConnection: vi.fn(),
  removeConnection: vi.fn(),
  getConnection: vi.fn(),
  authenticate: vi.fn(),
  isAuthenticated: vi.fn().mockReturnValue(false),
  hasCapability: vi.fn().mockReturnValue(true),
  updateHeartbeat: vi.fn(),
  checkRateLimit: vi.fn().mockReturnValue({ allowed: true, info: {} }),
  recordRequest: vi.fn(),
  checkStaleConnections: vi.fn().mockReturnValue([]),
  getConnectionCount: vi.fn().mockReturnValue(0),
  getAllConnections: vi.fn().mockReturnValue([]),
  closeAll: vi.fn(),
};

describe('InvocationManager - Issue #127', () => {
  let invocationManager: InvocationManager;
  // Track all pending promises to handle rejections properly
  let pendingPromises: Promise<unknown>[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    pendingPromises = [];
    
    invocationManager = new InvocationManager(
      mockConnectionManager as any,
      mockLogger,
      { defaultTimeout: 5000, maxTimeout: 10000 },
    );
  });

  afterEach(async () => {
    // Clear the manager
    invocationManager.clear();
    
    // Handle all pending promise rejections
    await Promise.allSettled(pendingPromises);
    
    vi.useRealTimers();
  });

  // Helper to track promises
  function trackPromise<T>(promise: Promise<T>): Promise<T> {
    pendingPromises.push(promise.catch(() => {})); // Catch to prevent unhandled rejection
    return promise;
  }

  describe('startInvocation', () => {
    it('should start an invocation and return invocation ID', () => {
      const result = invocationManager.startInvocation(
        'node-1',
        'caller-1',
        'req-1',
        'sendMessage',
        { message: 'Hello' },
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.invocationId).toMatch(/^inv_/);
        trackPromise(result.promise);
      }
    });

    it('should track pending invocations', () => {
      const result = invocationManager.startInvocation(
        'node-1',
        'caller-1',
        'req-1',
        'sendMessage',
        { message: 'Hello' },
      );

      expect(invocationManager.getPendingCount()).toBe(1);
      
      if (result.ok) {
        expect(invocationManager.isPending(result.invocationId)).toBe(true);
        trackPromise(result.promise);
      }
    });

    it('should track invocations by node', () => {
      const r1 = invocationManager.startInvocation('node-1', 'caller-1', 'req-1', 'cap', {});
      const r2 = invocationManager.startInvocation('node-1', 'caller-2', 'req-2', 'cap', {});
      const r3 = invocationManager.startInvocation('node-2', 'caller-3', 'req-3', 'cap', {});

      expect(invocationManager.getNodePendingCount('node-1')).toBe(2);
      expect(invocationManager.getNodePendingCount('node-2')).toBe(1);
      expect(invocationManager.getNodePendingCount('node-3')).toBe(0);
      
      if (r1.ok) trackPromise(r1.promise);
      if (r2.ok) trackPromise(r2.promise);
      if (r3.ok) trackPromise(r3.promise);
    });

    it('should track invocations by caller', () => {
      const r1 = invocationManager.startInvocation('node-1', 'caller-1', 'req-1', 'cap', {});
      const r2 = invocationManager.startInvocation('node-2', 'caller-1', 'req-2', 'cap', {});
      const r3 = invocationManager.startInvocation('node-3', 'caller-2', 'req-3', 'cap', {});

      expect(invocationManager.getCallerPendingCount('caller-1')).toBe(2);
      expect(invocationManager.getCallerPendingCount('caller-2')).toBe(1);
      expect(invocationManager.getCallerPendingCount('caller-3')).toBe(0);
      
      if (r1.ok) trackPromise(r1.promise);
      if (r2.ok) trackPromise(r2.promise);
      if (r3.ok) trackPromise(r3.promise);
    });

    it('should respect custom timeout', () => {
      const result = invocationManager.startInvocation(
        'node-1',
        'caller-1',
        'req-1',
        'cap',
        {},
        3000,
      );

      expect(result.ok).toBe(true);
      
      if (result.ok) {
        const inv = invocationManager.getInvocation(result.invocationId);
        expect(inv?.timeout).toBe(3000);
        trackPromise(result.promise);
      }
    });

    it('should cap timeout to maxTimeout', () => {
      const result = invocationManager.startInvocation(
        'node-1',
        'caller-1',
        'req-1',
        'cap',
        {},
        50000, // Over max of 10000
      );

      expect(result.ok).toBe(true);
      
      if (result.ok) {
        const inv = invocationManager.getInvocation(result.invocationId);
        expect(inv?.timeout).toBe(10000); // Capped to max
        trackPromise(result.promise);
      }
    });
  });

  describe('createRpcRequest', () => {
    it('should create an RPC request for a pending invocation', () => {
      const result = invocationManager.startInvocation(
        'node-1',
        'caller-1',
        'req-1',
        'sendMessage',
        { message: 'Hello' },
      );

      if (result.ok) {
        const request = invocationManager.createRpcRequest(result.invocationId);
        
        expect(request).toBeDefined();
        expect(request?.type).toBe('node.rpc.request');
        expect(request?.payload.invocationId).toBe(result.invocationId);
        expect(request?.payload.capability).toBe('sendMessage');
        expect(request?.payload.params).toEqual({ message: 'Hello' });
        
        trackPromise(result.promise);
      }
    });

    it('should return null for unknown invocation ID', () => {
      const request = invocationManager.createRpcRequest('unknown-id');
      expect(request).toBeNull();
    });
  });

  describe('handleResponse', () => {
    it('should resolve the promise when response arrives', async () => {
      const result = invocationManager.startInvocation(
        'node-1',
        'caller-1',
        'req-1',
        'cap',
        {},
      );

      expect(result.ok).toBe(true);

      if (result.ok) {
        trackPromise(result.promise);

        // Create response
        const response = createWSMessage('node.rpc.response', {
          invocationId: result.invocationId,
          result: { data: 'success' },
          duration: 100,
        }) as NodeRpcResponse;

        // Handle response
        const handled = invocationManager.handleResponse(response);
        expect(handled).toBe(true);

        // Wait for promise to resolve
        const responseResult = await result.promise;
        expect(responseResult.type).toBe('node.invoke');
        if (responseResult.type === 'node.invoke') {
          expect(responseResult.payload.result).toEqual({ data: 'success' });
          expect(responseResult.payload.duration).toBeGreaterThanOrEqual(0);
        }
      }
    });

    it('should clean up after response', async () => {
      const result = invocationManager.startInvocation(
        'node-1',
        'caller-1',
        'req-1',
        'cap',
        {},
      );

      if (result.ok) {
        trackPromise(result.promise);

        const response = createWSMessage('node.rpc.response', {
          invocationId: result.invocationId,
          result: {},
          duration: 0,
        }) as NodeRpcResponse;

        invocationManager.handleResponse(response);
        await result.promise;

        expect(invocationManager.isPending(result.invocationId)).toBe(false);
        expect(invocationManager.getPendingCount()).toBe(0);
      }
    });

    it('should return false for unknown invocation', () => {
      const response = createWSMessage('node.rpc.response', {
        invocationId: 'unknown-invocation',
        result: {},
        duration: 0,
      }) as NodeRpcResponse;

      const handled = invocationManager.handleResponse(response);
      expect(handled).toBe(false);
    });
  });

  describe('handleError', () => {
    it('should resolve with error response when node sends error', async () => {
      const result = invocationManager.startInvocation(
        'node-1',
        'caller-1',
        'req-1',
        'cap',
        {},
      );

      if (result.ok) {
        trackPromise(result.promise);

        const error = createWSMessage('node.rpc.error', {
          invocationId: result.invocationId,
          error: {
            code: 'capability_failed',
            message: 'Capability execution failed',
          },
        }) as NodeRpcError;

        const handled = invocationManager.handleError(error);
        expect(handled).toBe(true);

        const responseResult = await result.promise;
        expect(responseResult.type).toBe('error');
      }
    });

    it('should clean up after error', async () => {
      const result = invocationManager.startInvocation(
        'node-1',
        'caller-1',
        'req-1',
        'cap',
        {},
      );

      if (result.ok) {
        trackPromise(result.promise);

        const error = createWSMessage('node.rpc.error', {
          invocationId: result.invocationId,
          error: { code: 'test_error', message: 'Test' },
        }) as NodeRpcError;

        invocationManager.handleError(error);
        await result.promise;

        expect(invocationManager.isPending(result.invocationId)).toBe(false);
      }
    });
  });

  describe('timeout handling', () => {
    it('should timeout after specified duration', async () => {
      const result = invocationManager.startInvocation(
        'node-1',
        'caller-1',
        'req-1',
        'cap',
        {},
        5000,
      );

      expect(result.ok).toBe(true);

      if (result.ok) {
        trackPromise(result.promise);

        // Advance time past timeout
        vi.advanceTimersByTime(5001);

        // Promise should resolve with timeout error
        const responseResult = await result.promise;
        expect(responseResult.type).toBe('error');
        if (responseResult.type === 'error') {
          expect(responseResult.payload.error.code).toBe(WS_ERROR_CODES.SERVICE_UNAVAILABLE);
          expect(responseResult.payload.error.message).toContain('timed out');
        }
      }
    });

    it('should clean up after timeout', async () => {
      const result = invocationManager.startInvocation(
        'node-1',
        'caller-1',
        'req-1',
        'cap',
        {},
        5000,
      );

      if (result.ok) {
        trackPromise(result.promise);

        vi.advanceTimersByTime(5001);
        await result.promise;

        expect(invocationManager.getPendingCount()).toBe(0);
        expect(invocationManager.getNodePendingCount('node-1')).toBe(0);
        expect(invocationManager.getCallerPendingCount('caller-1')).toBe(0);
      }
    });

    it('should cancel timeout if response arrives first', async () => {
      const result = invocationManager.startInvocation(
        'node-1',
        'caller-1',
        'req-1',
        'cap',
        {},
        5000,
      );

      if (result.ok) {
        trackPromise(result.promise);

        // Advance time but not past timeout
        vi.advanceTimersByTime(2000);

        // Send response
        const response = createWSMessage('node.rpc.response', {
          invocationId: result.invocationId,
          result: { data: 'ok' },
          duration: 0,
        }) as NodeRpcResponse;

        invocationManager.handleResponse(response);
        const responseResult = await result.promise;

        // Advance past original timeout - should not cause issues
        vi.advanceTimersByTime(4000);

        expect(responseResult.type).toBe('node.invoke');
        expect(invocationManager.getPendingCount()).toBe(0);
      }
    });
  });

  describe('failInvocation', () => {
    it('should fail an invocation with custom error', async () => {
      const result = invocationManager.startInvocation(
        'node-1',
        'caller-1',
        'req-1',
        'cap',
        {},
      );

      if (result.ok) {
        trackPromise(result.promise);

        const failed = invocationManager.failInvocation(
          result.invocationId,
          WS_ERROR_CODES.NOT_FOUND,
          'Node not found',
        );

        expect(failed).toBe(true);

        const responseResult = await result.promise;
        expect(responseResult.type).toBe('error');
        if (responseResult.type === 'error') {
          expect(responseResult.payload.error.code).toBe(WS_ERROR_CODES.NOT_FOUND);
        }
      }
    });

    it('should return false for unknown invocation', () => {
      const failed = invocationManager.failInvocation(
        'unknown-id',
        WS_ERROR_CODES.NOT_FOUND,
        'Not found',
      );

      expect(failed).toBe(false);
    });
  });

  describe('cleanupCallerConnection', () => {
    it('should clean up all invocations for a caller', () => {
      const r1 = invocationManager.startInvocation('node-1', 'caller-1', 'req-1', 'cap', {});
      const r2 = invocationManager.startInvocation('node-2', 'caller-1', 'req-2', 'cap', {});
      const r3 = invocationManager.startInvocation('node-3', 'caller-2', 'req-3', 'cap', {});
      
      if (r1.ok) trackPromise(r1.promise);
      if (r2.ok) trackPromise(r2.promise);
      if (r3.ok) trackPromise(r3.promise);

      const count = invocationManager.cleanupCallerConnection('caller-1');

      expect(count).toBe(2);
      expect(invocationManager.getCallerPendingCount('caller-1')).toBe(0);
      expect(invocationManager.getPendingCount()).toBe(1); // caller-2's invocation
    });

    it('should return 0 if caller has no invocations', () => {
      const count = invocationManager.cleanupCallerConnection('unknown-caller');
      expect(count).toBe(0);
    });
  });

  describe('failNodeInvocations', () => {
    it('should fail all invocations for a node', async () => {
      const result1 = invocationManager.startInvocation('node-1', 'caller-1', 'req-1', 'cap', {});
      const result2 = invocationManager.startInvocation('node-1', 'caller-2', 'req-2', 'cap', {});
      const result3 = invocationManager.startInvocation('node-2', 'caller-3', 'req-3', 'cap', {});
      
      if (result1.ok) trackPromise(result1.promise);
      if (result2.ok) trackPromise(result2.promise);
      if (result3.ok) trackPromise(result3.promise);

      const count = invocationManager.failNodeInvocations('node-1', 'Node disconnected');

      expect(count).toBe(2);
      expect(invocationManager.getNodePendingCount('node-1')).toBe(0);
      expect(invocationManager.getPendingCount()).toBe(1); // node-2's invocation

      // Check that the promises resolve with error
      if (result1.ok) {
        const res = await result1.promise;
        expect(res.type).toBe('error');
      }
      if (result2.ok) {
        const res = await result2.promise;
        expect(res.type).toBe('error');
      }
    });

    it('should return 0 if node has no invocations', () => {
      const count = invocationManager.failNodeInvocations('unknown-node');
      expect(count).toBe(0);
    });
  });

  describe('clear', () => {
    it('should clear all pending invocations', async () => {
      const result1 = invocationManager.startInvocation('node-1', 'caller-1', 'req-1', 'cap', {});
      const result2 = invocationManager.startInvocation('node-2', 'caller-2', 'req-2', 'cap', {});
      
      if (result1.ok) trackPromise(result1.promise);
      if (result2.ok) trackPromise(result2.promise);

      invocationManager.clear();

      expect(invocationManager.getPendingCount()).toBe(0);
      expect(invocationManager.getNodePendingCount('node-1')).toBe(0);
      expect(invocationManager.getCallerPendingCount('caller-1')).toBe(0);
    });
  });
});
