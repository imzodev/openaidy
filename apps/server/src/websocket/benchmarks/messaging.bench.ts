/**
 * Messaging Benchmarks
 *
 * Performance benchmarks for WebSocket message operations.
 */

import { describe, bench, beforeAll } from 'vitest';
import { MessageRouter } from '../message-router';
import { createWSMessage } from '@openaidy/shared-types';
import type { FastifyBaseLogger } from 'fastify';

// ============================================================================
// Mock Factories
// ============================================================================

const createMockLogger = (): FastifyBaseLogger => ({
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
  fatal: () => {},
  trace: () => {},
  child: () => createMockLogger(),
  level: 'info',
  silent: false,
} as unknown as FastifyBaseLogger);

// ============================================================================
// Benchmarks
// ============================================================================

describe('Messaging Benchmarks', () => {
  let router: MessageRouter;
  let mockLogger: FastifyBaseLogger;

  beforeAll(() => {
    mockLogger = createMockLogger();
    router = new MessageRouter(mockLogger);
  });

  bench('create request ID', () => {
    router.createRequestId();
  });

  bench('register handler', () => {
    router.registerHandler('test.bench', async () => {
      return createWSMessage('test.response', { ok: true });
    });
  });

  bench('hasHandler check', () => {
    router.hasHandler('test.bench');
  });

  bench('getHandlerTypes', () => {
    router.getHandlerTypes();
  });

  bench('canRoute check', () => {
    router.canRoute({
      id: '1',
      type: 'test.bench',
      timestamp: new Date().toISOString(),
      payload: {},
    });
  });

  bench('track and clear pending request', async () => {
    const requestId = router.createRequestId();
    const promise = router.trackRequest(requestId, 'conn_bench');
    router.clearPendingRequests('conn_bench');
    try {
      await promise;
    } catch {
      // Expected - connection closed
    }
  });
});
