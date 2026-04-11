/**
 * Subscription Benchmarks
 *
 * Performance benchmarks for WebSocket subscription operations.
 */

import { describe, bench, beforeAll, afterAll } from 'vitest';
import { SubscriptionManager } from '../subscriptions';
import type { FastifyBaseLogger } from 'fastify';

// ============================================================================
// Mock Logger
// ============================================================================

const createMockLogger = (): FastifyBaseLogger =>
  ({
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
    fatal: () => {},
    trace: () => {},
    child: () => createMockLogger(),
    level: 'info',
    silent: false,
  }) as unknown as FastifyBaseLogger;

// ============================================================================
// Benchmarks
// ============================================================================

describe('Subscription Benchmarks', () => {
  let manager: SubscriptionManager;
  let mockLogger: FastifyBaseLogger;

  beforeAll(() => {
    mockLogger = createMockLogger();
    // SubscriptionManager requires connectionManager, logger, and options
    // For benchmarks, we create a minimal mock connection manager
    const mockConnectionManager = {
      broadcast: () => 0,
      getConnections: () => [],
      send: async () => {},
    } as unknown as import('../connection-manager').ConnectionManager;
    manager = new SubscriptionManager(mockConnectionManager, mockLogger, {});
  });

  afterAll(() => {
    manager.cleanup();
  });

  bench('add single subscription', () => {
    const subId = `sub_bench_${Date.now()}_${Math.random()}`;
    manager.createSubscription('conn_bench', subId, []);
  });

  bench('add and remove subscription', () => {
    const subId = `sub_bench_${Date.now()}_${Math.random()}`;
    manager.createSubscription('conn_bench', subId, []);
    manager.removeSubscription(subId);
  });

  bench('add 10 subscriptions to same connection', () => {
    const baseId = `sub_bench_10_${Date.now()}`;
    for (let i = 0; i < 10; i++) {
      manager.createSubscription('conn_bench', `${baseId}_${i}`, []);
    }
  });

  bench('get connection subscriptions', () => {
    const baseId = 'sub_bench_get';
    for (let i = 0; i < 5; i++) {
      manager.createSubscription('conn_bench', `${baseId}_${i}`, []);
    }
    manager.getConnectionSubscriptions('conn_bench');
  });

  bench('get session subscriptions', () => {
    const subId = 'session_bench_get';
    manager.createSubscription('conn_bench', subId, []);
    manager.getSessionSubscriptions(subId);
  });

  bench('remove connection subscriptions', () => {
    const connId = `conn_bench_remove_${Date.now()}_${Math.random()}`;
    for (let i = 0; i < 10; i++) {
      manager.createSubscription(connId, `sub_${i}`, []);
    }
    manager.removeConnectionSubscriptions(connId);
  });

  bench('get subscription count', () => {
    manager.getSubscriptionCount();
  });

  bench('get connection subscription count', () => {
    manager.getConnectionSubscriptionCount('conn_bench');
  });

  bench('get session subscription count', () => {
    manager.getSessionSubscriptionCount('session_bench');
  });

  bench('broadcast to session', () => {
    const sessionId = 'session_bench_broadcast';
    manager.createSubscription('conn_bench', sessionId, []);
    // Broadcast without actual send (just measure iteration)
    let count = 0;
    for (const _sub of manager.getSessionSubscriptions(sessionId)) {
      count++;
    }
    void count; // Use the value
  });

  bench('cleanup', () => {
    const mockConnectionManager = {
      broadcast: () => 0,
      getConnections: () => [],
      send: async () => {},
    } as unknown as import('../connection-manager').ConnectionManager;
    const tempManager = new SubscriptionManager(
      mockConnectionManager,
      mockLogger,
      {},
    );
    for (let i = 0; i < 100; i++) {
      tempManager.createSubscription(`conn_${i}`, `sub_${i}`, []);
    }
    tempManager.cleanup();
  });
});
