/**
 * Security Module Tests
 *
 * Tests for the unified security module exports and initialization.
 */

import { describe, it, expect } from 'vitest';
import {
  initializeSecurity,
  isRequestSecure,
  getSecurityStatus,
  validateSecurityConfig,
  ProxySecurity,
  ProxyMonitor,
  ProxyCache,
  SecurityConfigManager,
  getSecurityConfiguration,
  getSecurityEnvironmentConfig,
  getSecurityFeatureFlags,
  DEFAULT_SECURITY_POLICY,
} from './index.js';

describe('Security Module', () => {
  describe('initializeSecurity', () => {
    it('should initialize all security components', async () => {
      const result = await initializeSecurity();

      expect(result).toHaveProperty('proxySecurity');
      expect(result).toHaveProperty('proxyMonitor');
      expect(result).toHaveProperty('proxyCache');
      expect(result.proxySecurity).toBeInstanceOf(ProxySecurity);
      expect(result.proxyMonitor).toBeInstanceOf(ProxyMonitor);
      expect(result.proxyCache).toBeInstanceOf(ProxyCache);
    });
  });

  describe('isRequestSecure', () => {
    it('should return true for requests with content-type header', () => {
      const request = { headers: { 'content-type': 'application/json' } };
      expect(isRequestSecure(request)).toBe(true);
    });

    it('should return true for requests with user-agent header', () => {
      const request = { headers: { 'user-agent': 'Mozilla/5.0' } };
      expect(isRequestSecure(request)).toBe(true);
    });

    it('should return false for empty headers', () => {
      const request = { headers: {} };
      expect(isRequestSecure(request)).toBe(false);
    });
  });

  describe('getSecurityStatus', () => {
    it('should return security status', () => {
      const status = getSecurityStatus();

      expect(status).toHaveProperty('enabled');
      expect(status).toHaveProperty('components');
      expect(status).toHaveProperty('uptime');
      expect(status.enabled).toBe(true);
      expect(Array.isArray(status.components)).toBe(true);
    });
  });

  describe('validateSecurityConfig', () => {
    it('should validate the security configuration', () => {
      const result = validateSecurityConfig();

      expect(result).toHaveProperty('valid');
      expect(result).toHaveProperty('errors');
      expect(result).toHaveProperty('warnings');
      expect(result.valid).toBe(true);
      expect(Array.isArray(result.errors)).toBe(true);
      expect(Array.isArray(result.warnings)).toBe(true);
    });
  });

  describe('Security Configuration', () => {
    it('should get environment config', () => {
      const config = getSecurityEnvironmentConfig();
      expect(config).toHaveProperty('level');
      expect(config).toHaveProperty('debug');
      expect(config).toHaveProperty('auditMode');
    });

    it('should get feature flags', () => {
      const flags = getSecurityFeatureFlags();
      expect(flags).toHaveProperty('enhancedProxy');
      expect(flags).toHaveProperty('rateLimiting');
      expect(flags).toHaveProperty('auditLogging');
    });

    it('should get default security policy', () => {
      expect(DEFAULT_SECURITY_POLICY).toBeDefined();
      expect(DEFAULT_SECURITY_POLICY).toHaveProperty('maxUrlLength');
    });
  });

  describe('SecurityConfigManager', () => {
    it('should create a security config manager instance', () => {
      const manager = new SecurityConfigManager();
      expect(manager).toBeDefined();
    });

    it('should get security configuration', () => {
      const config = getSecurityConfiguration();
      expect(config).toHaveProperty('policy');
      expect(config).toHaveProperty('environment');
    });
  });
});
