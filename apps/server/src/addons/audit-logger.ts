/**
 * Audit Logger
 *
 * Tracks and logs addon activities for security and compliance.
 */

import type { Addon } from '@openaidy/db';

// ============================================================================
// Audit Types
// ============================================================================

/**
 * Audit event types
 */
export const AUDIT_EVENTS = {
  // Installation events
  ADDON_INSTALLED: 'addon.installed',
  ADDON_UNINSTALLED: 'addon.uninstalled',
  ADDON_ENABLED: 'addon.enabled',
  ADDON_DISABLED: 'addon.disabled',
  ADDON_CONFIG_UPDATED: 'addon.config_updated',

  // Permission events
  PERMISSION_GRANTED: 'permission.granted',
  PERMISSION_REVOKED: 'permission.revoked',
  PERMISSION_REQUESTED: 'permission.requested',
  PERMISSION_DENIED: 'permission.denied',

  // Access events
  API_ACCESSED: 'api.accessed',
  API_DENIED: 'api.denied',
  AGENT_INVOKED: 'agent.invoked',
  SESSION_CREATED: 'session.created',
  SESSION_ACCESSED: 'session.accessed',

  // Security events
  RATE_LIMIT_EXCEEDED: 'security.rate_limit_exceeded',
  INVALID_TOKEN: 'security.invalid_token',
  SUSPICIOUS_ACTIVITY: 'security.suspicious_activity',
} as const;

export type AuditEventType = (typeof AUDIT_EVENTS)[keyof typeof AUDIT_EVENTS];

/**
 * Audit log entry
 */
export interface AuditLogEntry {
  id: string;
  timestamp: Date;
  event: AuditEventType;
  addonId: string;
  addonName?: string;
  userId?: string;
  ipAddress?: string;
  userAgent?: string;
  resource?: string;
  action?: string;
  outcome: 'success' | 'failure' | 'denied';
  details?: Record<string, unknown>;
  error?: string;
}

/**
 * Audit log filter
 */
export interface AuditLogFilter {
  addonId?: string;
  event?: AuditEventType;
  userId?: string;
  startDate?: Date;
  endDate?: Date;
  outcome?: 'success' | 'failure' | 'denied';
  limit?: number;
  offset?: number;
}

/**
 * Audit summary
 */
export interface AuditSummary {
  totalEvents: number;
  successCount: number;
  failureCount: number;
  deniedCount: number;
  eventsByType: Record<string, number>;
  mostActiveAddons: Array<{ addonId: string; count: number }>;
}

// ============================================================================
// Audit Logger
// ============================================================================

/**
 * Audit logger interface
 */
export interface AuditLogger {
  log(entry: Omit<AuditLogEntry, 'id' | 'timestamp'>): void;
  getLogs(filter?: AuditLogFilter): Promise<AuditLogEntry[]>;
  getSummary(filter?: AuditLogFilter): Promise<AuditSummary>;
}

/**
 * In-memory audit logger (for development/testing)
 */
export class InMemoryAuditLogger implements AuditLogger {
  private logs: AuditLogEntry[] = [];
  private idCounter = 0;
  private maxEntries: number;

  constructor(maxEntries: number = 10000) {
    this.maxEntries = maxEntries;
  }

  log(entry: Omit<AuditLogEntry, 'id' | 'timestamp'>): void {
    this.idCounter++;
    const fullEntry: AuditLogEntry = {
      ...entry,
      id: `audit_${this.idCounter}`,
      timestamp: new Date(),
    };

    this.logs.push(fullEntry);

    // Trim if over max
    if (this.logs.length > this.maxEntries) {
      this.logs = this.logs.slice(-this.maxEntries);
    }

    // Console output for debugging
    console.debug(`[AUDIT] ${fullEntry.event}`, {
      addonId: fullEntry.addonId,
      outcome: fullEntry.outcome,
    });
  }

  async getLogs(filter?: AuditLogFilter): Promise<AuditLogEntry[]> {
    let result = [...this.logs];

    if (filter) {
      if (filter.addonId) {
        result = result.filter((l) => l.addonId === filter.addonId);
      }
      if (filter.event) {
        result = result.filter((l) => l.event === filter.event);
      }
      if (filter.userId) {
        result = result.filter((l) => l.userId === filter.userId);
      }
      if (filter.startDate) {
        result = result.filter((l) => l.timestamp >= filter.startDate!);
      }
      if (filter.endDate) {
        result = result.filter((l) => l.timestamp <= filter.endDate!);
      }
      if (filter.outcome) {
        result = result.filter((l) => l.outcome === filter.outcome);
      }
    }

    // Sort by timestamp descending
    result.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    // Apply pagination
    if (filter?.offset) {
      result = result.slice(filter.offset);
    }
    if (filter?.limit) {
      result = result.slice(0, filter.limit);
    }

    return result;
  }

  async getSummary(filter?: AuditLogFilter): Promise<AuditSummary> {
    const { limit: _limit, offset: _offset, ...rest } = filter ?? {};
    const logs = await this.getLogs({
      ...rest,
    });

    const eventsByType: Record<string, number> = {};
    const addonCounts: Record<string, number> = {};
    let successCount = 0;
    let failureCount = 0;
    let deniedCount = 0;

    for (const log of logs) {
      eventsByType[log.event] = (eventsByType[log.event] || 0) + 1;
      addonCounts[log.addonId] = (addonCounts[log.addonId] || 0) + 1;

      switch (log.outcome) {
        case 'success':
          successCount++;
          break;
        case 'failure':
          failureCount++;
          break;
        case 'denied':
          deniedCount++;
          break;
      }
    }

    const mostActiveAddons = Object.entries(addonCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([addonId, count]) => ({ addonId, count }));

    return {
      totalEvents: logs.length,
      successCount,
      failureCount,
      deniedCount,
      eventsByType,
      mostActiveAddons,
    };
  }

  /**
   * Clear all logs
   */
  clear(): void {
    this.logs = [];
  }

  /**
   * Get log count
   */
  getCount(): number {
    return this.logs.length;
  }
}

// ============================================================================
// Audit Helper Functions
// ============================================================================

/**
 * Log addon installation
 */
export function logAddonInstalled(
  logger: AuditLogger,
  addon: Addon,
  userId: string,
  details?: Record<string, unknown>,
): void {
  const entry: Omit<AuditLogEntry, 'id' | 'timestamp'> = {
    event: AUDIT_EVENTS.ADDON_INSTALLED,
    addonId: addon.addonId,
    addonName: addon.name,
    userId,
    outcome: 'success',
  };
  if (details !== undefined) {
    entry.details = details;
  }
  logger.log(entry);
}

/**
 * Log addon enablement
 */
export function logAddonEnabled(
  logger: AuditLogger,
  addon: Addon,
  userId: string,
  permissions: string[],
): void {
  logger.log({
    event: AUDIT_EVENTS.ADDON_ENABLED,
    addonId: addon.addonId,
    addonName: addon.name,
    userId,
    outcome: 'success',
    details: { permissions },
  });
}

/**
 * Log permission denial
 */
export function logPermissionDenied(
  logger: AuditLogger,
  addonId: string,
  permission: string,
  reason?: string,
): void {
  logger.log({
    event: AUDIT_EVENTS.PERMISSION_DENIED,
    addonId,
    outcome: 'denied',
    details: { permission, reason },
  });
}

/**
 * Log API access
 */
export function logApiAccess(
  logger: AuditLogger,
  addon: Addon,
  endpoint: string,
  method: string,
  outcome: 'success' | 'failure',
): void {
  logger.log({
    event:
      outcome === 'success'
        ? AUDIT_EVENTS.API_ACCESSED
        : AUDIT_EVENTS.API_DENIED,
    addonId: addon.addonId,
    addonName: addon.name,
    resource: endpoint,
    action: method,
    outcome,
  });
}

/**
 * Log rate limit exceeded
 */
export function logRateLimitExceeded(
  logger: AuditLogger,
  addonId: string,
  endpoint: string,
): void {
  logger.log({
    event: AUDIT_EVENTS.RATE_LIMIT_EXCEEDED,
    addonId,
    resource: endpoint,
    outcome: 'denied',
  });
}

/**
 * Log agent invocation
 */
export function logAgentInvoked(
  logger: AuditLogger,
  addon: Addon,
  agentId: string,
  success: boolean,
): void {
  logger.log({
    event: AUDIT_EVENTS.AGENT_INVOKED,
    addonId: addon.addonId,
    addonName: addon.name,
    resource: agentId,
    outcome: success ? 'success' : 'failure',
  });
}

// ============================================================================
// Global Audit Logger
// ============================================================================

let globalLogger: AuditLogger | undefined;

export function getAuditLogger(): AuditLogger {
  if (!globalLogger) {
    globalLogger = new InMemoryAuditLogger();
  }
  return globalLogger;
}

export function setAuditLogger(logger: AuditLogger): void {
  globalLogger = logger;
}

export function resetAuditLogger(): void {
  globalLogger = undefined;
}
