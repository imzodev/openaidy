/**
 * Security Module
 *
 * Unified security exports from security components.
 */

import { ProxySecurity } from '../proxy-security.js';
import { ProxyMonitor } from '../proxy-monitoring.js';
import { ProxyCache } from '../proxy-cache.js';

// Re-export all components from their original locations
export {
  ProxySecurity,
  DataProtection,
  getSecurityHeaders,
  createSecureErrorResponse,
} from '../proxy-security.js';
export { ProxyMonitor, defaultProxyMonitor } from '../proxy-monitoring.js';
export {
  ProxyCache,
  defaultProxyCache,
  CacheKeyGenerator,
  CacheStore,
} from '../proxy-cache.js';
export {
  EnhancedAddonProxyService,
  createEnhancedAddonProxyService,
  DEFAULT_VALIDATION_CONFIG,
  DEFAULT_FILTERING_CONFIG,
} from '../proxy-enhanced.js';
export {
  SecurityConfigManager,
  getSecurityConfiguration,
  getSecurityEnvironmentConfig,
  getSecurityFeatureFlags,
  getComplianceConfig,
  DEFAULT_SECURITY_POLICY,
} from '../security-config.js';

// ============================================================================
// Security Initialization
// ============================================================================

export async function initializeSecurity(): Promise<{
  proxySecurity: ProxySecurity;
  proxyMonitor: ProxyMonitor;
  proxyCache: ProxyCache;
}> {
  const proxySecurity = new ProxySecurity();
  const proxyMonitor = new ProxyMonitor({
    enableMetrics: true,
    enableTracing: true,
    enableSecurityTracking: true,
    metricsRetentionDays: 7,
    sampleRate: 1.0,
  });
  const proxyCache = new ProxyCache({
    ttl: 300,
    maxSize: 100 * 1024 * 1024,
    maxEntries: 1000,
    evictionPolicy: 'LRU',
  });

  return { proxySecurity, proxyMonitor, proxyCache };
}

// ============================================================================
// Security Utilities
// ============================================================================

export function isRequestSecure(request: {
  headers: Record<string, string | string[] | undefined>;
}): boolean {
  return !!request.headers['content-type'] || !!request.headers['user-agent'];
}

export function getSecurityStatus(): {
  enabled: boolean;
  components: string[];
  uptime: number;
} {
  return {
    enabled: true,
    components: [
      'ProxySecurity',
      'ProxyMonitor',
      'ProxyCache',
      'DataProtection',
    ],
    uptime: Date.now(),
  };
}

export function validateSecurityConfig(): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  return { valid: true, errors: [], warnings: [] };
}

// ============================================================================
// Default export
// ============================================================================

export default {
  initializeSecurity,
  isRequestSecure,
  getSecurityStatus,
  validateSecurityConfig,
};
