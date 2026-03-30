/**
 * Connection Benchmarks
 *
 * Performance benchmarks for WebSocket connection operations.
 */

import { describe, bench, beforeAll, afterAll } from 'vitest';
import { ConnectionManager } from '../connection-manager';
import { defaultWebSocketConfig } from '../types';

// ============================================================================
// Benchmarks
// ============================================================================

describe('Connection Benchmarks', () => {
  let connectionManager: ConnectionManager;

  beforeAll(() => {
    connectionManager = new ConnectionManager(defaultWebSocketConfig);
  });

  afterAll(() => {
    connectionManager.closeAll();
  });

  bench('register single connection', () => {
    const id = `conn_bench_${Date.now()}_${Math.random()}`;
    connectionManager.registerConnection(id);
  });

  bench('register and remove connection', () => {
    const id = `conn_bench_${Date.now()}_${Math.random()}`;
    connectionManager.registerConnection(id);
    connectionManager.removeConnection(id);
  });

  bench('register 100 connections', () => {
    const baseId = `conn_bench_${Date.now()}`;
    for (let i = 0; i < 100; i++) {
      connectionManager.registerConnection(`${baseId}_${i}`);
    }
  });

  bench('update heartbeat', () => {
    const id = 'conn_bench_heartbeat';
    connectionManager.registerConnection(id);
    connectionManager.updateHeartbeat(id);
  });

  bench('check rate limit', () => {
    const id = 'conn_bench_ratelimit';
    connectionManager.registerConnection(id);
    connectionManager.checkRateLimit(id);
  });

  bench('get connection count', () => {
    connectionManager.getConnectionCount();
  });

  bench('get connection', () => {
    const id = 'conn_bench_get';
    connectionManager.registerConnection(id);
    connectionManager.getConnection(id);
  });

  bench('close all connections', () => {
    const tempManager = new ConnectionManager(defaultWebSocketConfig);
    for (let i = 0; i < 100; i++) {
      tempManager.registerConnection(`conn_${i}`);
    }
    tempManager.closeAll();
  });
});
