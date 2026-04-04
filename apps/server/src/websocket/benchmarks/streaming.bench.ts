/**
 * Streaming Benchmarks
 *
 * Performance benchmarks for WebSocket streaming operations.
 */

import { describe, bench, beforeAll, afterAll } from 'vitest';
import { StreamManager } from '../streaming';
import { RunEventEmitter } from '../../dispatch/events';
import { ConnectionManager } from '../connection-manager';
import { defaultWebSocketConfig } from '../types';
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

describe('Streaming Benchmarks', () => {
  let streamManager: StreamManager;
  let runEvents: RunEventEmitter;
  let connectionManager: ConnectionManager;
  let mockLogger: FastifyBaseLogger;

  beforeAll(() => {
    mockLogger = createMockLogger();

    runEvents = new RunEventEmitter();
    connectionManager = new ConnectionManager(defaultWebSocketConfig);

    streamManager = new StreamManager(
      runEvents,
      connectionManager,
      mockLogger,
    );

    streamManager.start();
  });

  afterAll(() => {
    streamManager.stop();
    connectionManager.closeAll();
  });

  bench('subscribe to run', () => {
    const runId = `run_bench_${Date.now()}_${Math.random()}`;
    streamManager.subscribeToRun(runId, 'conn_bench');
  });

  bench('subscribe and unsubscribe from run', () => {
    const runId = `run_bench_${Date.now()}_${Math.random()}`;
    streamManager.subscribeToRun(runId, 'conn_bench');
    streamManager.unsubscribeFromRun(runId, 'conn_bench');
  });

  bench('get run subscription count', () => {
    const runId = 'run_bench_count';
    streamManager.subscribeToRun(runId, 'conn_bench');
    streamManager.getRunSubscriptionCount(runId);
  });

  bench('unsubscribe all from connection', () => {
    const connId = `conn_bench_${Date.now()}_${Math.random()}`;
    streamManager.subscribeToRun('run_1', connId);
    streamManager.subscribeToRun('run_2', connId);
    streamManager.unsubscribeAllFromConnection(connId);
  });

  bench('get connection subscription count', () => {
    const connId = 'conn_bench_conn_count';
    streamManager.subscribeToRun('run_count', connId);
    streamManager.getConnectionSubscriptionCount(connId);
  });

  bench('get total subscription count', () => {
    streamManager.getTotalSubscriptionCount();
  });

  bench('subscribe 10 connections to same run', () => {
    const runId = `run_bench_10_${Date.now()}`;
    for (let i = 0; i < 10; i++) {
      streamManager.subscribeToRun(runId, `conn_bench_${i}`);
    }
  });

  bench('broadcast delta event (mock)', () => {
    // This measures the overhead of iterating subscribers
    const runId = 'run_bench_broadcast';
    for (let i = 0; i < 10; i++) {
      streamManager.subscribeToRun(runId, `conn_bench_bc_${i}`);
    }
    // In real scenario, this would send to each subscriber
    const count = streamManager.getRunSubscriptionCount(runId);
    count; // Use the value
  });
});
