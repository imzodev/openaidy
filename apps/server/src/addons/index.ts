/**
 * Addon System - Main Module
 *
 * Central export point for all addon-related functionality.
 */

// Types
export type {
  AddonServiceOptions,
  InstallAddonRequest,
  InstallAddonResult,
  EnableAddonRequest,
  EnableAddonResult,
  DisableAddonRequest,
  UpdateAddonConfigRequest,
  ListAddonsFilters,
} from './types.js';

export { AddonServiceError, AddonErrorCodes } from './types.js';

export {
  createAddonNotFoundError,
  createDuplicateAddonError,
  createInvalidManifestError,
  createInvalidPermissionsError,
  createInvalidConfigError,
} from './types.js';

// Service
export { AddonService, createAddonService } from './service.js';

// Manifest Validator
export {
  ManifestValidator,
  createManifestValidator,
  validateAddonManifest,
} from './manifest-validator.js';

// Proxy
export {
  AddonProxyService,
  createAddonProxyService,
  type ProxyRequest,
  type ProxyResponse,
  type ProxyError,
  type ProxyResult,
} from './proxy.js';

// Security - Proxy Security
export {
  ProxySecurity,
  DataProtection,
  getSecurityHeaders,
  createSecureErrorResponse,
} from './proxy-security.js';

// Security - Proxy Monitoring
export { ProxyMonitor, defaultProxyMonitor } from './proxy-monitoring.js';

// Security - Proxy Cache
export {
  ProxyCache,
  defaultProxyCache,
  CacheKeyGenerator,
  CacheStore,
} from './proxy-cache.js';
export type { CacheConfig, CacheEntry, CacheStats } from './proxy-cache.js';

// Security - Enhanced Proxy
export {
  EnhancedAddonProxyService,
  createEnhancedAddonProxyService,
  DEFAULT_VALIDATION_CONFIG,
  DEFAULT_FILTERING_CONFIG,
} from './proxy-enhanced.js';
export type {
  EnhancedProxyOptions,
  RequestValidationConfig,
  ResponseFilteringConfig,
} from './proxy-enhanced.js';

// Security - Configuration
export {
  SecurityConfigManager,
  getSecurityConfiguration,
  getSecurityEnvironmentConfig,
  getSecurityFeatureFlags,
  getComplianceConfig,
  DEFAULT_SECURITY_POLICY,
} from './security-config.js';
export type {
  SecurityConfiguration,
  SecurityPolicy,
  SecurityFeatureFlags,
  ComplianceProfile,
  ComplianceConfig,
} from './security-config.js';

// Routes
// Note: Routes are exported from the routes directory directly
// import { addonRoutes, type AddonRoutesOptions } from '../routes/addons';
// import { addonProxyRoutes, type AddonProxyRoutesOptions } from '../routes/proxy-routes';
