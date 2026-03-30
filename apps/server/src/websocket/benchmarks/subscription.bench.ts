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

describe('Subscription Benchmarks', () => {
  let manager: SubscriptionManager;
  let mockLogger: FastifyBaseLogger;

  beforeAll(() => {
    mockLogger = createMockLogger();
    manager = new SubscriptionManager({ logger: mockLogger });
  });

  afterAll(() => {
    manager.cleanup();
  });

  bench('add single subscription', () => {
    const subId = `sub_bench_${Date.now()}_${Math.random()}`;
    manager.addSubscription('conn_bench', subId, {
      connectionId: 'conn_bench',
      sessionId: subId,
      createdAt: Date.now(),
    });
  });

  bench('add and remove subscription', () => {
    const subId = `sub_bench_${Date.now()}_${Math.random()}`;
    manager.addSubscription('conn_bench', subId, {
      connectionId: 'conn_bench',
      sessionId: subId,
      createdAt: Date.now(),
    });
    manager.removeSubscription(subId);
  });

  bench('add 10 subscriptions to same connection', () => {
    const baseId = `sub_bench_10_${Date.now()}`;
    for (let i = 0; i < 10; i++) {
      manager.addSubscription('conn_bench', `${baseId}_${i}`, {
        connectionId: 'conn_bench',
        sessionId: `${baseId}_${i}`,
        createdAt: Date.now(),
      });
    }
  });

  bench('get connection subscriptions', () => {
    const baseId = 'sub_bench_get';
    for (let i = 0; i < 5; i++) {
      manager.addSubscription('conn_bench', `${baseId}_${i}`, {
        connectionId: 'conn_bench',
        sessionId: `${baseId}_${i}`,
        createdAt: Date.now(),
      });
    }
    manager.getConnectionSubscriptions('conn_bench');
  });

  bench('get session subscriptions', () => {
    const subId = 'session_bench_get';
    manager.addSubscription('conn_bench', subId, {
      connectionId: 'conn_bench',
      sessionId: subId,
      createdAt: Date.now(),
    });
    manager.getSessionSubscriptions(subId);
  });

  bench('remove connection subscriptions', () => {
    const connId = `conn_bench_remove_${Date.now()}_${Math.random()}`;
    for (let i = 0; i < 10; i++) {
      manager.addSubscription(connId, `sub_${i}`, {
        connectionId: connId,
        sessionId: `sub_${i}`,
        createdAt: Date.now(),
      });
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
    manager.addSubscription('conn_bench', sessionId, {
      connectionId: 'conn_bench',
      sessionId,
      createdAt: Date.now(),
    });
    // Broadcast without actual send (just measure iteration)
    let count = 0;
    for (const sub of manager.getSessionSubscriptions(sessionId)) {
      count++;
    }
    count; // Use the value
  });

  bench('cleanup', () => {
    const tempManager = new SubscriptionManager({ logger: mockLogger });
    for (let i = 0; i < 100; i++) {
      tempManager.addSubscription(`conn_${i}`, `sub_${i}`, {
        connectionId: `conn_${i}`,
        sessionId: `sub_${i}`,
        createdAt: Date.now(),
      });
    }
    tempManager.cleanup();
  });
});
