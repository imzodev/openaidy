/**
 * Development Analytics and Telemetry
 *
 * Opt-in usage tracking and performance metrics collection.
 */

export interface AnalyticsEvent {
  name: string;
  timestamp: number;
  properties?: Record<string, unknown>;
}

export interface AnalyticsConfig {
  enabled: boolean;
  endpoint?: string;
  userId?: string;
  anonymous?: boolean;
}

export interface PerformanceMetric {
  name: string;
  value: number;
  unit: string;
  timestamp: number;
}

export interface ErrorReport {
  message: string;
  stack?: string;
  timestamp: number;
  context?: Record<string, unknown>;
}

export class Analytics {
  private events: AnalyticsEvent[] = [];
  private metrics: PerformanceMetric[] = [];
  private config: AnalyticsConfig;
  private anonymousId: string;

  constructor(config: AnalyticsConfig = { enabled: false }) {
    this.config = config;
    this.anonymousId = this.generateAnonymousId();
  }

  /**
   * Generate anonymous user ID
   */
  private generateAnonymousId(): string {
    return `anon-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Enable analytics
   */
  enable(): void {
    this.config.enabled = true;
  }

  /**
   * Disable analytics
   */
  disable(): void {
    this.config.enabled = false;
  }

  /**
   * Track an event
   */
  trackEvent(name: string, properties?: Record<string, unknown>): void {
    if (!this.config.enabled) return;

    const event: AnalyticsEvent = {
      name,
      timestamp: Date.now(),
      properties,
    };

    this.events.push(event);

    // In real implementation, this would send to analytics endpoint
    if (this.config.endpoint) {
      this.sendEvent(event);
    }
  }

  /**
   * Track command usage
   */
  trackCommand(command: string, args: string[], duration: number): void {
    this.trackEvent('command_used', {
      command,
      args: args.join(' '),
      duration,
    });
  }

  /**
   * Track build operation
   */
  trackBuild(success: boolean, duration: number, errors?: string[]): void {
    this.trackEvent('build', {
      success,
      duration,
      errors,
    });
  }

  /**
   * Track test run
   */
  trackTestRun(passed: number, failed: number, duration: number): void {
    this.trackEvent('test_run', {
      passed,
      failed,
      duration,
    });
  }

  /**
   * Track error
   */
  trackError(error: ErrorReport): void {
    this.trackEvent('error', {
      message: error.message,
      stack: error.stack,
      context: error.context,
    });
  }

  /**
   * Record performance metric
   */
  recordMetric(name: string, value: number, unit: string = 'ms'): void {
    const metric: PerformanceMetric = {
      name,
      value,
      unit,
      timestamp: Date.now(),
    };

    this.metrics.push(metric);
  }

  /**
   * Get all events
   */
  getEvents(): AnalyticsEvent[] {
    return [...this.events];
  }

  /**
   * Get all metrics
   */
  getMetrics(): PerformanceMetric[] {
    return [...this.metrics];
  }

  /**
   * Clear all data
   */
  clear(): void {
    this.events = [];
    this.metrics = [];
  }

  /**
   * Send event to endpoint
   */
  private async sendEvent(event: AnalyticsEvent): Promise<void> {
    if (!this.config.endpoint) return;

    try {
      const _body = JSON.stringify({
        ...event,
        anonymousId: this.anonymousId,
        userId: this.config.userId,
      });

      // In real implementation, this would POST to analytics endpoint
      // await fetch(this.config.endpoint, {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: _body,
      // });
    } catch {
      // Ignore send errors
    }
  }

  /**
   * Get summary statistics
   */
  getSummary(): {
    totalEvents: number;
    totalMetrics: number;
    eventsByType: Record<string, number>;
    averageBuildDuration: number;
    testPassRate: number;
  } {
    const eventsByType: Record<string, number> = {};
    let totalBuildDuration = 0;
    let buildCount = 0;
    let totalTests = 0;
    let totalPassed = 0;

    for (const event of this.events) {
      eventsByType[event.name] = (eventsByType[event.name] || 0) + 1;

      if (event.name === 'build' && event.properties) {
        totalBuildDuration += (event.properties.duration as number) || 0;
        buildCount++;
      }

      if (event.name === 'test_run' && event.properties) {
        totalTests +=
          ((event.properties.passed as number) || 0) +
          ((event.properties.failed as number) || 0);
        totalPassed += (event.properties.passed as number) || 0;
      }
    }

    return {
      totalEvents: this.events.length,
      totalMetrics: this.metrics.length,
      eventsByType,
      averageBuildDuration:
        buildCount > 0 ? totalBuildDuration / buildCount : 0,
      testPassRate: totalTests > 0 ? (totalPassed / totalTests) * 100 : 0,
    };
  }

  /**
   * Export analytics data
   */
  export(): {
    events: AnalyticsEvent[];
    metrics: PerformanceMetric[];
    summary: {
      totalEvents: number;
      totalMetrics: number;
      eventsByType: Record<string, number>;
      averageBuildDuration: number;
      testPassRate: number;
    };
    exportedAt: number;
  } {
    return {
      events: this.getEvents(),
      metrics: this.getMetrics(),
      summary: this.getSummary(),
      exportedAt: Date.now(),
    };
  }

  /**
   * Get user ID
   */
  getUserId(): string | undefined {
    return this.config.anonymous ? this.anonymousId : this.config.userId;
  }
}

/**
 * Create analytics instance with default config
 */
export function createAnalytics(config?: Partial<AnalyticsConfig>): Analytics {
  return new Analytics({
    enabled: false, // Opt-in by default
    anonymous: true,
    ...config,
  });
}

/**
 * Error reporting utility
 */
export function createErrorReport(
  error: Error,
  context?: Record<string, unknown>,
): ErrorReport {
  return {
    message: error.message,
    stack: error.stack,
    timestamp: Date.now(),
    context,
  };
}

/**
 * Performance measurement utility
 */
export function measurePerformance<T>(
  name: string,
  fn: () => T | Promise<T>,
): Promise<{ result: T; duration: number }> {
  const start = Date.now();

  return (async () => {
    const result = await fn();
    const duration = Date.now() - start;
    return { result, duration };
  })();
}
