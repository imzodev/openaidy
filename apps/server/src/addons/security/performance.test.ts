/**
 * Security Performance Tests
 *
 * Tests for performance overhead, load testing, memory usage,
 * and scalability of the addon security system.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { Addon } from '@openaidy/db';
import type { FastifyRequest } from 'fastify';
import { ProxySecurity } from '../proxy-security.js';
import { RateLimiter } from '../rate-limit.js';
import { PermissionChecker } from '../permission.js';
import { ProxyMonitor } from '../proxy-monitoring.js';
import { ProxyCache } from '../proxy-cache.js';
import { SecurityScanner } from '../security-scanner.js';
import { InMemoryAuditLogger, logAddonInstalled } from '../audit-logger.js';

// ============================================================================
// Test Fixtures
// ============================================================================

function createMockAddon(overrides: Partial<Addon> = {}): Addon {
  return {
    id: 'perf-addon-id',
    addonId: 'perf-addon',
    name: 'Perf Addon',
    version: '1.0.0',
    manifest: {
      id: 'perf-addon',
      name: 'Perf Addon',
      version: '1.0.0',
      permissions: [],
      backend: { routes: [] },
    },
    enabled: true,
    installedAt: new Date(),
    installedBy: 'admin',
    permissions: ['sessions.read'],
    ...overrides,
  };
}

// ============================================================================
// Proxy Security Performance Tests
// ============================================================================

describe('Proxy Security Performance', () => {
  let security: ProxySecurity;

  beforeEach(() => {
    security = new ProxySecurity();
  });

  it('should handle rapid threat detection', () => {
    const iterations = 10000;
    const start = Date.now();

    for (let i = 0; i < iterations; i++) {
      const request = {
        url: '/api/test',
        method: 'GET',
        body: undefined,
        headers: { 'content-type': 'application/json' },
      } as FastifyRequest;

      security.detectThreats(request, {
        ip: '192.168.1.1',
        contentLength: 0,
        urlLength: 50,
      });
    }

    const elapsed = Date.now() - start;
    const opsPerSecond = (iterations / elapsed) * 1000;

    expect(opsPerSecond).toBeGreaterThan(1000);
  });

  it('should handle concurrent security events', () => {
    const iterations = 1000;
    const start = Date.now();

    for (let i = 0; i < iterations; i++) {
      security.recordSecurityEvent({
        type: 'INJECTION_ATTEMPT',
        addonId: 'test-addon',
        timestamp: new Date(),
        details: { url: '/api/test' },
        severity: 'high',
        blocked: true,
      });
    }

    const elapsed = Date.now() - start;
    const opsPerSecond = (iterations / elapsed) * 1000;

    expect(opsPerSecond).toBeGreaterThan(500);
  });
});

// ============================================================================
// Rate Limiter Performance Tests
// ============================================================================

describe('Rate Limiter Performance', () => {
  it('should handle high-frequency requests', () => {
    const limiter = new RateLimiter({ limit: 100000, windowMs: 60000 });
    const iterations = 10000;
    const start = Date.now();

    for (let i = 0; i < iterations; i++) {
      limiter.check(`key-${i % 100}`);
    }

    const elapsed = Date.now() - start;
    const opsPerSecond = (iterations / elapsed) * 1000;

    expect(opsPerSecond).toBeGreaterThan(5000);
  });

  it('should meet rate limiting benchmark (<2ms)', () => {
    const limiter = new RateLimiter({ limit: 1000, windowMs: 60000 });

    const iterations = 100;
    const start = Date.now();

    for (let i = 0; i < iterations; i++) {
      limiter.check(`key-${i}`);
    }

    const elapsed = Date.now() - start;
    const avgMs = elapsed / iterations;

    expect(avgMs).toBeLessThan(2);
  });
});

// ============================================================================
// Cache Performance Tests
// ============================================================================

describe('Cache Performance', () => {
  it('should cache and retrieve efficiently', () => {
    const cache = new ProxyCache({ ttl: 300 });

    const start = Date.now();

    for (let i = 0; i < 1000; i++) {
      cache.set(
        { method: 'GET', url: `/api/test/${i}`, headers: {} } as FastifyRequest,
        'addon-1',
        ['sessions.read'],
        { data: `result-${i}` },
      );
    }

    // Retrieve
    for (let i = 0; i < 1000; i++) {
      cache.get(
        { method: 'GET', url: `/api/test/${i}`, headers: {} } as FastifyRequest,
        'addon-1',
        ['sessions.read'],
      );
    }

    const elapsed = Date.now() - start;
    const opsPerSecond = (2000 / elapsed) * 1000;

    expect(opsPerSecond).toBeGreaterThan(1000);
  });

  it('should evict entries efficiently', () => {
    const cache = new ProxyCache({
      ttl: 300,
      maxEntries: 100,
    });

    // Fill beyond capacity
    for (let i = 0; i < 200; i++) {
      cache.set(
        { method: 'GET', url: `/api/test/${i}`, headers: {} } as FastifyRequest,
        'addon-1',
        ['sessions.read'],
        { data: `result-${i}` },
      );
    }

    const start = Date.now();
    const stats = cache.getStats();
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(50);
    expect(stats.entries).toBeLessThanOrEqual(100);
  });

  it('should handle cleanup efficiently', async () => {
    const cache = new ProxyCache({ ttl: 100 });

    // Add entries
    for (let i = 0; i < 100; i++) {
      cache.set(
        { method: 'GET', url: `/api/test/${i}`, headers: {} } as FastifyRequest,
        'addon-1',
        ['sessions.read'],
        { data: `result-${i}` },
      );
    }

    // Wait for expiration
    await new Promise((resolve) => setTimeout(resolve, 150));

    const start = Date.now();
    const cleaned = cache.cleanup();
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(100);
    expect(cleaned).toBe(100);
  });
});

// ============================================================================
// Monitor Performance Tests
// ============================================================================

describe('Monitor Performance', () => {
  it('should handle high-frequency metrics', () => {
    const monitor = new ProxyMonitor({
      enableMetrics: true,
      enableTracing: false,
      enableSecurityTracking: true,
      metricsRetentionDays: 7,
      sampleRate: 1.0,
    });

    const iterations = 10000;
    const start = Date.now();

    for (let i = 0; i < iterations; i++) {
      monitor.recordMetric({
        name: 'test.metric',
        value: Math.random() * 100,
        labels: { addon: 'test-addon' },
      });
    }

    const elapsed = Date.now() - start;
    const opsPerSecond = (iterations / elapsed) * 1000;

    expect(opsPerSecond).toBeGreaterThan(2000);
  });

  it('should generate request IDs efficiently', () => {
    const monitor = new ProxyMonitor({
      enableMetrics: true,
      enableTracing: true,
      enableSecurityTracking: false,
      metricsRetentionDays: 7,
      sampleRate: 1.0,
    });

    const iterations = 10000;
    const start = Date.now();

    for (let i = 0; i < iterations; i++) {
      monitor.generateRequestId();
    }

    const elapsed = Date.now() - start;
    const opsPerSecond = (iterations / elapsed) * 1000;

    expect(opsPerSecond).toBeGreaterThan(5000);
  });
});

// ============================================================================
// Security Scanner Performance Tests
// ============================================================================

describe('Security Scanner Performance', () => {
  it('should scan large codebases efficiently', async () => {
    const scanner = new SecurityScanner();
    const largeCode = 'const x = 1; '.repeat(10000);

    const start = Date.now();
    const result = await scanner.scanCode(largeCode, 'test-addon');
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(1000);
    expect(result.scanDurationMs).toBeLessThan(1000);
  }, 5000);

  it('should handle concurrent scans', async () => {
    const scanner = new SecurityScanner();
    const code = 'eval("malicious code");';

    const start = Date.now();
    await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        scanner.scanCode(code, `addon-${i}`),
      ),
    );
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(5000);
  }, 10000);
});

// ============================================================================
// Audit Logger Performance Tests
// ============================================================================

describe('Audit Logger Performance', () => {
  it('should handle high-frequency logging', () => {
    const logger = new InMemoryAuditLogger(100000);
    const addon = createMockAddon();

    const iterations = 10000;
    const start = Date.now();

    for (let i = 0; i < iterations; i++) {
      logAddonInstalled(logger, addon, 'admin');
    }

    const elapsed = Date.now() - start;
    const opsPerSecond = (iterations / elapsed) * 1000;

    expect(opsPerSecond).toBeGreaterThan(1000);
  });

  it('should meet audit logging benchmark (<3ms)', () => {
    const logger = new InMemoryAuditLogger(100000);
    const addon = createMockAddon();

    const iterations = 100;
    const start = Date.now();

    for (let i = 0; i < iterations; i++) {
      logAddonInstalled(logger, addon, 'admin');
    }

    const elapsed = Date.now() - start;
    const avgMs = elapsed / iterations;

    expect(avgMs).toBeLessThan(3);
  });
});

// ============================================================================
// Permission Checker Performance Tests
// ============================================================================

describe('Permission Checker Performance', () => {
  it('should check permissions efficiently', () => {
    const checker = new PermissionChecker();
    const addon = createMockAddon({ permissions: ['sessions.read'] });

    const iterations = 100;
    const start = Date.now();

    for (let i = 0; i < iterations; i++) {
      checker.check(addon, 'sessions.read');
    }

    const elapsed = Date.now() - start;
    const avgMs = elapsed / iterations;

    expect(avgMs).toBeLessThan(10);
  });
});
