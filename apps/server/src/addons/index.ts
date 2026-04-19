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

// Routes
// Note: Routes are exported from the routes directory directly
// import { addonRoutes, type AddonRoutesOptions } from '../routes/addons';
// import { addonProxyRoutes, type AddonProxyRoutesOptions } from '../routes/proxy-routes';
