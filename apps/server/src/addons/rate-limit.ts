/**
 * Rate Limiter
 *
 * Token bucket rate limiting for addon API access.
 */

import type { Addon } from '@openaidy/db';

// ============================================================================
// Rate Limit Types
// ============================================================================

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  /** Maximum requests per window */
  limit: number;
  /** Window size in milliseconds */
  windowMs: number;
  /** Whether to skip rate limiting for specific addons */
  skipForPremium?: boolean;
}

/**
 * Rate limit result
 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  reset: Date;
  retryAfter?: number;
}

/**
 * Rate limit entry
 */
interface RateLimitEntry {
  tokens: number;
  lastRefill: number;
}

/**
 * Default rate limit configurations
 */
export const DEFAULT_RATE_LIMITS: Record<string, RateLimitConfig> = {
  // Free tier: 100 requests per minute
  free: {
    limit: 100,
    windowMs: 60 * 1000,
  },
  // Paid tier: 1000 requests per minute
  paid: {
    limit: 1000,
    windowMs: 60 * 1000,
  },
  // Enterprise: unlimited
  enterprise: {
    limit: Infinity,
    windowMs: 1000,
  },
  // Default for unknown tier
  default: {
    limit: 100,
    windowMs: 60 * 1000,
  },
};

// ============================================================================
// Rate Limiter
// ============================================================================

/**
 * Token bucket rate limiter
 */
export class RateLimiter {
  private storage: Map<string, RateLimitEntry> = new Map();
  private config: RateLimitConfig;

  constructor(config: RateLimitConfig) {
    this.config = config;
  }

  /**
   * Check if a request is allowed
   */
  check(key: string): RateLimitResult {
    const now = Date.now();
    let entry = this.storage.get(key);

    // Initialize or refill tokens
    if (!entry || now - entry.lastRefill >= this.config.windowMs) {
      entry = {
        tokens: this.config.limit,
        lastRefill: now,
      };
      this.storage.set(key, entry);
    }

    // Check if tokens available
    if (entry.tokens <= 0) {
      const retryAfter = this.config.windowMs - (now - entry.lastRefill);
      return {
        allowed: false,
        remaining: 0,
        reset: new Date(entry.lastRefill + this.config.windowMs),
        retryAfter: Math.max(0, retryAfter),
      };
    }

    // Consume a token
    entry.tokens--;

    return {
      allowed: true,
      remaining: entry.tokens,
      reset: new Date(entry.lastRefill + this.config.windowMs),
    };
  }

  /**
   * Reset rate limit for a key
   */
  reset(key: string): void {
    this.storage.delete(key);
  }

  /**
   * Get current configuration
   */
  getConfig(): RateLimitConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<RateLimitConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get storage size (for monitoring)
   */
  getStorageSize(): number {
    return this.storage.size;
  }

  /**
   * Clean up expired entries
   */
  cleanup(): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.storage.entries()) {
      if (now - entry.lastRefill >= this.config.windowMs * 2) {
        this.storage.delete(key);
        cleaned++;
      }
    }

    return cleaned;
  }
}

// ============================================================================
// Addon Rate Limiter Factory
// ============================================================================

/**
 * Create a rate limiter for an addon based on its tier
 */
export function createAddonRateLimiter(addon: Addon): RateLimiter {
  const tier = getAddonTier(addon);
  const config = DEFAULT_RATE_LIMITS[tier] ?? DEFAULT_RATE_LIMITS.default;
  return new RateLimiter(config);
}

/**
 * Determine addon tier based on permissions
 */
function getAddonTier(addon: Addon): string {
  const permissions = (addon.permissions as string[]) ?? [];

  // Enterprise: has system or * permissions
  if (
    permissions.includes('*') ||
    permissions.includes('system.manage') ||
    permissions.includes('system.addons.manage')
  ) {
    return 'enterprise';
  }

  // Paid: has write or invoke permissions on multiple resources
  const writePermissions = permissions.filter(
    (p) => p.includes('.write') || p.includes('.invoke'),
  );
  if (writePermissions.length >= 3) {
    return 'paid';
  }

  // Default to free tier
  return 'free';
}

// ============================================================================
// Rate Limit Middleware
// ============================================================================

/**
 * Create rate limit middleware function
 */
export function createRateLimitMiddleware(
  limiter: RateLimiter,
  getKey: (request: Request) => string,
): (request: Request) => RateLimitResult {
  return (request: Request): RateLimitResult => {
    const key = getKey(request);
    return limiter.check(key);
  };
}

/**
 * Get rate limit key from request
 */
export function getAddonRateLimitKey(
  addonId: string,
  endpoint: string,
): string {
  return `addon:${addonId}:${endpoint}`;
}

// ============================================================================
// Global Rate Limiter Registry
// ============================================================================

/**
 * Registry for addon-specific rate limiters
 */
class RateLimiterRegistry {
  private limiters: Map<string, RateLimiter> = new Map();
  private defaultLimiter: RateLimiter;

  constructor() {
    this.defaultLimiter = new RateLimiter(DEFAULT_RATE_LIMITS.default);
  }

  /**
   * Get or create a rate limiter for an addon
   */
  getLimiter(addonId: string): RateLimiter {
    if (!this.limiters.has(addonId)) {
      // Create with default config
      this.limiters.set(addonId, new RateLimiter(DEFAULT_RATE_LIMITS.default));
    }
    return this.limiters.get(addonId)!;
  }

  /**
   * Set custom rate limiter for an addon
   */
  setLimiter(addonId: string, limiter: RateLimiter): void {
    this.limiters.set(addonId, limiter);
  }

  /**
   * Remove rate limiter for an addon
   */
  removeLimiter(addonId: string): void {
    this.limiters.delete(addonId);
  }

  /**
   * Get the default rate limiter
   */
  getDefaultLimiter(): RateLimiter {
    return this.defaultLimiter;
  }

  /**
   * Get all registered addon IDs
   */
  getRegisteredAddons(): string[] {
    return Array.from(this.limiters.keys());
  }

  /**
   * Clear all addon limiters
   */
  clear(): void {
    this.limiters.clear();
  }
}

// Global registry instance
const globalRegistry = new RateLimiterRegistry();

export function getRateLimiterRegistry(): RateLimiterRegistry {
  return globalRegistry;
}

/**
 * Convenience function to check rate limit
 */
export function checkAddonRateLimit(
  addonId: string,
  endpoint: string,
): RateLimitResult {
  const limiter = globalRegistry.getLimiter(addonId);
  const key = getAddonRateLimitKey(addonId, endpoint);
  return limiter.check(key);
}
