/**
 * Node Registry Benchmarks
 *
 * Performance benchmarks for node registration and lookup operations.
 */

import { describe, bench, beforeAll, afterAll } from 'vitest';
import { NodeRegistry } from '../node-registry';
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

describe('Node Registry Benchmarks', () => {
  let registry: NodeRegistry;
  let mockLogger: FastifyBaseLogger;

  beforeAll(() => {
    mockLogger = createMockLogger();
    registry = new NodeRegistry({}, mockLogger);
  });

  afterAll(() => {
    registry.clear();
  });

  bench('register single node', () => {
    const nodeId = `node_bench_${Date.now()}_${Math.random()}`;
    registry.registerNode({
      nodeId,
      name: 'Benchmark Node',
      type: 'mobile',
      status: 'online',
      capabilities: ['camera', 'microphone'],
      connectionId: 'conn_bench',
      metadata: {},
      registeredAt: Date.now(),
      lastSeen: Date.now(),
    });
  });

  bench('register and unregister node', () => {
    const nodeId = `node_bench_${Date.now()}_${Math.random()}`;
    registry.registerNode({
      nodeId,
      name: 'Benchmark Node',
      type: 'mobile',
      status: 'online',
      capabilities: ['camera'],
      connectionId: 'conn_bench',
      metadata: {},
      registeredAt: Date.now(),
      lastSeen: Date.now(),
    });
    registry.unregisterNode(nodeId);
  });

  bench('register 100 nodes', () => {
    const baseId = `node_bench_100_${Date.now()}`;
    for (let i = 0; i < 100; i++) {
      registry.registerNode({
        nodeId: `${baseId}_${i}`,
        name: `Node ${i}`,
        type: 'mobile',
        status: 'online',
        capabilities: ['camera'],
        connectionId: `conn_${i}`,
        metadata: {},
        registeredAt: Date.now(),
        lastSeen: Date.now(),
      });
    }
  });

  bench('get node by ID', () => {
    registry.registerNode({
      nodeId: 'node_bench_get',
      name: 'Benchmark Node',
      type: 'mobile',
      status: 'online',
      capabilities: ['camera'],
      connectionId: 'conn_bench',
      metadata: {},
      registeredAt: Date.now(),
      lastSeen: Date.now(),
    });
    registry.getAllNodes().find(n => n.nodeId === 'node_bench_get');
  });

  bench('get all nodes', () => {
    registry.getAllNodes();
  });

  bench('get online nodes', () => {
    registry.getOnlineNodes();
  });

  bench('find nodes by capability', () => {
    registry.registerNode({
      nodeId: 'node_bench_cap',
      name: 'Benchmark Node',
      type: 'mobile',
      status: 'online',
      capabilities: ['camera', 'microphone'],
      connectionId: 'conn_bench',
      metadata: {},
      registeredAt: Date.now(),
      lastSeen: Date.now(),
    });
    registry.findNodesByCapability('camera');
  });

  bench('update last seen', () => {
    registry.registerNode({
      nodeId: 'node_bench_seen',
      name: 'Benchmark Node',
      type: 'mobile',
      status: 'online',
      capabilities: ['camera'],
      connectionId: 'conn_bench',
      metadata: {},
      registeredAt: Date.now(),
      lastSeen: Date.now(),
    });
    registry.updateLastSeen('node_bench_seen');
  });

  bench('mark offline', () => {
    registry.registerNode({
      nodeId: 'node_bench_offline',
      name: 'Benchmark Node',
      type: 'mobile',
      status: 'online',
      capabilities: ['camera'],
      connectionId: 'conn_bench',
      metadata: {},
      registeredAt: Date.now(),
      lastSeen: Date.now(),
    });
    registry.markOffline('node_bench_offline');
  });

  bench('find nodes by type', () => {
    registry.findNodesByType('mobile');
  });

  bench('clear all nodes', () => {
    const tempRegistry = new NodeRegistry({}, mockLogger);
    for (let i = 0; i < 100; i++) {
      tempRegistry.registerNode({
        nodeId: `node_${i}`,
        name: `Node ${i}`,
        type: 'mobile',
        status: 'online',
        capabilities: [],
        connectionId: `conn_${i}`,
        metadata: {},
        registeredAt: Date.now(),
        lastSeen: Date.now(),
      });
    }
    tempRegistry.clear();
  });
});
