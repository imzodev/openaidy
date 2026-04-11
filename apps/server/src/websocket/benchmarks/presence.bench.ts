/**
 * Presence Manager Benchmarks
 *
 * Performance benchmarks for presence tracking operations.
 */

import { describe, bench, beforeAll, afterAll } from 'vitest';
import { PresenceManager } from '../presence-manager';
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

describe('Presence Manager Benchmarks', () => {
  let manager: PresenceManager;
  let mockLogger: FastifyBaseLogger;

  beforeAll(() => {
    mockLogger = createMockLogger();
    manager = new PresenceManager({}, mockLogger);
  });

  afterAll(() => {
    manager.clear();
  });

  bench('update presence', () => {
    const connId = `conn_bench_${Date.now()}_${Math.random()}`;
    manager.updatePresence(connId, 'online');
  });

  bench('update presence with client ID', () => {
    const connId = `conn_bench_client_${Date.now()}_${Math.random()}`;
    manager.updatePresence(connId, 'online', { clientId: 'client_123' });
  });

  bench('update presence with metadata', () => {
    const connId = `conn_bench_meta_${Date.now()}_${Math.random()}`;
    manager.updatePresence(connId, 'online', {
      metadata: {
        device: 'iPhone',
        appVersion: '1.0.0',
        location: 'Berlin',
      },
    });
  });

  bench('get all presence', () => {
    manager.getAllPresence();
  });

  bench('get presence by status', () => {
    manager.getPresenceByStatus('online');
  });

  bench('update presence 100 times', () => {
    const connId = 'conn_bench_100';
    for (let i = 0; i < 100; i++) {
      manager.updatePresence(connId, 'online');
    }
  });

  bench('subscribe to presence', () => {
    const connId = `conn_bench_sub_${Date.now()}_${Math.random()}`;
    manager.subscribe(connId);
  });

  bench('subscribe and unsubscribe', () => {
    const connId = `conn_bench_sub_${Date.now()}_${Math.random()}`;
    manager.subscribe(connId);
    manager.unsubscribe(connId);
  });

  bench('get subscribers', () => {
    manager.getSubscribers();
  });

  bench('check if subscribed', () => {
    const connId = 'conn_bench_check';
    manager.isSubscribed(connId);
  });

  bench('find online clients', () => {
    manager.findOnlineClients();
  });

  bench('find clients by status', () => {
    manager.findClientsByStatus('online');
  });

  bench('get client presence', () => {
    const clientId = 'client_bench';
    manager.getClientPresence(clientId);
  });

  bench('clear all presence', () => {
    const tempManager = new PresenceManager({}, mockLogger);
    for (let i = 0; i < 100; i++) {
      tempManager.updatePresence(`conn_${i}`, 'online');
    }
    tempManager.clear();
  });

  bench('remove connection', () => {
    const connId = `conn_bench_remove_${Date.now()}_${Math.random()}`;
    manager.updatePresence(connId, 'online');
    manager.removeConnection(connId);
  });
});
