/**
 * Proxy Enhanced Tests
 *
 * Unit tests for the enhanced proxy service.
 */

import { describe, it, expect, vi } from 'vitest';

// Mock all dependencies
vi.mock('./proxy', () => ({
  createAddonProxyService: vi.fn(() => ({
    authorize: vi.fn().mockReturnValue({ authorized: true }),
    validateToken: vi.fn().mockResolvedValue({
      valid: true,
      addonId: 'mock-addon',
      permissions: ['agents.invoke', 'sessions.read'],
    }),
    hasAgentAccess: vi.fn().mockReturnValue(true),
    recordUsage: vi.fn(),
  })),
  AddonProxyService: vi.fn(),
}));

vi.mock('./proxy-security', () => ({
  ProxySecurity: vi.fn(() => ({
    detectThreats: vi
      .fn()
      .mockReturnValue({ isBlocked: false, threats: [], score: 0 }),
    recordSecurityEvent: vi.fn(),
    getSecurityMetrics: vi.fn().mockReturnValue({
      totalEvents: 0,
      blockedRequests: 0,
      topThreatTypes: [],
      blockedIPs: 0,
    }),
  })),
  DataProtection: vi.fn(() => ({
    redactSensitiveData: vi.fn((data) => data),
  })),
  getSecurityHeaders: vi.fn(() => ({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  })),
  createSecureErrorResponse: vi.fn((error, message, requestId, retryable) => ({
    error,
    message,
    requestId,
    retryable,
    timestamp: new Date().toISOString(),
  })),
}));

vi.mock('./proxy-monitoring', () => ({
  ProxyMonitor: vi.fn(() => ({
    generateRequestId: vi.fn(() => 'req_test_123'),
    startRequest: vi.fn(),
    endRequest: vi.fn(() => 50),
    recordEvent: vi.fn(),
    getPerformanceMetrics: vi.fn(() => ({
      avgLatencyMs: 50,
      requestsPerSecond: 100,
    })),
    getSecurityMetrics: vi.fn(() => ({
      totalRequests: 100,
      blockedRequests: 5,
    })),
  })),
  defaultProxyMonitor: {
    generateRequestId: () => 'req_default_123',
    startRequest: vi.fn(),
    endRequest: vi.fn(() => 10),
    getPerformanceMetrics: vi.fn(() => ({ avgLatencyMs: 10 })),
  },
}));

vi.mock('./proxy-cache', () => ({
  ProxyCache: vi.fn(() => ({
    isCacheable: vi.fn((req) => req.method === 'GET'),
    get: vi.fn(() => ({ cached: false, value: null, fromCache: false })),
    set: vi.fn(),
    getStats: vi.fn(() => ({ hits: 0, misses: 0, hitRate: 0 })),
  })),
  defaultProxyCache: {
    isCacheable: vi.fn(() => false),
    get: vi.fn(() => ({ cached: false })),
    set: vi.fn(),
  },
}));

// Import after mocking
import {
  DEFAULT_VALIDATION_CONFIG,
  DEFAULT_FILTERING_CONFIG,
} from './proxy-enhanced';

// ============================================================================
// Default Configuration Tests
// ============================================================================

describe('Default Configuration', () => {
  describe('DEFAULT_VALIDATION_CONFIG', () => {
    it('should have correct max request size', () => {
      expect(DEFAULT_VALIDATION_CONFIG.maxRequestSize).toBe(10 * 1024 * 1024);
    });

    it('should allow JSON content type', () => {
      expect(DEFAULT_VALIDATION_CONFIG.allowedContentTypes).toContain(
        'application/json',
      );
    });

    it('should have correct max URL length', () => {
      expect(DEFAULT_VALIDATION_CONFIG.maxUrlLength).toBe(8192);
    });

    it('should enable input sanitization by default', () => {
      expect(DEFAULT_VALIDATION_CONFIG.sanitizeInput).toBe(true);
    });
  });

  describe('DEFAULT_FILTERING_CONFIG', () => {
    it('should enable PII redaction by default', () => {
      expect(DEFAULT_FILTERING_CONFIG.redactSensitiveData).toBe(true);
    });

    it('should have correct max response size', () => {
      expect(DEFAULT_FILTERING_CONFIG.maxResponseSize).toBe(10 * 1024 * 1024);
    });

    it('should enable compression by default', () => {
      expect(DEFAULT_FILTERING_CONFIG.compressionEnabled).toBe(true);
    });

    it('should have allowed headers configured', () => {
      expect(DEFAULT_FILTERING_CONFIG.allowedHeaders).toContain('Content-Type');
      expect(DEFAULT_FILTERING_CONFIG.allowedHeaders).toContain(
        'Authorization',
      );
    });
  });
});
