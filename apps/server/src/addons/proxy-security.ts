/**
 * Proxy Security Module
 *
 * Security-specific features for the addon proxy including
 * threat detection, injection prevention, and data protection.
 */

import type { FastifyRequest } from 'fastify';

// ============================================================================
// Types
// ============================================================================

/**
 * Security event types
 */
export type SecurityEventType =
  | 'INJECTION_ATTEMPT'
  | 'RATE_LIMIT_EXCEEDED'
  | 'AUTH_FAILURE'
  | 'PERMISSION_DENIED'
  | 'INVALID_REQUEST'
  | 'SUSPICIOUS_PATTERN'
  | 'PATH_TRAVERSAL_ATTEMPT'
  | 'XSS_ATTEMPT';

/**
 * Security event
 */
export interface SecurityEvent {
  type: SecurityEventType;
  addonId: string;
  timestamp: Date;
  details: Record<string, unknown>;
  severity: 'low' | 'medium' | 'high' | 'critical';
  blocked: boolean;
}

/**
 * Threat detection result
 */
export interface ThreatDetectionResult {
  threats: Threat[];
  isBlocked: boolean;
  score: number;
}

/**
 * A detected threat
 */
export interface Threat {
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  location: string;
  pattern?: string;
}

/**
 * Request security context
 */
export interface RequestSecurityContext {
  ip?: string;
  userAgent?: string;
  contentType?: string;
  contentLength: number;
  urlLength: number;
}

// ============================================================================
// Threat Detection Patterns
// ============================================================================

const INJECTION_PATTERNS = {
  SQL: [
    /(\bSELECT\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bDROP\b|\bUNION\b).*(\bWHERE\b|\bFROM\b|\bSET\b|\bVALUES\b)/i,
    /('|"|;|--|\/\*|\*\/|xp_)/,
    /(OR|AND)\s+\d+\s*=\s*\d+/i,
    /EXEC\s*\(|EXECUTE\s*\(/i,
  ],
  COMMAND: [
    /[;&|`$]/,
    /\b(cat|ls|rm|wget|curl|nc|netcat)\b/i,
    /\.\.\//,
    /(\||;|&)\s*(ls|cat|rm|wget|curl)/i,
  ],
  XSS: [
    /<script/i,
    /javascript:/i,
    /on\w+\s*=/i,
    /<iframe/i,
    /<img[^>]+onerror/i,
  ],
  PATH_TRAVERSAL: [/\.\.\//i, /%2e%2e%2f/i, /%2e%2e\//i],
};

// ============================================================================
// Proxy Security
// ============================================================================

/**
 * ProxySecurity provides security features for the addon proxy
 */
export class ProxySecurity {
  private securityEvents: SecurityEvent[] = [];
  private maxEvents: number;
  private blockedIPs: Set<string> = new Set();
  private suspiciousPatterns: Map<string, number> = new Map();

  constructor(maxEvents: number = 10000) {
    this.maxEvents = maxEvents;
  }

  /**
   * Detect threats in a request
   */
  detectThreats(
    request: FastifyRequest,
    context: RequestSecurityContext,
  ): ThreatDetectionResult {
    const threats: Threat[] = [];
    let score = 0;

    // Check SQL injection
    const sqlThreats = this.detectSQLInjection(request);
    threats.push(...sqlThreats);

    // Check command injection
    const cmdThreats = this.detectCommandInjection(request);
    threats.push(...cmdThreats);

    // Check XSS
    const xssThreats = this.detectXSS(request);
    threats.push(...xssThreats);

    // Check path traversal
    const pathThreats = this.detectPathTraversal(request);
    threats.push(...pathThreats);

    // Calculate threat score
    for (const threat of threats) {
      switch (threat.severity) {
        case 'critical':
          score += 40;
          break;
        case 'high':
          score += 20;
          break;
        case 'medium':
          score += 10;
          break;
        case 'low':
          score += 5;
          break;
      }
    }

    // Check request size limits
    if (context.contentLength > 10 * 1024 * 1024) {
      threats.push({
        type: 'REQUEST_SIZE_EXCEEDED',
        severity: 'high',
        description: `Request size ${context.contentLength} exceeds maximum of 10MB`,
        location: 'content-length',
      });
      score += 20;
    }

    // Check URL length limits
    if (context.urlLength > 8192) {
      threats.push({
        type: 'URL_LENGTH_EXCEEDED',
        severity: 'medium',
        description: `URL length ${context.urlLength} exceeds maximum of 8192 characters`,
        location: 'url',
      });
      score += 10;
    }

    const isBlocked = threats.some((t) => t.severity === 'critical');

    return { threats, isBlocked, score: Math.min(100, score) };
  }

  /**
   * Detect SQL injection patterns
   */
  private detectSQLInjection(request: FastifyRequest): Threat[] {
    const threats: Threat[] = [];
    const body = request.body as string | undefined;
    const query = request.url;

    const contentToCheck = [body, query].filter(Boolean).join(' ');

    for (const pattern of INJECTION_PATTERNS.SQL) {
      if (pattern.test(contentToCheck)) {
        threats.push({
          type: 'SQL_INJECTION',
          severity: 'critical',
          description: 'Potential SQL injection detected',
          location: 'body/query',
          pattern: pattern.source,
        });
      }
    }

    return threats;
  }

  /**
   * Detect command injection patterns
   */
  private detectCommandInjection(request: FastifyRequest): Threat[] {
    const threats: Threat[] = [];
    const body = request.body as string | undefined;
    const query = request.url;

    const contentToCheck = [body, query].filter(Boolean).join(' ');

    for (const pattern of INJECTION_PATTERNS.COMMAND) {
      if (pattern.test(contentToCheck)) {
        threats.push({
          type: 'COMMAND_INJECTION',
          severity: 'critical',
          description: 'Potential command injection detected',
          location: 'body/query',
          pattern: pattern.source,
        });
      }
    }

    return threats;
  }

  /**
   * Detect XSS patterns
   */
  private detectXSS(request: FastifyRequest): Threat[] {
    const threats: Threat[] = [];
    const query = request.url;

    for (const pattern of INJECTION_PATTERNS.XSS) {
      if (pattern.test(query)) {
        threats.push({
          type: 'XSS',
          severity: 'high',
          description: 'Potential XSS attack detected',
          location: 'query',
          pattern: pattern.source,
        });
      }
    }

    return threats;
  }

  /**
   * Detect path traversal patterns
   */
  private detectPathTraversal(request: FastifyRequest): Threat[] {
    const threats: Threat[] = [];
    const query = request.url;

    for (const pattern of INJECTION_PATTERNS.PATH_TRAVERSAL) {
      if (pattern.test(query)) {
        threats.push({
          type: 'PATH_TRAVERSAL',
          severity: 'high',
          description: 'Potential path traversal attack detected',
          location: 'url',
          pattern: pattern.source,
        });
      }
    }

    return threats;
  }

  /**
   * Record a security event
   */
  recordSecurityEvent(event: SecurityEvent): void {
    // Clean old events if at capacity
    if (this.securityEvents.length >= this.maxEvents) {
      this.securityEvents = this.securityEvents.slice(
        -Math.floor(this.maxEvents * 0.8),
      );
    }

    this.securityEvents.push(event);

    // Track suspicious patterns for IP
    if (event.type === 'SUSPICIOUS_PATTERN' && event.details.ip) {
      const ip = event.details.ip as string;
      const count = (this.suspiciousPatterns.get(ip) ?? 0) + 1;
      this.suspiciousPatterns.set(ip, count);

      // Block IP if too many suspicious requests
      if (count > 100) {
        this.blockedIPs.add(ip);
      }
    }
  }

  /**
   * Get security events
   */
  getSecurityEvents(limit: number = 100): SecurityEvent[] {
    return this.securityEvents.slice(-limit);
  }

  /**
   * Check if an IP is blocked
   */
  isIPBlocked(ip: string): boolean {
    return this.blockedIPs.has(ip);
  }

  /**
   * Unblock an IP
   */
  unblockIP(ip: string): void {
    this.blockedIPs.delete(ip);
    this.suspiciousPatterns.delete(ip);
  }

  /**
   * Get security metrics
   */
  getSecurityMetrics(): {
    totalEvents: number;
    blockedRequests: number;
    topThreatTypes: Array<{ type: SecurityEventType; count: number }>;
    blockedIPs: number;
  } {
    const topThreatTypes = new Map<SecurityEventType, number>();

    for (const event of this.securityEvents) {
      const count = topThreatTypes.get(event.type) ?? 0;
      topThreatTypes.set(event.type, count + 1);
    }

    return {
      totalEvents: this.securityEvents.length,
      blockedRequests: this.securityEvents.filter((e) => e.blocked).length,
      topThreatTypes: Array.from(topThreatTypes.entries())
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
      blockedIPs: this.blockedIPs.size,
    };
  }
}

// ============================================================================
// Data Protection
// ============================================================================

/**
 * Data protection utilities for PII redaction
 */
export class DataProtection {
  private sensitivePatterns: Array<{ pattern: RegExp; replacement: string }> = [
    // Email addresses
    {
      pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
      replacement: '[EMAIL_REDACTED]',
    },
    // Phone numbers
    {
      pattern: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g,
      replacement: '[PHONE_REDACTED]',
    },
    // Social Security Numbers
    { pattern: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: '[SSN_REDACTED]' },
    // Credit card numbers
    {
      pattern: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,
      replacement: '[CARD_REDACTED]',
    },
    // API keys
    { pattern: /\b[A-Za-z0-9]{32,}\b/g, replacement: '[API_KEY_REDACTED]' },
  ];

  /**
   * Redact sensitive data from an object
   */
  redactSensitiveData(data: unknown): unknown {
    if (typeof data === 'string') {
      return this.redactString(data);
    }

    if (Array.isArray(data)) {
      return data.map((item) => this.redactSensitiveData(item));
    }

    if (data !== null && typeof data === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(data)) {
        result[key] = this.redactSensitiveData(value);
      }
      return result;
    }

    return data;
  }

  /**
   * Redact sensitive data from a string
   */
  private redactString(str: string): string {
    let result = str;
    for (const { pattern, replacement } of this.sensitivePatterns) {
      result = result.replace(pattern, replacement);
    }
    return result;
  }

  /**
   * Check if a string contains potential PII
   */
  containsPII(str: string): boolean {
    return this.sensitivePatterns.some(({ pattern }) => pattern.test(str));
  }

  /**
   * Get list of detected PII types
   */
  detectPII(str: string): string[] {
    const detected: string[] = [];

    if (/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/.test(str)) {
      detected.push('email');
    }
    if (/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/.test(str)) {
      detected.push('phone');
    }
    if (/\b\d{3}-\d{2}-\d{4}\b/.test(str)) {
      detected.push('ssn');
    }
    if (/\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/.test(str)) {
      detected.push('credit_card');
    }

    return detected;
  }
}

// ============================================================================
// Security Headers
// ============================================================================

/**
 * Standard security headers for responses
 */
export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Content-Security-Policy': "default-src 'self'",
  'X-Permitted-Cross-Domain-Policies': 'none',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
} as const;

/**
 * Get security headers for a response
 */
export function getSecurityHeaders(): Record<string, string> {
  return { ...SECURITY_HEADERS };
}

// ============================================================================
// Secure Error Responses
// ============================================================================

/**
 * Create a secure error response
 */
export function createSecureErrorResponse(
  error: string,
  message: string,
  requestId: string,
  retryable: boolean = false,
): Record<string, unknown> {
  return {
    error,
    message,
    requestId,
    timestamp: new Date().toISOString(),
    retryable,
  };
}

// ============================================================================
// Default exports
// ============================================================================

export default {
  ProxySecurity,
  DataProtection,
  SECURITY_HEADERS,
  getSecurityHeaders,
  createSecureErrorResponse,
};
