/**
 * Proxy Monitoring Module
 *
 * Comprehensive monitoring and analytics for the addon proxy.
 * Tracks performance, security, and usage metrics.
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Request metrics
 */
export interface RequestMetrics {
  requestId: string;
  addonId: string;
  method: string;
  path: string;
  statusCode: number;
  latencyMs: number;
  timestamp: Date;
  cacheHit: boolean;
  error?: string;
}

/**
 * Performance metrics
 */
export interface PerformanceMetrics {
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  requestsPerSecond: number;
  errorRate: number;
  cacheHitRate: number;
}

/**
 * Security metrics
 */
export interface SecurityMetrics {
  totalRequests: number;
  blockedRequests: number;
  authFailures: number;
  permissionDenials: number;
  injectionAttempts: number;
  threatScore: number;
}

/**
 * Usage metrics
 */
export interface UsageMetrics {
  addonId: string;
  endpoint: string;
  requestCount: number;
  totalLatencyMs: number;
  errorCount: number;
  lastRequest: Date;
}

/**
 * Monitoring configuration
 */
export interface MonitoringConfig {
  enableMetrics: boolean;
  enableTracing: boolean;
  enableSecurityTracking: boolean;
  metricsRetentionDays: number;
  sampleRate: number;
}

// ============================================================================
// Metrics Store
// ============================================================================

/**
 * In-memory metrics store
 */
class MetricsStore {
  private requests: RequestMetrics[] = [];
  private usageByAddon: Map<string, UsageMetrics> = new Map();
  private maxRequests: number = 100000;

  /**
   * Record a request metric
   */
  recordRequest(metric: RequestMetrics): void {
    this.requests.push(metric);

    // Trim old metrics
    if (this.requests.length > this.maxRequests) {
      this.requests = this.requests.slice(-Math.floor(this.maxRequests * 0.8));
    }

    // Update usage metrics
    this.updateUsageMetrics(metric);
  }

  /**
   * Update usage metrics for an addon
   */
  private updateUsageMetrics(metric: RequestMetrics): void {
    const key = `${metric.addonId}:${metric.path}`;
    const existing = this.usageByAddon.get(key);

    if (existing) {
      existing.requestCount++;
      existing.totalLatencyMs += metric.latencyMs;
      if (metric.error) existing.errorCount++;
      existing.lastRequest = metric.timestamp;
    } else {
      this.usageByAddon.set(key, {
        addonId: metric.addonId,
        endpoint: metric.path,
        requestCount: 1,
        totalLatencyMs: metric.latencyMs,
        errorCount: metric.error ? 1 : 0,
        lastRequest: metric.timestamp,
      });
    }
  }

  /**
   * Get recent requests
   */
  getRecentRequests(limit: number = 100): RequestMetrics[] {
    return this.requests.slice(-limit);
  }

  /**
   * Get requests by addon
   */
  getRequestsByAddon(addonId: string): RequestMetrics[] {
    return this.requests.filter((r) => r.addonId === addonId);
  }

  /**
   * Get performance metrics
   */
  getPerformanceMetrics(timeWindowMs: number = 60000): PerformanceMetrics {
    const cutoff = Date.now() - timeWindowMs;
    const recentRequests = this.requests.filter(
      (r) => r.timestamp.getTime() > cutoff,
    );

    if (recentRequests.length === 0) {
      return {
        avgLatencyMs: 0,
        p50LatencyMs: 0,
        p95LatencyMs: 0,
        p99LatencyMs: 0,
        requestsPerSecond: 0,
        errorRate: 0,
        cacheHitRate: 0,
      };
    }

    const latencies = recentRequests
      .map((r) => r.latencyMs)
      .sort((a, b) => a - b);
    const errors = recentRequests.filter((r) => r.statusCode >= 400).length;
    const cacheHits = recentRequests.filter((r) => r.cacheHit).length;

    return {
      avgLatencyMs: latencies.reduce((a, b) => a + b, 0) / latencies.length,
      p50LatencyMs: this.percentile(latencies, 50),
      p95LatencyMs: this.percentile(latencies, 95),
      p99LatencyMs: this.percentile(latencies, 99),
      requestsPerSecond: recentRequests.length / (timeWindowMs / 1000),
      errorRate: errors / recentRequests.length,
      cacheHitRate: cacheHits / recentRequests.length,
    };
  }

  /**
   * Calculate percentile
   */
  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)] ?? 0;
  }

  /**
   * Get security metrics
   */
  getSecurityMetrics(timeWindowMs: number = 60000): SecurityMetrics {
    const cutoff = Date.now() - timeWindowMs;
    const recentRequests = this.requests.filter(
      (r) => r.timestamp.getTime() > cutoff,
    );

    return {
      totalRequests: recentRequests.length,
      blockedRequests: recentRequests.filter((r) => r.statusCode === 403)
        .length,
      authFailures: recentRequests.filter((r) => r.statusCode === 401).length,
      permissionDenials: recentRequests.filter((r) =>
        r.error?.includes('PERMISSION'),
      ).length,
      injectionAttempts: recentRequests.filter((r) =>
        r.error?.includes('INJECTION'),
      ).length,
      threatScore: this.calculateThreatScore(recentRequests),
    };
  }

  /**
   * Calculate threat score
   */
  private calculateThreatScore(requests: RequestMetrics[]): number {
    if (requests.length === 0) return 0;

    let score = 0;
    const errors = requests.filter((r) => r.statusCode >= 400);

    // 403 errors (blocked) add to threat score
    score += errors.filter((r) => r.statusCode === 403).length * 5;

    // 401 errors (auth failures) add to threat score
    score += errors.filter((r) => r.statusCode === 401).length * 3;

    // Calculate score as percentage of requests that are errors
    return Math.min(100, (score / requests.length) * 100);
  }

  /**
   * Get usage metrics for all addons
   */
  getAllUsageMetrics(): UsageMetrics[] {
    return Array.from(this.usageByAddon.values());
  }

  /**
   * Get top addons by request count
   */
  getTopAddons(
    limit: number = 10,
  ): Array<{ addonId: string; requestCount: number }> {
    const byAddon = new Map<string, number>();

    for (const metric of this.requests) {
      const count = byAddon.get(metric.addonId) ?? 0;
      byAddon.set(metric.addonId, count + 1);
    }

    return Array.from(byAddon.entries())
      .map(([addonId, requestCount]) => ({ addonId, requestCount }))
      .sort((a, b) => b.requestCount - a.requestCount)
      .slice(0, limit);
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.requests = [];
    this.usageByAddon.clear();
  }
}

// ============================================================================
// Proxy Monitor
// ============================================================================

/**
 * ProxyMonitor provides monitoring and analytics for the proxy
 */
export class ProxyMonitor {
  private store: MetricsStore;
  private config: Required<MonitoringConfig>;
  private activeRequests: Map<string, number> = new Map();

  constructor(config: MonitoringConfig) {
    this.store = new MetricsStore();
    this.config = {
      enableMetrics: config.enableMetrics ?? true,
      enableTracing: config.enableTracing ?? true,
      enableSecurityTracking: config.enableSecurityTracking ?? true,
      metricsRetentionDays: config.metricsRetentionDays ?? 7,
      sampleRate: config.sampleRate ?? 1.0, // 100% by default
    };
  }

  /**
   * Generate a request ID
   */
  generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }

  /**
   * Start request timing
   */
  startRequest(requestId: string): void {
    this.activeRequests.set(requestId, Date.now());
  }

  /**
   * End request timing and record metric
   */
  endRequest(
    requestId: string,
    addonId: string,
    method: string,
    path: string,
    statusCode: number,
    cacheHit: boolean = false,
    error?: string,
  ): number {
    const startTime = this.activeRequests.get(requestId);
    this.activeRequests.delete(requestId);

    const latencyMs = startTime ? Date.now() - startTime : 0;

    // Only record if sampled
    if (Math.random() <= this.config.sampleRate) {
      this.store.recordRequest({
        requestId,
        addonId,
        method,
        path,
        statusCode,
        latencyMs,
        timestamp: new Date(),
        cacheHit,
        error: error ?? '',
      });
    }

    return latencyMs;
  }

  /**
   * Record a custom event
   */
  recordEvent(event: {
    type: string;
    addonId: string;
    details?: Record<string, unknown>;
  }): void {
    // Could be extended to send to external monitoring systems
    if (this.config.enableTracing) {
      console.log(`[ProxyMonitor] Event: ${event.type}`, {
        addonId: event.addonId,
        details: event.details,
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Get all metrics
   */
  getAllMetrics(): {
    performance: PerformanceMetrics;
    security: SecurityMetrics;
    usage: UsageMetrics[];
    topAddons: Array<{ addonId: string; requestCount: number }>;
  } {
    return {
      performance: this.store.getPerformanceMetrics(),
      security: this.store.getSecurityMetrics(),
      usage: this.store.getAllUsageMetrics(),
      topAddons: this.store.getTopAddons(),
    };
  }

  /**
   * Get performance metrics
   */
  getPerformanceMetrics(timeWindowMs?: number): PerformanceMetrics {
    return this.store.getPerformanceMetrics(timeWindowMs);
  }

  /**
   * Get security metrics
   */
  getSecurityMetrics(timeWindowMs?: number): SecurityMetrics {
    return this.store.getSecurityMetrics(timeWindowMs);
  }

  /**
   * Get recent requests
   */
  getRecentRequests(limit?: number): RequestMetrics[] {
    return this.store.getRecentRequests(limit);
  }

  /**
   * Get requests for a specific addon
   */
  getRequestsByAddon(addonId: string): RequestMetrics[] {
    return this.store.getRequestsByAddon(addonId);
  }

  /**
   * Health check for monitoring
   */
  healthCheck(): { status: string; activeRequests: number; uptime: number } {
    return {
      status: 'ok',
      activeRequests: this.activeRequests.size,
      uptime: Date.now(),
    };
  }
}

// ============================================================================
// Default monitoring instance
// ============================================================================

export const defaultProxyMonitor = new ProxyMonitor({
  enableMetrics: true,
  enableTracing: true,
  enableSecurityTracking: true,
  metricsRetentionDays: 7,
  sampleRate: 1.0,
});

export default defaultProxyMonitor;
