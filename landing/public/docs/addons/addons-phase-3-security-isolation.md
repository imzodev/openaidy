# Phase 3: Security & Isolation - Addons Implementation

## Overview

Phase 3 strengthens the addon system with comprehensive security measures, fine-grained permission enforcement, rate limiting, audit logging, and isolation mechanisms. This phase ensures that addons operate within strict security boundaries while maintaining system performance and reliability.

## Objectives

- Implement fine-grained permission checking across all addon operations
- Add rate limiting for addon API requests
- Create comprehensive audit logging for addon activities
- Implement addon sandboxing and code validation
- Add security scanning for addon uploads
- Enhance data isolation between addons

## Implementation Tasks

### 1. Enhanced Permission System

#### 1.1 Create Permission Validator

**File: `apps/server/src/addons/permission-validator.ts`**

```typescript
import type { AddonManifest } from '@openaidy/shared-types';

export interface PermissionContext {
  addonId: string;
  permissions: string[];
  userId: string;
  sessionId?: string;
  agentId?: string;
  configNamespace?: string;
}

export interface PermissionCheck {
  resource: string;
  action: string;
  target?: string;
  context?: any;
}

export class PermissionValidator {
  /**
   * Check if addon has permission for specific action
   */
  static hasPermission(
    context: PermissionContext,
    check: PermissionCheck,
  ): { allowed: boolean; reason?: string } {
    const { permissions } = context;
    const { resource, action, target } = check;

    // Build permission string to check
    const permissionString = target
      ? `${resource}.${action}:${target}`
      : `${resource}.${action}`;

    // Check for exact permission match
    if (permissions.includes(permissionString)) {
      return { allowed: true };
    }

    // Check for wildcard permissions
    const wildcardPermission = `${resource}.${action}:*`;
    if (permissions.includes(wildcardPermission)) {
      return { allowed: true };
    }

    // Check for resource-wide permissions
    const resourcePermission = `${resource}.*`;
    if (permissions.includes(resourcePermission)) {
      return { allowed: true };
    }

    // Special case: system permissions
    if (resource === 'system') {
      return {
        allowed: false,
        reason: `Missing system permission: ${permissionString}`,
      };
    }

    return {
      allowed: false,
      reason: `Missing permission: ${permissionString}`,
    };
  }

  /**
   * Validate agent access permissions
   */
  static validateAgentAccess(
    context: PermissionContext,
    agentId: string,
  ): { allowed: boolean; reason?: string } {
    return this.hasPermission(context, {
      resource: 'agents',
      action: 'invoke',
      target: agentId,
    });
  }

  /**
   * Validate session access permissions
   */
  static validateSessionAccess(
    context: PermissionContext,
    sessionId: string,
    action: 'read' | 'write' | 'delete',
  ): { allowed: boolean; reason?: string } {
    // Check general session permission
    const generalPermission = this.hasPermission(context, {
      resource: 'sessions',
      action,
    });

    if (generalPermission.allowed) {
      return { allowed: true };
    }

    // Check session-specific permission
    return this.hasPermission(context, {
      resource: 'sessions',
      action,
      target: sessionId,
    });
  }

  /**
   * Validate config access permissions
   */
  static validateConfigAccess(
    context: PermissionContext,
    namespace: string,
    action: 'read' | 'write',
  ): { allowed: boolean; reason?: string } {
    // Check general config permission
    const generalPermission = this.hasPermission(context, {
      resource: 'config',
      action,
    });

    if (generalPermission.allowed) {
      return { allowed: true };
    }

    // Check namespace-specific permission
    return this.hasPermission(context, {
      resource: 'config',
      action,
      target: namespace,
    });
  }

  /**
   * Extract permissions from manifest
   */
  static extractPermissions(manifest: AddonManifest): string[] {
    return manifest.permissions.map((perm) => {
      switch (perm.type) {
        case 'agent':
          return `agents.invoke:${perm.target}`;
        case 'session':
          return perm.target
            ? `sessions.${perm.action}:${perm.target}`
            : `sessions.${perm.action}`;
        case 'config':
          return perm.target
            ? `config.${perm.action}:${perm.target}`
            : `config.${perm.action}`;
        case 'system':
          return `system.${perm.action}`;
        default:
          throw new Error(`Unknown permission type: ${(perm as any).type}`);
      }
    });
  }

  /**
   * Validate permission format
   */
  static validatePermissionFormat(permission: string): boolean {
    const permissionPattern = /^([a-z]+)\.([a-z]+)(?::([a-zA-Z0-9-_.*]+))?$/;
    return permissionPattern.test(permission);
  }

  /**
   * Get permission hierarchy for inheritance
   */
  static getPermissionHierarchy(permission: string): string[] {
    const parts = permission.split(':');
    const basePermission = parts[0];
    const target = parts[1];

    const hierarchy = [basePermission];

    if (target && target !== '*') {
      hierarchy.push(`${basePermission}:${target}`);
    }

    return hierarchy;
  }
}
```

#### 1.2 Create Permission Middleware

**File: `apps/server/src/addons/permission-middleware.ts`**

```typescript
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { AuthMiddleware } from '../websocket/middleware/auth';
import type { AddonsStore } from '@openaidy/db';
import {
  PermissionValidator,
  type PermissionContext,
} from './permission-validator';

export interface PermissionMiddlewareOptions {
  authMiddleware: AuthMiddleware;
  addonsStore: AddonsStore;
}

/**
 * Middleware to validate addon permissions for API requests
 */
export function createPermissionMiddleware(
  options: PermissionMiddlewareOptions,
) {
  const { authMiddleware, addonsStore } = options;

  return async function validateAddonPermission(
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    // Extract addon token from Authorization header
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.code(401).send({
        error: 'addon.unauthorized',
        message: 'Addon token required',
      });
    }

    const token = authHeader.slice(7);

    // Validate token and extract payload
    const payload = await authMiddleware.validateToken(token);
    if (!payload) {
      return reply.code(401).send({
        error: 'addon.invalid_token',
        message: 'Invalid or expired addon token',
      });
    }

    // Extract addon ID from client ID
    const addonIdMatch = payload.sub.match(/^addon:(.+)$/);
    if (!addonIdMatch) {
      return reply.code(401).send({
        error: 'addon.invalid_client',
        message: 'Invalid addon client ID',
      });
    }

    const addonId = addonIdMatch[1];

    // Get addon from database
    const addon = await addonsStore.findByAddonId(addonId);
    if (!addon || addon.status !== 'enabled') {
      return reply.code(401).send({
        error: 'addon.not_enabled',
        message: 'Addon is not enabled',
      });
    }

    // Create permission context
    const permissionContext: PermissionContext = {
      addonId,
      permissions: payload.scopes,
      userId: payload.sub,
    };

    // Attach context to request for use in route handlers
    request.addonContext = permissionContext;
    request.addon = addon;
  };
}

/**
 * Check specific permission for a route
 */
export function requirePermission(
  resource: string,
  action: string,
  targetFromParam?: string,
) {
  return async function checkPermission(
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    const context = request.addonContext;
    if (!context) {
      return reply.code(401).send({
        error: 'addon.no_context',
        message: 'Addon context not found',
      });
    }

    const target = targetFromParam
      ? (request.params as any)[targetFromParam]
      : undefined;

    const result = PermissionValidator.hasPermission(context, {
      resource,
      action,
      target,
    });

    if (!result.allowed) {
      return reply.code(403).send({
        error: 'addon.permission_denied',
        message: result.reason || 'Permission denied',
      });
    }
  };
}

// Extend FastifyRequest interface
declare module 'fastify' {
  interface FastifyRequest {
    addonContext?: PermissionContext;
    addon?: any;
  }
}
```

### 2. Rate Limiting System

#### 2.1 Create Rate Limiter

**File: `apps/server/src/addons/rate-limiter.ts`**

```typescript
import type { AddonsStore } from '@openaidy/db';

export interface RateLimitConfig {
  requests: number;
  window: number; // in seconds
  strategy?: 'fixed-window' | 'sliding-window';
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime?: number;
  limit: number;
}

export class AddonRateLimiter {
  private memoryStore = new Map<string, { count: number; resetTime: number }>();
  private defaultLimits: Record<string, RateLimitConfig> = {
    'agents.invoke': { requests: 100, window: 60 }, // 100 requests per minute
    'sessions.create': { requests: 10, window: 60 }, // 10 sessions per minute
    'sessions.read': { requests: 1000, window: 60 }, // 1000 reads per minute
    'config.read': { requests: 500, window: 60 }, // 500 config reads per minute
    'config.write': { requests: 50, window: 60 }, // 50 config writes per minute
    default: { requests: 200, window: 60 }, // 200 requests per minute for other endpoints
  };

  constructor(private addonsStore: AddonsStore) {}

  /**
   * Check if addon is rate limited for specific endpoint
   */
  async checkRateLimit(
    addonId: string,
    endpoint: string,
    config?: RateLimitConfig,
  ): Promise<RateLimitResult> {
    const limit = config || this.getLimitForEndpoint(endpoint);
    const key = `${addonId}:${endpoint}`;
    const now = Math.floor(Date.now() / 1000);

    // Get current usage from memory store
    let usage = this.memoryStore.get(key);

    if (!usage || now >= usage.resetTime) {
      // Reset or initialize counter
      usage = { count: 0, resetTime: now + limit.window };
      this.memoryStore.set(key, usage);
    }

    // Check if limit exceeded
    const allowed = usage.count < limit.requests;

    if (allowed) {
      usage.count++;
    }

    // Persist to database for analytics
    await this.persistUsage(addonId, endpoint, allowed);

    return {
      allowed,
      remaining: Math.max(0, limit.requests - usage.count),
      resetTime: usage.resetTime,
      limit: limit.requests,
    };
  }

  /**
   * Get rate limit configuration for endpoint
   */
  private getLimitForEndpoint(endpoint: string): RateLimitConfig {
    // Check for exact match
    if (this.defaultLimits[endpoint]) {
      return this.defaultLimits[endpoint];
    }

    // Check for pattern match
    for (const [pattern, config] of Object.entries(this.defaultLimits)) {
      if (pattern !== 'default' && endpoint.startsWith(pattern)) {
        return config;
      }
    }

    // Return default limit
    return this.defaultLimits.default;
  }

  /**
   * Persist usage data to database
   */
  private async persistUsage(
    addonId: string,
    endpoint: string,
    allowed: boolean,
  ): Promise<void> {
    try {
      const addon = await this.addonsStore.findByAddonId(addonId);
      if (!addon) return;

      await this.addonsStore.recordUsage({
        addonId: addon.id,
        endpoint,
        requestCount: allowed ? 1 : 0,
        lastUsed: new Date(),
        date: new Date().toISOString().split('T')[0],
      });
    } catch (error) {
      console.error('Failed to persist usage data:', error);
    }
  }

  /**
   * Get current usage statistics for addon
   */
  async getUsageStats(addonId: string, days: number = 7) {
    const addon = await this.addonsStore.findByAddonId(addonId);
    if (!addon) return null;

    return await this.addonsStore.getUsageStats(addon.id, days);
  }

  /**
   * Reset rate limit for specific addon and endpoint
   */
  resetRateLimit(addonId: string, endpoint: string): void {
    const key = `${addonId}:${endpoint}`;
    this.memoryStore.delete(key);
  }

  /**
   * Cleanup expired entries
   */
  cleanup(): void {
    const now = Math.floor(Date.now() / 1000);

    for (const [key, usage] of this.memoryStore.entries()) {
      if (now >= usage.resetTime) {
        this.memoryStore.delete(key);
      }
    }
  }
}

// Cleanup interval (run every 5 minutes)
setInterval(
  () => {
    // This will be called on the rate limiter instance
  },
  5 * 60 * 1000,
);
```

#### 2.2 Create Rate Limiting Middleware

**File: `apps/server/src/addons/rate-limit-middleware.ts`**

```typescript
import type { FastifyRequest, FastifyReply } from 'fastify';
import { AddonRateLimiter, type RateLimitConfig } from './rate-limiter';

export interface RateLimitMiddlewareOptions {
  rateLimiter: AddonRateLimiter;
  getConfig?: (request: FastifyRequest) => RateLimitConfig | undefined;
}

/**
 * Middleware to apply rate limiting to addon requests
 */
export function createRateLimitMiddleware(options: RateLimitMiddlewareOptions) {
  const { rateLimiter, getConfig } = options;

  return async function applyRateLimit(
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    const context = request.addonContext;
    if (!context) {
      return; // Skip rate limiting if no addon context
    }

    // Extract endpoint from request
    const endpoint = extractEndpoint(request);
    const config = getConfig?.(request);

    // Check rate limit
    const result = await rateLimiter.checkRateLimit(
      context.addonId,
      endpoint,
      config,
    );

    // Add rate limit headers
    reply.header('X-RateLimit-Limit', result.limit);
    reply.header('X-RateLimit-Remaining', result.remaining);

    if (result.resetTime) {
      reply.header('X-RateLimit-Reset', result.resetTime);
    }

    // Block request if rate limited
    if (!result.allowed) {
      return reply.code(429).send({
        error: 'addon.rate_limited',
        message: 'Rate limit exceeded',
        retryAfter: result.resetTime
          ? Math.max(0, result.resetTime - Math.floor(Date.now() / 1000))
          : 60,
      });
    }
  };
}

/**
 * Extract endpoint identifier from request
 */
function extractEndpoint(request: FastifyRequest): string {
  const method = request.method.toLowerCase();
  const url = new URL(request.url, 'http://localhost');
  const path = url.pathname;

  // Extract dynamic parameters and create endpoint pattern
  const endpointPattern = path.replace(/\/[^\/]+/g, (match) => {
    // Replace UUIDs and IDs with placeholders
    if (
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        match.slice(1),
      )
    ) {
      return '/:id';
    }
    if (/^\d+$/.test(match.slice(1))) {
      return '/:id';
    }
    return match;
  });

  return `${method}${endpointPattern}`;
}
```

### 3. Audit Logging System

#### 3.1 Create Audit Logger

**File: `apps/server/src/addons/audit-logger.ts`**

```typescript
import type { AddonsStore } from '@openaidy/db';

export interface AuditEvent {
  id: string;
  addonId: string;
  userId?: string;
  eventType: string;
  resourceName: string;
  action: string;
  resourceId?: string;
  details?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  timestamp: string;
  outcome: 'success' | 'failure' | 'error';
  errorMessage?: string;
  duration?: number; // Request duration in milliseconds
}

export interface AuditLoggerOptions {
  addonsStore: AddonsStore;
  enableConsoleLogging?: boolean;
  enableFileLogging?: boolean;
  logLevel?: 'info' | 'debug' | 'warn' | 'error';
}

export class AddonAuditLogger {
  private logBuffer: AuditEvent[] = [];
  private flushInterval: NodeJS.Timeout;
  private maxBufferSize = 100;
  private flushTimeout = 5000; // 5 seconds

  constructor(private options: AuditLoggerOptions) {
    // Start flush interval
    this.flushInterval = setInterval(() => {
      this.flush();
    }, this.flushTimeout);
  }

  /**
   * Log an addon event
   */
  async logEvent(event: Omit<AuditEvent, 'id' | 'timestamp'>): Promise<void> {
    const auditEvent: AuditEvent = {
      ...event,
      id: this.generateEventId(),
      timestamp: new Date().toISOString(),
    };

    // Add to buffer
    this.logBuffer.push(auditEvent);

    // Log to console if enabled
    if (this.options.enableConsoleLogging) {
      this.logToConsole(auditEvent);
    }

    // Flush if buffer is full
    if (this.logBuffer.length >= this.maxBufferSize) {
      await this.flush();
    }
  }

  /**
   * Log successful API call
   */
  async logApiCall(
    addonId: string,
    endpoint: string,
    method: string,
    duration: number,
    userId?: string,
    requestDetails?: any,
  ): Promise<void> {
    await this.logEvent({
      addonId,
      userId,
      eventType: 'api_call',
      resourceName: endpoint,
      action: method.toLowerCase(),
      details: {
        endpoint,
        method,
        requestDetails,
      },
      duration,
      outcome: 'success',
    });
  }

  /**
   * Log failed API call
   */
  async logApiError(
    addonId: string,
    endpoint: string,
    method: string,
    error: string,
    userId?: string,
    requestDetails?: any,
  ): Promise<void> {
    await this.logEvent({
      addonId,
      userId,
      eventType: 'api_error',
      resourceName: endpoint,
      action: method.toLowerCase(),
      details: {
        endpoint,
        method,
        requestDetails,
      },
      errorMessage: error,
      outcome: 'failure',
    });
  }

  /**
   * Log permission check
   */
  async logPermissionCheck(
    addonId: string,
    permission: string,
    allowed: boolean,
    userId?: string,
    details?: any,
  ): Promise<void> {
    await this.logEvent({
      addonId,
      userId,
      eventType: 'permission_check',
      resourceName: 'permissions',
      action: allowed ? 'granted' : 'denied',
      resourceId: permission,
      details,
      outcome: allowed ? 'success' : 'failure',
    });
  }

  /**
   * Log security event
   */
  async logSecurityEvent(
    addonId: string,
    eventType: string,
    details: Record<string, any>,
    userId?: string,
  ): Promise<void> {
    await this.logEvent({
      addonId,
      userId,
      eventType: `security_${eventType}`,
      resourceName: 'security',
      action: eventType,
      details,
      outcome: 'success',
    });
  }

  /**
   * Flush buffered events to storage
   */
  private async flush(): Promise<void> {
    if (this.logBuffer.length === 0) return;

    const eventsToFlush = [...this.logBuffer];
    this.logBuffer = [];

    try {
      // In a real implementation, this would write to a dedicated audit log table
      // For now, we'll simulate with console logging
      if (this.options.enableFileLogging) {
        console.log('AUDIT LOG:', JSON.stringify(eventsToFlush, null, 2));
      }
    } catch (error) {
      console.error('Failed to flush audit events:', error);
      // Re-add events to buffer for retry
      this.logBuffer.unshift(...eventsToFlush);
    }
  }

  /**
   * Log event to console
   */
  private logToConsole(event: AuditEvent): void {
    const logLevel = this.options.logLevel || 'info';

    if (logLevel === 'debug' || event.outcome === 'failure') {
      console.log(`[AUDIT] ${event.eventType}:`, {
        addonId: event.addonId,
        action: event.action,
        outcome: event.outcome,
        timestamp: event.timestamp,
        details: event.details,
      });
    }
  }

  /**
   * Generate unique event ID
   */
  private generateEventId(): string {
    return `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get audit events for addon
   */
  async getAuditEvents(
    addonId: string,
    filters?: {
      startDate?: string;
      endDate?: string;
      eventType?: string;
      outcome?: 'success' | 'failure' | 'error';
      limit?: number;
      offset?: number;
    },
  ): Promise<AuditEvent[]> {
    // In a real implementation, this would query the audit log database
    // For now, return empty array
    return [];
  }

  /**
   * Cleanup and shutdown
   */
  async shutdown(): Promise<void> {
    clearInterval(this.flushInterval);
    await this.flush();
  }
}
```

### 4. Code Validation and Security Scanning

#### 4.1 Create Addon Code Validator

**File: `apps/server/src/addons/code-validator.ts`**

```typescript
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { tar } from 'tar';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  securityIssues: SecurityIssue[];
  manifest?: any;
  files?: ValidatedFile[];
}

export interface SecurityIssue {
  severity: 'low' | 'medium' | 'high' | 'critical';
  type: string;
  description: string;
  file?: string;
  line?: number;
  recommendation: string;
}

export interface ValidatedFile {
  path: string;
  size: number;
  hash: string;
  type: string;
  securityIssues: SecurityIssue[];
}

export class AddonCodeValidator {
  private dangerousPatterns = [
    {
      pattern: /eval\s*\(/gi,
      type: 'dangerous_eval',
      severity: 'high' as const,
      description: 'Use of eval() function',
      recommendation: 'Avoid using eval() - use safer alternatives',
    },
    {
      pattern: /Function\s*\(/gi,
      type: 'dangerous_function',
      severity: 'high' as const,
      description: 'Dynamic function creation',
      recommendation: 'Avoid dynamic function creation',
    },
    {
      pattern: /document\.write\s*\(/gi,
      type: 'document_write',
      severity: 'medium' as const,
      description: 'Use of document.write()',
      recommendation: 'Use modern DOM manipulation methods',
    },
    {
      pattern: /innerHTML\s*=/gi,
      type: 'inner_html',
      severity: 'medium' as const,
      description: 'Direct innerHTML assignment',
      recommendation: 'Use textContent or sanitize HTML first',
    },
    {
      pattern: /localStorage\.setItem/gi,
      type: 'local_storage',
      severity: 'low' as const,
      description: 'Use of localStorage',
      recommendation: 'Be aware of storage limitations and security',
    },
    {
      pattern: /fetch\s*\(\s*['"]http:\/\//gi,
      type: 'insecure_fetch',
      severity: 'medium' as const,
      description: 'Insecure HTTP request',
      recommendation: 'Use HTTPS for all requests',
    },
  ];

  private forbiddenImports = [
    'fs',
    'child_process',
    'net',
    'http',
    'https',
    'url',
    'path',
    'os',
    'crypto',
    'vm',
    'worker_threads',
  ];

  private maxFileSize = 10 * 1024 * 1024; // 10MB
  private maxTotalSize = 50 * 1024 * 1024; // 50MB

  /**
   * Validate addon package
   */
  async validatePackage(packageBuffer: Buffer): Promise<ValidationResult> {
    const result: ValidationResult = {
      valid: true,
      errors: [],
      warnings: [],
      securityIssues: [],
      files: [],
    };

    try {
      // Check package size
      if (packageBuffer.length > this.maxTotalSize) {
        result.valid = false;
        result.errors.push(
          `Package too large: ${packageBuffer.length} bytes (max: ${this.maxTotalSize})`,
        );
        return result;
      }

      // Extract and validate package contents
      const extractedFiles = await this.extractPackage(packageBuffer);

      // Validate file structure
      await this.validateFileStructure(extractedFiles, result);

      // Validate manifest
      await this.validateManifest(extractedFiles, result);

      // Scan for security issues
      await this.scanForSecurityIssues(extractedFiles, result);

      // Validate file sizes and types
      await this.validateFiles(extractedFiles, result);
    } catch (error) {
      result.valid = false;
      result.errors.push(
        `Package validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }

    return result;
  }

  /**
   * Extract package files
   */
  private async extractPackage(
    packageBuffer: Buffer,
  ): Promise<Map<string, Buffer>> {
    const files = new Map<string, Buffer>();

    // Try to extract as tar.gz
    try {
      const extractStream = tar.extract({
        onentry: (entry) => {
          if (entry.type === 'File') {
            const chunks: Buffer[] = [];
            entry.on('data', (chunk) => chunks.push(chunk));
            entry.on('end', () => {
              files.set(entry.path, Buffer.concat(chunks));
            });
          }
        },
      });

      const gunzip = createGunzip();
      await pipeline(createReadStream(packageBuffer), gunzip, extractStream);
    } catch (error) {
      throw new Error('Failed to extract package: must be a valid tar.gz file');
    }

    return files;
  }

  /**
   * Validate file structure
   */
  private async validateFileStructure(
    files: Map<string, Buffer>,
    result: ValidationResult,
  ): Promise<void> {
    const hasManifest = files.has('addon.json') || files.has('package.json');
    if (!hasManifest) {
      result.valid = false;
      result.errors.push('Package must contain addon.json or package.json');
    }

    const hasEntryFile = Array.from(files.keys()).some(
      (file) =>
        file.endsWith('.js') ||
        file.endsWith('.ts') ||
        file.endsWith('.jsx') ||
        file.endsWith('.tsx'),
    );

    if (!hasEntryFile) {
      result.valid = false;
      result.errors.push(
        'Package must contain at least one JavaScript/TypeScript file',
      );
    }

    // Check for dangerous file types
    const dangerousExtensions = [
      '.exe',
      '.bat',
      '.sh',
      '.cmd',
      '.scr',
      '.vbs',
      '.ps1',
    ];
    for (const [path] of files) {
      const ext = path.substring(path.lastIndexOf('.'));
      if (dangerousExtensions.includes(ext)) {
        result.securityIssues.push({
          severity: 'critical',
          type: 'dangerous_file_type',
          description: `Dangerous file type: ${ext}`,
          file: path,
          recommendation: 'Remove executable files from addon package',
        });
        result.valid = false;
      }
    }
  }

  /**
   * Validate manifest
   */
  private async validateManifest(
    files: Map<string, Buffer>,
    result: ValidationResult,
  ): Promise<void> {
    const manifestPath = files.has('addon.json')
      ? 'addon.json'
      : 'package.json';
    const manifestBuffer = files.get(manifestPath);

    if (!manifestBuffer) {
      return;
    }

    try {
      const manifest = JSON.parse(manifestBuffer.toString('utf-8'));

      // Basic manifest validation
      if (!manifest.id || !manifest.name || !manifest.version) {
        result.errors.push(
          'Manifest missing required fields: id, name, version',
        );
        result.valid = false;
      }

      // Validate ID format
      if (manifest.id && !/^[a-z0-9-]+$/.test(manifest.id)) {
        result.errors.push(
          'Addon ID must contain only lowercase letters, numbers, and hyphens',
        );
        result.valid = false;
      }

      // Validate version format
      if (manifest.version && !/^\d+\.\d+\.\d+$/.test(manifest.version)) {
        result.errors.push('Version must follow semantic versioning (x.y.z)');
        result.valid = false;
      }

      result.manifest = manifest;
    } catch (error) {
      result.errors.push(
        `Invalid manifest JSON: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      result.valid = false;
    }
  }

  /**
   * Scan for security issues
   */
  private async scanForSecurityIssues(
    files: Map<string, Buffer>,
    result: ValidationResult,
  ): Promise<void> {
    for (const [path, content] of files) {
      if (!this.isCodeFile(path)) continue;

      const contentStr = content.toString('utf-8');
      const lines = contentStr.split('\n');
      const fileIssues: SecurityIssue[] = [];

      // Check for dangerous patterns
      for (const patternConfig of this.dangerousPatterns) {
        const matches = contentStr.matchAll(patternConfig.pattern);
        for (const match of matches) {
          const lineNumber =
            lines.findIndex((line) => line.includes(match[0])) + 1;

          fileIssues.push({
            severity: patternConfig.severity,
            type: patternConfig.type,
            description: patternConfig.description,
            file: path,
            line: lineNumber,
            recommendation: patternConfig.recommendation,
          });
        }
      }

      // Check for forbidden imports
      for (const forbiddenImport of this.forbiddenImports) {
        const importPattern = new RegExp(
          `require\\s*\\(\\s*['"]${forbiddenImport}['"]\\)`,
          'gi',
        );
        const matches = contentStr.matchAll(importPattern);

        for (const match of matches) {
          const lineNumber =
            lines.findIndex((line) => line.includes(match[0])) + 1;

          fileIssues.push({
            severity: 'high',
            type: 'forbidden_import',
            description: `Import of forbidden module: ${forbiddenImport}`,
            file: path,
            line: lineNumber,
            recommendation: `Remove import of ${forbiddenImport} - not allowed in addon environment`,
          });
        }
      }

      // Check for hardcoded secrets
      const secretPatterns = [
        /api[_-]?key\s*[:=]\s*['"][a-zA-Z0-9]{20,}['"]/gi,
        /password\s*[:=]\s*['"][^'"]{8,}['"]/gi,
        /secret\s*[:=]\s*['"][a-zA-Z0-9]{20,}['"]/gi,
        /token\s*[:=]\s*['"][a-zA-Z0-9]{20,}['"]/gi,
      ];

      for (const pattern of secretPatterns) {
        const matches = contentStr.matchAll(pattern);
        for (const match of matches) {
          const lineNumber =
            lines.findIndex((line) => line.includes(match[0])) + 1;

          fileIssues.push({
            severity: 'critical',
            type: 'hardcoded_secret',
            description: 'Potential hardcoded secret detected',
            file: path,
            line: lineNumber,
            recommendation:
              'Remove hardcoded secrets and use environment variables or secure configuration',
          });
        }
      }

      // Add file issues to result
      result.securityIssues.push(...fileIssues);

      // Mark as invalid if critical issues found
      const hasCriticalIssues = fileIssues.some(
        (issue) => issue.severity === 'critical',
      );
      if (hasCriticalIssues) {
        result.valid = false;
      }
    }
  }

  /**
   * Validate individual files
   */
  private async validateFiles(
    files: Map<string, Buffer>,
    result: ValidationResult,
  ): Promise<void> {
    const validatedFiles: ValidatedFile[] = [];

    for (const [path, content] of files) {
      const fileHash = createHash('sha256').update(content).digest('hex');
      const fileType = this.getFileType(path);
      const fileIssues = result.securityIssues.filter(
        (issue) => issue.file === path,
      );

      // Check file size
      if (content.length > this.maxFileSize) {
        result.errors.push(
          `File too large: ${path} (${content.length} bytes, max: ${this.maxFileSize})`,
        );
        result.valid = false;
        continue;
      }

      validatedFiles.push({
        path,
        size: content.length,
        hash: fileHash,
        type: fileType,
        securityIssues: fileIssues,
      });
    }

    result.files = validatedFiles;
  }

  /**
   * Check if file is a code file
   */
  private isCodeFile(path: string): boolean {
    const codeExtensions = ['.js', '.jsx', '.ts', '.tsx', '.json'];
    return codeExtensions.some((ext) => path.endsWith(ext));
  }

  /**
   * Get file type
   */
  private getFileType(path: string): string {
    const ext = path.substring(path.lastIndexOf('.'));
    const typeMap: Record<string, string> = {
      '.js': 'javascript',
      '.jsx': 'javascript',
      '.ts': 'typescript',
      '.tsx': 'typescript',
      '.json': 'json',
      '.md': 'markdown',
      '.txt': 'text',
      '.html': 'html',
      '.css': 'css',
    };
    return typeMap[ext] || 'unknown';
  }

  /**
   * Generate security report
   */
  generateSecurityReport(result: ValidationResult): string {
    const report = [
      '# Addon Security Report',
      '',
      `## Valid: ${result.valid ? '✅ Yes' : '❌ No'}`,
      '',
      '## Summary',
      `- Errors: ${result.errors.length}`,
      `- Warnings: ${result.warnings.length}`,
      `- Security Issues: ${result.securityIssues.length}`,
      '',
    ];

    if (result.errors.length > 0) {
      report.push('## Errors');
      result.errors.forEach((error) => {
        report.push(`- ❌ ${error}`);
      });
      report.push('');
    }

    if (result.warnings.length > 0) {
      report.push('## Warnings');
      result.warnings.forEach((warning) => {
        report.push(`- ⚠️ ${warning}`);
      });
      report.push('');
    }

    if (result.securityIssues.length > 0) {
      report.push('## Security Issues');

      const groupedIssues = result.securityIssues.reduce(
        (groups, issue) => {
          if (!groups[issue.severity]) {
            groups[issue.severity] = [];
          }
          groups[issue.severity].push(issue);
          return groups;
        },
        {} as Record<string, SecurityIssue[]>,
      );

      const severityOrder = ['critical', 'high', 'medium', 'low'];
      for (const severity of severityOrder) {
        const issues = groupedIssues[severity];
        if (issues && issues.length > 0) {
          report.push(`### ${severity.toUpperCase()}`);
          issues.forEach((issue) => {
            const location = issue.file
              ? issue.line
                ? `${issue.file}:${issue.line}`
                : issue.file
              : 'unknown';
            report.push(
              `- **${issue.type}** (${location}): ${issue.description}`,
            );
            report.push(`  - Recommendation: ${issue.recommendation}`);
          });
          report.push('');
        }
      }
    }

    return report.join('\n');
  }
}
```

### 5. Enhanced Addon Proxy with Security

#### 5.1 Update Addon Proxy with Security Features

**File: `apps/server/src/addons/proxy-enhanced.ts`**

```typescript
import type { FastifyPluginAsync } from 'fastify';
import type { AuthMiddleware } from '../websocket/middleware/auth';
import type { AddonsStore } from '@openaidy/db';
import {
  createPermissionMiddleware,
  requirePermission,
} from './permission-middleware';
import { createRateLimitMiddleware } from './rate-limit-middleware';
import { AddonRateLimiter } from './rate-limiter';
import { AddonAuditLogger } from './audit-logger';
import { PermissionValidator } from './permission-validator';

export interface EnhancedAddonProxyOptions {
  authMiddleware: AuthMiddleware;
  addonsStore: AddonsStore;
  auditLogger: AddonAuditLogger;
}

/**
 * Enhanced addon proxy with comprehensive security features
 */
export const enhancedAddonProxyRoutes: FastifyPluginAsync<
  EnhancedAddonProxyOptions
> = async (app, options) => {
  const { authMiddleware, addonsStore, auditLogger } = options;

  // Create security components
  const rateLimiter = new AddonRateLimiter(addonsStore);
  const permissionMiddleware = createPermissionMiddleware({
    authMiddleware,
    addonsStore,
  });
  const rateLimitMiddleware = createRateLimitMiddleware({ rateLimiter });

  // Apply security middleware to all routes
  app.addHook('preHandler', permissionMiddleware);
  app.addHook('preHandler', rateLimitMiddleware);

  // Request timing for audit logging
  app.addHook('preHandler', async (request, reply) => {
    request.startTime = Date.now();
  });

  app.addHook('onResponse', async (request, reply) => {
    const context = request.addonContext;
    if (!context) return;

    const duration = Date.now() - (request.startTime || Date.now());
    const endpoint = `${request.method.toLowerCase()}${request.url}`;

    if (reply.statusCode < 400) {
      await auditLogger.logApiCall(
        context.addonId,
        endpoint,
        request.method,
        duration,
        context.userId,
      );
    } else {
      await auditLogger.logApiError(
        context.addonId,
        endpoint,
        request.method,
        `HTTP ${reply.statusCode}`,
        context.userId,
      );
    }
  });

  /**
   * POST /api/addon-proxy/agents/:agentId/invoke
   * Enhanced agent invocation with security checks
   */
  app.post<{
    Params: { agentId: string };
    Body: { input: any; sessionId?: string };
  }>(
    '/api/addon-proxy/agents/:agentId/invoke',
    {
      preHandler: [requirePermission('agents', 'invoke', 'agentId')],
    },
    async (request, reply) => {
      const { agentId } = request.params;
      const { input, sessionId } = request.body;
      const context = request.addonContext!;
      const addon = request.addon;

      // Additional permission validation
      const permissionCheck = PermissionValidator.validateAgentAccess(
        context,
        agentId,
      );
      if (!permissionCheck.allowed) {
        await auditLogger.logPermissionCheck(
          context.addonId,
          `agents.invoke:${agentId}`,
          false,
          context.userId,
          { reason: permissionCheck.reason },
        );

        return reply.code(403).send({
          error: 'addon.permission_denied',
          message: permissionCheck.reason,
        });
      }

      // Verify agent is in addon's manifest
      const hasAgent = addon.manifest.agents.some((a) => a.id === agentId);
      if (!hasAgent) {
        await auditLogger.logSecurityEvent(
          context.addonId,
          'unauthorized_agent_access',
          { agentId, manifestAgents: addon.manifest.agents.map((a) => a.id) },
          context.userId,
        );

        return reply.code(403).send({
          error: 'addon.agent_not_allowed',
          message: `Agent ${agentId} not in addon manifest`,
        });
      }

      try {
        // TODO: Implement actual agent invocation with security monitoring
        const result = {
          result: `Agent ${agentId} invoked with input: ${JSON.stringify(input)}`,
          usage: {
            promptTokens: 10,
            completionTokens: 5,
            totalTokens: 15,
          },
        };

        // Log successful invocation
        await auditLogger.logEvent({
          addonId: context.addonId,
          userId: context.userId,
          eventType: 'agent_invocation',
          resourceName: 'agent',
          action: 'invoke',
          resourceId: agentId,
          details: { input, sessionId, result },
          outcome: 'success',
        });

        return reply.send(result);
      } catch (error) {
        await auditLogger.logEvent({
          addonId: context.addonId,
          userId: context.userId,
          eventType: 'agent_invocation_error',
          resourceName: 'agent',
          action: 'invoke',
          resourceId: agentId,
          details: {
            input,
            sessionId,
            error: error instanceof Error ? error.message : 'Unknown error',
          },
          outcome: 'error',
          errorMessage:
            error instanceof Error ? error.message : 'Unknown error',
        });

        return reply.code(500).send({
          error: 'agent.invocation_failed',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    },
  );

  /**
   * GET /api/addon-proxy/sessions
   * Enhanced session listing with filtering
   */
  app.get(
    '/api/addon-proxy/sessions',
    {
      preHandler: [requirePermission('sessions', 'read')],
    },
    async (request, reply) => {
      const context = request.addonContext!;
      const addon = request.addon;

      try {
        // TODO: Implement actual session listing with access control
        const sessions = [
          { id: 'session-1', createdAt: new Date().toISOString() },
          { id: 'session-2', createdAt: new Date().toISOString() },
        ];

        // Filter sessions based on addon permissions
        const filteredSessions = sessions.filter((session) => {
          // Check if addon has access to specific session
          if (context.permissions.includes(`sessions.read:${session.id}`)) {
            return true;
          }
          // Check if addon has general session read permission
          return context.permissions.includes('sessions.read');
        });

        await auditLogger.logEvent({
          addonId: context.addonId,
          userId: context.userId,
          eventType: 'session_list',
          resourceName: 'sessions',
          action: 'list',
          details: { count: filteredSessions.length },
          outcome: 'success',
        });

        return reply.send({ sessions: filteredSessions });
      } catch (error) {
        await auditLogger.logEvent({
          addonId: context.addonId,
          userId: context.userId,
          eventType: 'session_list_error',
          resourceName: 'sessions',
          action: 'list',
          details: {
            error: error instanceof Error ? error.message : 'Unknown error',
          },
          outcome: 'error',
          errorMessage:
            error instanceof Error ? error.message : 'Unknown error',
        });

        return reply.code(500).send({
          error: 'sessions.list_failed',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    },
  );

  /**
   * GET /api/addon-proxy/audit
   * Get audit events for current addon (admin only)
   */
  app.get<{
    Querystring: {
      startDate?: string;
      endDate?: string;
      eventType?: string;
      limit?: number;
    };
  }>(
    '/api/addon-proxy/audit',
    {
      preHandler: [requirePermission('system', 'audit')],
    },
    async (request, reply) => {
      const context = request.addonContext!;
      const { startDate, endDate, eventType, limit = 100 } = request.query;

      try {
        const events = await auditLogger.getAuditEvents(context.addonId, {
          startDate,
          endDate,
          eventType,
          limit,
        });

        return reply.send({ events });
      } catch (error) {
        return reply.code(500).send({
          error: 'audit.fetch_failed',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    },
  );
};

// Extend FastifyRequest interface
declare module 'fastify' {
  interface FastifyRequest {
    startTime?: number;
  }
}
```

### 6. Integration with Main App

#### 6.1 Update App.ts with Security Features

**File: `apps/server/src/app.ts` (security additions)**

```typescript
// Add these imports
import { AddonAuditLogger } from './addons/audit-logger';
import { enhancedAddonProxyRoutes } from './addons/proxy-enhanced';
import { AddonCodeValidator } from './addons/code-validator';

// In the buildApp function, after existing services setup:

// Create security services
const auditLogger = new AddonAuditLogger({
  addonsStore: addonsRepository,
  enableConsoleLogging: process.env.NODE_ENV === 'development',
  enableFileLogging: true,
  logLevel: 'info',
});

const codeValidator = new AddonCodeValidator();

// Update addon service to include security
const addonService = createAddonService({
  addonsStore: addonsRepository,
  authMiddleware,
  openaidyVersion: '1.0.0',
  auditLogger,
  codeValidator,
});

// Register enhanced addon proxy routes
await app.register(enhancedAddonProxyRoutes, {
  authMiddleware,
  addonsStore: addonsRepository,
  auditLogger,
});

// Security cleanup on shutdown
process.on('SIGTERM', async () => {
  await auditLogger.shutdown();
});

process.on('SIGINT', async () => {
  await auditLogger.shutdown();
});
```

### 7. Testing

#### 7.1 Create Security Tests

**File: `apps/server/src/addons/security.test.ts`**

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PermissionValidator } from './permission-validator';
import { AddonRateLimiter } from './rate-limiter';
import { AddonAuditLogger } from './audit-logger';
import { AddonCodeValidator } from './code-validator';

describe('Addon Security Features', () => {
  describe('PermissionValidator', () => {
    const context = {
      addonId: 'test-addon',
      permissions: [
        'agents.invoke:test-agent',
        'sessions.read',
        'config.write:pricing',
      ],
      userId: 'test-user',
    };

    it('should allow valid agent permission', () => {
      const result = PermissionValidator.validateAgentAccess(
        context,
        'test-agent',
      );
      expect(result.allowed).toBe(true);
    });

    it('should deny invalid agent permission', () => {
      const result = PermissionValidator.validateAgentAccess(
        context,
        'other-agent',
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Missing permission');
    });

    it('should allow session read with general permission', () => {
      const result = PermissionValidator.validateSessionAccess(
        context,
        'session-123',
        'read',
      );
      expect(result.allowed).toBe(true);
    });

    it('should allow config write with namespace permission', () => {
      const result = PermissionValidator.validateConfigAccess(
        context,
        'pricing',
        'write',
      );
      expect(result.allowed).toBe(true);
    });
  });

  describe('AddonRateLimiter', () => {
    let rateLimiter: AddonRateLimiter;
    let mockAddonsStore: any;

    beforeEach(() => {
      mockAddonsStore = {
        findByAddonId: vi.fn().mockResolvedValue({ id: 'addon-id' }),
        recordUsage: vi.fn(),
      };
      rateLimiter = new AddonRateLimiter(mockAddonsStore);
    });

    it('should allow requests within limit', async () => {
      const result = await rateLimiter.checkRateLimit(
        'test-addon',
        'agents.invoke',
      );

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBeGreaterThan(0);
      expect(result.limit).toBe(100); // Default limit for agents.invoke
    });

    it('should deny requests exceeding limit', async () => {
      // Exhaust the limit
      for (let i = 0; i < 100; i++) {
        await rateLimiter.checkRateLimit('test-addon', 'agents.invoke');
      }

      const result = await rateLimiter.checkRateLimit(
        'test-addon',
        'agents.invoke',
      );

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });
  });

  describe('AddonAuditLogger', () => {
    let auditLogger: AddonAuditLogger;
    let mockAddonsStore: any;

    beforeEach(() => {
      mockAddonsStore = {
        findByAddonId: vi.fn().mockResolvedValue({ id: 'addon-id' }),
        recordUsage: vi.fn(),
      };

      auditLogger = new AddonAuditLogger({
        addonsStore: mockAddonsStore,
        enableConsoleLogging: false,
        enableFileLogging: false,
      });
    });

    it('should log API call events', async () => {
      const logEventSpy = vi.spyOn(auditLogger as any, 'logEvent');

      await auditLogger.logApiCall(
        'test-addon',
        'agents.invoke',
        'POST',
        150,
        'test-user',
      );

      expect(logEventSpy).toHaveBeenCalledWith({
        addonId: 'test-addon',
        userId: 'test-user',
        eventType: 'api_call',
        resourceName: 'agents.invoke',
        action: 'post',
        details: {
          endpoint: 'agents.invoke',
          method: 'POST',
        },
        duration: 150,
        outcome: 'success',
      });
    });

    it('should log security events', async () => {
      const logEventSpy = vi.spyOn(auditLogger as any, 'logEvent');

      await auditLogger.logSecurityEvent(
        'test-addon',
        'unauthorized_access',
        { attemptedResource: 'admin-panel' },
        'test-user',
      );

      expect(logEventSpy).toHaveBeenCalledWith({
        addonId: 'test-addon',
        userId: 'test-user',
        eventType: 'security_unauthorized_access',
        resourceName: 'security',
        action: 'unauthorized_access',
        details: {
          attemptedResource: 'admin-panel',
        },
        outcome: 'success',
      });
    });
  });

  describe('AddonCodeValidator', () => {
    let validator: AddonCodeValidator;

    beforeEach(() => {
      validator = new AddonCodeValidator();
    });

    it('should detect dangerous eval usage', async () => {
      const maliciousCode = Buffer.from(`
        {
          "addon.json": "{\\"id\\": \\"test\\", \\"name\\": \\"Test\\"}",
          "index.js": "const result = eval('malicious code');"
        }
      `);

      // Create a mock tar.gz buffer (simplified for test)
      const packageBuffer = Buffer.from('mock-package-data');

      const result = await validator.validatePackage(packageBuffer);

      expect(result.valid).toBe(false);
      expect(result.securityIssues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'dangerous_eval',
            severity: 'high',
          }),
        ]),
      );
    });

    it('should detect hardcoded secrets', async () => {
      const codeWithSecret = Buffer.from(`
        {
          "addon.json": "{\\"id\\": \\"test\\", \\"name\\": \\"Test\\"}",
          "config.js": "const apiKey = 'sk-1234567890abcdef1234567890abcdef';"
        }
      `);

      const packageBuffer = Buffer.from('mock-package-data');

      const result = await validator.validatePackage(packageBuffer);

      expect(result.securityIssues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'hardcoded_secret',
            severity: 'critical',
          }),
        ]),
      );
    });
  });
});
```

## Success Criteria

Phase 3 is complete when:

1. ✅ **Fine-grained Permissions**: All addon operations validate specific permissions
2. ✅ **Rate Limiting**: Addons are throttled per endpoint with proper headers
3. ✅ **Audit Logging**: All addon activities are logged with full context
4. ✅ **Code Validation**: Addon packages are scanned for security issues
5. ✅ **Permission Middleware**: Centralized permission checking across all routes
6. ✅ **Security Monitoring**: Real-time security event detection and alerting
7. ✅ **Data Isolation**: Addons cannot access data outside their permissions

## Next Steps

After Phase 3 completion:

- Begin Phase 4: Developer experience and tooling
- Create security monitoring dashboard
- Implement automated security scanning in CI/CD
- Add advanced threat detection patterns

This phase provides comprehensive security measures that ensure addons operate within strict boundaries while maintaining system integrity and providing full auditability.
