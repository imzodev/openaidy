/**
 * Rate Limiting Middleware
 *
 * Enforces per-connection, global, and IP-based rate limits to prevent abuse.
 */

import type { WebSocketConfig, RateLimitInfo, RateLimitResult } from '../types';
import { defaultWebSocketConfig } from '../types';

// ============================================================================
// Types
// ============================================================================

/**
 * Rate limit store for tracking requests
 */
type RateLimitStore = {
  requests: number[];
  resetTime: number;
};

/**
 * Rate limit middleware options
 */
export type RateLimitMiddlewareOptions = {
  /** Per-connection rate limit */
  connectionLimit?: number;
  /** Per-connection window in ms */
  connectionWindow?: number;
  /** Global rate limit */
  globalLimit?: number;
  /** Global window in ms */
  globalWindow?: number;
  /** IP rate limit */
  ipLimit?: number;
  /** IP window in ms */
  ipWindow?: number;
  /** Cleanup interval in ms */
  cleanupInterval?: number;
};

// ============================================================================
// Rate Limiter
// ============================================================================

/**
 * Sliding window rate limiter
 */
export class RateLimiter {
  private store: RateLimitStore;

  constructor(
    private max: number,
    private windowMs: number,
  ) {
    this.store = {
      requests: [],
      resetTime: Date.now() + windowMs,
    };
  }

  /**
   * Check if a request is allowed and return limit info
   */
  check(): RateLimitResult {
    const now = Date.now();

    // Reset if window expired
    if (now >= this.store.resetTime) {
      this.store.requests = [];
      this.store.resetTime = now + this.windowMs;
    }

    // Clean old requests outside window
    const windowStart = now - this.windowMs;
    this.store.requests = this.store.requests.filter((t) => t > windowStart);

    const remaining = Math.max(0, this.max - this.store.requests.length);
    const allowed = this.store.requests.length < this.max;

    return {
      allowed,
      info: {
        remaining,
        reset: this.store.resetTime,
        limit: this.max,
      },
    };
  }

  /**
   * Record a request
   */
  recordRequest(): void {
    this.store.requests.push(Date.now());
  }

  /**
   * Reset the limiter
   */
  reset(): void {
    this.store.requests = [];
    this.store.resetTime = Date.now() + this.windowMs;
  }

  /**
   * Check if the limiter window has expired
   */
  isExpired(): boolean {
    return Date.now() >= this.store.resetTime;
  }

  /**
   * Get current request count
   */
  getRequestCount(): number {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    return this.store.requests.filter((t) => t > windowStart).length;
  }

  /**
   * Get remaining requests
   */
  getRemaining(): number {
    const result = this.check();
    return result.info.remaining;
  }
}

// ============================================================================
// Rate Limit Middleware
// ============================================================================

/**
 * Rate limiting middleware for WebSocket connections
 *
 * Enforces three types of rate limits:
 * 1. Per-connection - limits requests from a single connection
 * 2. Global - limits total requests across all connections
 * 3. IP-based - limits requests from a single IP address
 */
export class RateLimitMiddleware {
  private connectionLimiters: Map<string, RateLimiter> = new Map();
  private ipLimiters: Map<string, RateLimiter> = new Map();
  private globalLimiter: RateLimiter;
  private cleanupTimer?: ReturnType<typeof setInterval>;

  private readonly connectionLimit: number;
  private readonly connectionWindow: number;
  private readonly globalLimit: number;
  private readonly globalWindow: number;
  private readonly ipLimit: number;
  private readonly ipWindow: number;

  constructor(
    config: WebSocketConfig = defaultWebSocketConfig,
    options: RateLimitMiddlewareOptions = {},
  ) {
    this.connectionLimit = options.connectionLimit ?? config.rateLimit.max;
    this.connectionWindow = options.connectionWindow ?? config.rateLimit.window;
    this.globalLimit = options.globalLimit ?? config.rateLimit.max * 10;
    this.globalWindow = options.globalWindow ?? config.rateLimit.window;
    this.ipLimit = options.ipLimit ?? config.rateLimit.max * 5;
    this.ipWindow = options.ipWindow ?? config.rateLimit.window;

    this.globalLimiter = new RateLimiter(this.globalLimit, this.globalWindow);

    // Start cleanup timer
    const cleanupInterval = options.cleanupInterval ?? 60000; // 1 minute
    this.cleanupTimer = setInterval(() => {
      this.cleanupStaleLimiters();
    }, cleanupInterval);
  }

  // ============================================================================
  // Check Methods
  // ============================================================================

  /**
   * Check rate limit for a connection
   */
  checkConnection(connectionId: string): RateLimitResult {
    let limiter = this.connectionLimiters.get(connectionId);
    if (!limiter) {
      limiter = new RateLimiter(this.connectionLimit, this.connectionWindow);
      this.connectionLimiters.set(connectionId, limiter);
    }
    return limiter.check();
  }

  /**
   * Check global rate limit
   */
  checkGlobal(): RateLimitResult {
    return this.globalLimiter.check();
  }

  /**
   * Check IP rate limit
   */
  checkIP(ip: string): RateLimitResult {
    let limiter = this.ipLimiters.get(ip);
    if (!limiter) {
      limiter = new RateLimiter(this.ipLimit, this.ipWindow);
      this.ipLimiters.set(ip, limiter);
    }
    return limiter.check();
  }

  /**
   * Check all rate limits (connection, global, IP)
   */
  checkAll(connectionId: string, ip?: string): {
    allowed: boolean;
    connection: RateLimitResult;
    global: RateLimitResult;
    ip?: RateLimitResult;
  } {
    const connection = this.checkConnection(connectionId);
    const global = this.checkGlobal();
    const ipResult = ip ? this.checkIP(ip) : undefined;

    const allowed = connection.allowed && global.allowed && (!ipResult || ipResult.allowed);

    return {
      allowed,
      connection,
      global,
      ip: ipResult,
    };
  }

  // ============================================================================
  // Record Methods
  // ============================================================================

  /**
   * Record a request for all limiters
   */
  recordRequest(connectionId: string, ip?: string): void {
    // Record for connection
    let connectionLimiter = this.connectionLimiters.get(connectionId);
    if (!connectionLimiter) {
      connectionLimiter = new RateLimiter(this.connectionLimit, this.connectionWindow);
      this.connectionLimiters.set(connectionId, connectionLimiter);
    }
    connectionLimiter.recordRequest();

    // Record for global
    this.globalLimiter.recordRequest();

    // Record for IP
    if (ip) {
      let ipLimiter = this.ipLimiters.get(ip);
      if (!ipLimiter) {
        ipLimiter = new RateLimiter(this.ipLimit, this.ipWindow);
        this.ipLimiters.set(ip, ipLimiter);
      }
      ipLimiter.recordRequest();
    }
  }

  /**
   * Record a request for connection only
   */
  recordConnectionRequest(connectionId: string): void {
    let limiter = this.connectionLimiters.get(connectionId);
    if (!limiter) {
      limiter = new RateLimiter(this.connectionLimit, this.connectionWindow);
      this.connectionLimiters.set(connectionId, limiter);
    }
    limiter.recordRequest();
  }

  /**
   * Record a request for global only
   */
  recordGlobalRequest(): void {
    this.globalLimiter.recordRequest();
  }

  /**
   * Record a request for IP only
   */
  recordIPRequest(ip: string): void {
    let limiter = this.ipLimiters.get(ip);
    if (!limiter) {
      limiter = new RateLimiter(this.ipLimit, this.ipWindow);
      this.ipLimiters.set(ip, limiter);
    }
    limiter.recordRequest();
  }

  // ============================================================================
  // Reset Methods
  // ============================================================================

  /**
   * Reset rate limit for a connection
   */
  resetConnection(connectionId: string): void {
    const limiter = this.connectionLimiters.get(connectionId);
    if (limiter) {
      limiter.reset();
    }
  }

  /**
   * Reset rate limit for an IP
   */
  resetIP(ip: string): void {
    const limiter = this.ipLimiters.get(ip);
    if (limiter) {
      limiter.reset();
    }
  }

  /**
   * Reset global rate limit
   */
  resetGlobal(): void {
    this.globalLimiter.reset();
  }

  /**
   * Reset all rate limits
   */
  resetAll(): void {
    for (const limiter of this.connectionLimiters.values()) {
      limiter.reset();
    }
    for (const limiter of this.ipLimiters.values()) {
      limiter.reset();
    }
    this.globalLimiter.reset();
  }

  // ============================================================================
  // Getters
  // ============================================================================

  /**
   * Get rate limit info for a connection
   */
  getConnectionInfo(connectionId: string): RateLimitInfo | undefined {
    const limiter = this.connectionLimiters.get(connectionId);
    return limiter?.check().info;
  }

  /**
   * Get global rate limit info
   */
  getGlobalInfo(): RateLimitInfo {
    return this.globalLimiter.check().info;
  }

  /**
   * Get rate limit info for an IP
   */
  getIPInfo(ip: string): RateLimitInfo | undefined {
    const limiter = this.ipLimiters.get(ip);
    return limiter?.check().info;
  }

  /**
   * Get connection count
   */
  getConnectionCount(): number {
    return this.connectionLimiters.size;
  }

  /**
   * Get IP count
   */
  getIPCount(): number {
    return this.ipLimiters.size;
  }

  // ============================================================================
  // Cleanup
  // ============================================================================

  /**
   * Cleanup stale limiters
   */
  cleanupStaleLimiters(): number {
    let cleaned = 0;

    // Clean connection limiters
    for (const [id, limiter] of this.connectionLimiters) {
      if (limiter.isExpired()) {
        this.connectionLimiters.delete(id);
        cleaned++;
      }
    }

    // Clean IP limiters
    for (const [ip, limiter] of this.ipLimiters) {
      if (limiter.isExpired()) {
        this.ipLimiters.delete(ip);
        cleaned++;
      }
    }

    return cleaned;
  }

  /**
   * Remove a connection's limiter
   */
  removeConnection(connectionId: string): void {
    this.connectionLimiters.delete(connectionId);
  }

  /**
   * Shutdown the middleware
   */
  shutdown(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    this.connectionLimiters.clear();
    this.ipLimiters.clear();
    this.globalLimiter.reset();
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create rate limit middleware
 */
export function createRateLimitMiddleware(
  config?: WebSocketConfig,
  options?: RateLimitMiddlewareOptions,
): RateLimitMiddleware {
  return new RateLimitMiddleware(config, options);
}

export default RateLimitMiddleware;
