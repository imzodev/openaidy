/**
 * Enhanced Addon Proxy Service
 *
 * Advanced proxy with comprehensive security features,
 * request validation, response filtering, and monitoring.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import type { AddonService } from './service';
import type { Addon } from '@openaidy/db';
import { AddonProxyService, createAddonProxyService } from './proxy';
import {
  ProxySecurity,
  DataProtection,
  getSecurityHeaders,
  createSecureErrorResponse,
} from './proxy-security';
import { ProxyMonitor, defaultProxyMonitor } from './proxy-monitoring';
import { ProxyCache, defaultProxyCache } from './proxy-cache';

// ============================================================================
// Types
// ============================================================================

export interface RequestValidationConfig {
  maxRequestSize: number;
  allowedContentTypes: string[];
  requiredHeaders: string[];
  maxUrlLength: number;
  sanitizeInput: boolean;
}

/**
 * Response filtering configuration
 */
export interface ResponseFilteringConfig {
  redactSensitiveData: boolean;
  maxResponseSize: number;
  allowedHeaders: string[];
  compressionEnabled: boolean;
}

/**
 * Enhanced proxy options
 */
export interface EnhancedProxyOptions {
  addonService: AddonService;
  internalApiBaseUrl: string;
  security: {
    enableThreatDetection: boolean;
    enableInjectionPrevention: boolean;
    enableDataProtection: boolean;
  };
  validation: RequestValidationConfig;
  filtering: ResponseFilteringConfig;
}

// ============================================================================
// Enhanced Proxy Service
// ============================================================================

/**
 * EnhancedAddonProxyService
 *
 * Provides advanced security features for addon proxying
 */
export class EnhancedAddonProxyService {
  private baseProxy: AddonProxyService;
  private security: ProxySecurity;
  private monitor: ProxyMonitor;
  private cache: ProxyCache;
  private dataProtection: DataProtection;
  private validationConfig: RequestValidationConfig;
  private filteringConfig: ResponseFilteringConfig;
  private securityEnabled: boolean;

  constructor(options: EnhancedProxyOptions) {
    this.baseProxy = createAddonProxyService(
      options.addonService,
      options.internalApiBaseUrl,
    );
    this.security = new ProxySecurity();
    this.monitor = options.security.enableThreatDetection
      ? new ProxyMonitor({
          enableMetrics: true,
          enableTracing: true,
          enableSecurityTracking: true,
          metricsRetentionDays: 7,
          sampleRate: 1.0,
        })
      : defaultProxyMonitor;
    this.cache = options.security.enableDataProtection
      ? new ProxyCache()
      : defaultProxyCache;
    this.dataProtection = new DataProtection();
    this.validationConfig = options.validation;
    this.filteringConfig = options.filtering;
    this.securityEnabled = options.security.enableInjectionPrevention;
  }

  /**
   * Process a request with full security checks
   */
  async processRequest(
    request: FastifyRequest,
    reply: FastifyReply,
    addon: Addon,
    requiredPermission: string,
  ): Promise<{ success: boolean; response?: unknown; error?: unknown }> {
    const requestId = this.monitor.generateRequestId();
    this.monitor.startRequest(requestId);

    // Set security headers on response
    const securityHeaders = getSecurityHeaders();
    for (const [key, value] of Object.entries(securityHeaders)) {
      reply.header(key, value);
    }

    try {
      // Step 1: Request validation
      const validationResult = this.validateRequest(request);
      if (!validationResult.valid) {
        this.recordSecurityEvent('INVALID_REQUEST', addon.id, {
          requestId,
          reason: validationResult.error,
        });

        return this.sendError(
          reply,
          400,
          'INVALID_REQUEST',
          validationResult.error ?? 'Invalid request',
          requestId,
        );
      }

      // Step 2: Threat detection
      if (this.securityEnabled) {
        const threatResult = this.security.detectThreats(request, {
          ip: request.ip ?? 'unknown',
          userAgent: request.headers['user-agent'] ?? '',
          contentType: request.headers['content-type'] ?? '',
          contentLength: this.getContentLength(request),
          urlLength: request.url.length,
        });

        if (threatResult.isBlocked) {
          this.recordSecurityEvent('INJECTION_ATTEMPT', addon.id, {
            requestId,
            threats: threatResult.threats,
            score: threatResult.score,
          });

          return this.sendError(
            reply,
            403,
            'THREAT_DETECTED',
            'Request blocked due to security policy',
            requestId,
          );
        }

        if (threatResult.score > 50) {
          this.recordSecurityEvent('SUSPICIOUS_PATTERN', addon.id, {
            requestId,
            score: threatResult.score,
          });
        }
      }

      // Step 3: Check authorization
      const authResult = this.baseProxy.authorize(addon, requiredPermission);
      if (!authResult.authorized) {
        this.recordSecurityEvent('PERMISSION_DENIED', addon.id, {
          requestId,
          permission: requiredPermission,
        });

        return this.sendError(
          reply,
          403,
          'PERMISSION_DENIED',
          authResult.error ?? 'Permission denied',
          requestId,
        );
      }

      // Step 4: Check cache (for GET requests)
      if (this.cache.isCacheable(request)) {
        const cached = this.cache.get(
          request,
          addon.id,
          (addon.permissions as string[]) ?? [],
        );

        if (cached.cached) {
          this.monitor.endRequest(
            requestId,
            addon.id,
            request.method,
            request.url,
            200,
            true,
          );

          return {
            success: true,
            response: this.filterResponse(cached.value, requestId),
          };
        }
      }

      // Step 5: Process the request (placeholder - actual implementation would call internal APIs)
      const response = await this.processInternalRequest(
        request,
        addon,
        requiredPermission,
      );

      // Step 6: Cache the response if applicable
      if (this.cache.isCacheable(request) && response) {
        this.cache.set(
          request,
          addon.id,
          (addon.permissions as string[]) ?? [],
          response,
        );
      }

      // Step 7: Record metrics and return
      const latency = this.monitor.endRequest(
        requestId,
        addon.id,
        request.method,
        request.url,
        200,
        false,
      );

      // Log performance if slow
      if (latency > 100) {
        this.monitor.recordEvent({
          type: 'SLOW_REQUEST',
          addonId: addon.id,
          details: { latency, path: request.url },
        });
      }

      return {
        success: true,
        response: this.filterResponse(response, requestId),
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      this.monitor.endRequest(
        requestId,
        addon.id,
        request.method,
        request.url,
        500,
        false,
        errorMessage,
      );

      this.recordSecurityEvent('INVALID_REQUEST', addon.id, {
        requestId,
        error: errorMessage,
      });

      return this.sendError(
        reply,
        500,
        'INTERNAL_ERROR',
        'An internal error occurred',
        requestId,
      );
    }
  }

  /**
   * Validate an incoming request
   */
  private validateRequest(request: FastifyRequest): {
    valid: boolean;
    error?: string;
  } {
    // Check URL length
    if (request.url.length > this.validationConfig.maxUrlLength) {
      return {
        valid: false,
        error: `URL exceeds maximum length of ${this.validationConfig.maxUrlLength}`,
      };
    }

    // Check content length
    const contentLength = this.getContentLength(request);
    if (contentLength > this.validationConfig.maxRequestSize) {
      return {
        valid: false,
        error: `Request body exceeds maximum size of ${this.validationConfig.maxRequestSize}`,
      };
    }

    // Check content type for POST/PUT requests
    if (['POST', 'PUT', 'PATCH'].includes(request.method)) {
      const contentType = request.headers['content-type'] ?? '';

      if (
        contentType &&
        !this.validationConfig.allowedContentTypes.some((ct) =>
          contentType.includes(ct),
        )
      ) {
        return {
          valid: false,
          error: `Content-Type '${contentType}' not allowed`,
        };
      }
    }

    // Check required headers
    for (const header of this.validationConfig.requiredHeaders) {
      if (!request.headers[header]) {
        return {
          valid: false,
          error: `Required header '${header}' is missing`,
        };
      }
    }

    return { valid: true };
  }

  /**
   * Get content length from request
   */
  private getContentLength(request: FastifyRequest): number {
    const contentLength = request.headers['content-length'];
    return contentLength ? parseInt(contentLength, 10) : 0;
  }

  /**
   * Process internal API request
   */
  private async processInternalRequest(
    request: FastifyRequest,
    addon: Addon,
    _permission: string,
  ): Promise<unknown> {
    // This is a placeholder - actual implementation would:
    // 1. Forward request to internal API
    // 2. Apply any transformations
    // 3. Return response

    return {
      success: true,
      message: 'Request processed successfully',
      addonId: addon.id,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Filter response data
   */
  private filterResponse(response: unknown, _requestId: string): unknown {
    if (!this.filteringConfig.redactSensitiveData) {
      return response;
    }

    return this.dataProtection.redactSensitiveData(response);
  }

  /**
   * Send a secure error response
   */
  private sendError(
    reply: FastifyReply,
    status: number,
    error: string,
    message: string,
    _requestId: string,
    retryable: boolean = false,
  ): { success: boolean; error: unknown } {
    reply.code(status);

    return {
      success: false,
      error: createSecureErrorResponse(error, message, _requestId, retryable),
    };
  }

  /**
   * Record a security event
   */
  private recordSecurityEvent(
    type: Parameters<typeof this.security.recordSecurityEvent>[0]['type'],
    addonId: string,
    details: Record<string, unknown>,
  ): void {
    this.security.recordSecurityEvent({
      type,
      addonId,
      timestamp: new Date(),
      details,
      severity: type === 'INJECTION_ATTEMPT' ? 'critical' : 'medium',
      blocked: type === 'INJECTION_ATTEMPT',
    });
  }

  /**
   * Get security metrics
   */
  getSecurityMetrics() {
    return this.security.getSecurityMetrics();
  }

  /**
   * Get performance metrics
   */
  getPerformanceMetrics(timeWindowMs?: number) {
    return this.monitor.getPerformanceMetrics(timeWindowMs);
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return this.cache.getStats();
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create an enhanced proxy service
 */
export function createEnhancedAddonProxyService(
  options: EnhancedProxyOptions,
): EnhancedAddonProxyService {
  return new EnhancedAddonProxyService(options);
}

// ============================================================================
// Default Configuration
// ============================================================================

export const DEFAULT_VALIDATION_CONFIG: RequestValidationConfig = {
  maxRequestSize: 10 * 1024 * 1024, // 10MB
  allowedContentTypes: [
    'application/json',
    'application/x-www-form-urlencoded',
  ],
  requiredHeaders: [],
  maxUrlLength: 8192,
  sanitizeInput: true,
};

export const DEFAULT_FILTERING_CONFIG: ResponseFilteringConfig = {
  redactSensitiveData: true,
  maxResponseSize: 10 * 1024 * 1024, // 10MB
  allowedHeaders: ['Content-Type', 'Authorization'],
  compressionEnabled: true,
};

export default EnhancedAddonProxyService;
