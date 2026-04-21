/**
 * Addon Frontend Module
 *
 * Main entry point for the frontend addon system.
 * Exports all addon-related types, utilities, and initialization functions.
 */

// Re-export all types
export * from '../addon-types';

// Re-export loader
export { AddonLoader } from '../addon-loader';

// Re-export runtime API
export * from '../addon-runtime';

// Re-export router integration
export * from '../addon-router';

// Re-export runtime proxy
export * from '../runtime-proxy';

// ============================================================================
// Constants
// ============================================================================

/**
 * Addon system version
 */
export const ADDON_SYSTEM_VERSION = '1.0.0';

/**
 * Default addon loading timeout in milliseconds
 */
export const DEFAULT_LOAD_TIMEOUT = 30000;

/**
 * Maximum number of concurrent addon loads
 */
export const MAX_CONCURRENT_LOADS = 5;

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize the addon system
 * This should be called once during app startup
 */
export async function initializeAddonSystem(
  config?: AddonSystemConfig,
): Promise<AddonSystem> {
  const system = new AddonSystemImpl(config);
  await system.initialize();
  return system;
}

// ============================================================================
// Types
// ============================================================================

/**
 * Addon system configuration
 */
export interface AddonSystemConfig {
  /** Base URL for addon registry API */
  registryUrl?: string;
  /** Default load timeout */
  loadTimeout?: number;
  /** Enable development mode */
  devMode?: boolean;
}

/**
 * Addon system instance
 */
export interface AddonSystem {
  /** Initialize the system */
  initialize(): Promise<void>;
  /** Shutdown the system */
  shutdown(): Promise<void>;
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Addon system implementation
 */
class AddonSystemImpl implements AddonSystem {
  private config: Required<AddonSystemConfig>;

  constructor(config?: AddonSystemConfig) {
    this.config = {
      registryUrl: config?.registryUrl ?? '/api/addons',
      loadTimeout: config?.loadTimeout ?? DEFAULT_LOAD_TIMEOUT,
      devMode: config?.devMode ?? import.meta.env.DEV,
    };
  }

  async initialize(): Promise<void> {
    if (this.config.devMode) {
      console.info('[AddonSystem] Running in development mode');
    }
    console.info('[AddonSystem] Initialized');
  }

  async shutdown(): Promise<void> {
    console.info('[AddonSystem] Shutdown complete');
  }
}

// ============================================================================
// Re-export test utilities
// ============================================================================

export { createMockAddon, createMockManifest } from './test-utils';
