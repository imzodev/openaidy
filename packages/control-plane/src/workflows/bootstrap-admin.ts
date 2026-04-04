/**
 * Control Plane - Bootstrap Admin Workflow
 * 
 * Provides workflow-oriented interface for bootstrap admin operations.
 * This layer normalizes results and errors for CLI consumption while
 * remaining independent from terminal formatting.
 */

import { readFile, access } from 'node:fs/promises';
import {
  type WorkflowResult,
  type WorkflowError,
  type BootstrapAdminTokenStatus,
  type BootstrapAdminTokenData,
  type BootstrapAdminInspectResult,
  success,
  failure,
} from '../types.js';

// Re-export types for consumers
export type {
  WorkflowResult,
  WorkflowError,
  BootstrapAdminTokenStatus,
  BootstrapAdminTokenData,
  BootstrapAdminInspectResult,
};

// ============================================================================
// Logger Interface (platform-agnostic)
// ============================================================================

/**
 * Simple logger interface that doesn't depend on fastify.
 */
export interface WorkflowLogger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
  debug(message: string, data?: Record<string, unknown>): void;
}

// ============================================================================
// Workflow Context
// ============================================================================

/**
 * Context passed to bootstrap admin workflows.
 */
export type BootstrapAdminContext = {
  /** Whether bootstrap admin is enabled */
  enabled: boolean;
  /** Path to the token file */
  tokenPath: string;
  /** JWT secret for token validation */
  jwtSecret: string;
  /** Logger instance */
  logger?: WorkflowLogger;
};

// ============================================================================
// JWT Helpers (without external dependencies)
// ============================================================================

/**
 * Decode JWT payload without verification.
 * NOTE: This does NOT verify the signature - that must be done server-side.
 */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = Buffer.from(parts[1], 'base64url').toString('utf-8');
    return JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Check if a date string is expired.
 */
function isExpired(dateStr: string): boolean {
  try {
    return new Date(dateStr).getTime() <= Date.now();
  } catch {
    return true;
  }
}

// ============================================================================
// Bootstrap Admin Workflow Service
// ============================================================================

/**
 * Bootstrap Admin Workflow Service
 * 
 * Provides workflow-oriented methods for bootstrap admin operations.
 * This service performs read-only inspection without external dependencies.
 */
export class BootstrapAdminWorkflow {
  private context: BootstrapAdminContext;

  constructor(context: BootstrapAdminContext) {
    this.context = context;
  }

  /**
   * Inspect bootstrap admin token state.
   * 
   * This is a read-only operation that checks:
   * - If bootstrap-admin is disabled
   * - If token file exists
   * - If token file is valid JSON with required fields
   * - If token is expired
   * 
   * Does NOT verify token signature (that requires server-side crypto).
   */
  async inspectToken(): Promise<BootstrapAdminInspectResult> {
    const { enabled, tokenPath, logger } = this.context;

    // Check if bootstrap-admin is disabled
    if (!enabled) {
      logger?.info('Bootstrap admin is disabled', { tokenPath });
      return success({
        status: 'disabled' as BootstrapAdminTokenStatus,
        tokenPath,
        enabled: false,
      });
    }

    // Check if token file exists
    try {
      await access(tokenPath);
    } catch {
      logger?.info('Token file not found', { tokenPath });
      return success({
        status: 'missing' as BootstrapAdminTokenStatus,
        tokenPath,
        enabled: true,
      });
    }

    // Read token file
    let raw: string;
    try {
      raw = await readFile(tokenPath, 'utf-8');
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger?.error('Failed to read token file', { error: errMsg });
      return success({
        status: 'malformed' as BootstrapAdminTokenStatus,
        tokenPath,
        enabled: true,
      });
    }

    // Parse token file
    let parsed: Partial<BootstrapAdminTokenData>;
    try {
      parsed = JSON.parse(raw) as Partial<BootstrapAdminTokenData>;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger?.error('Token file contains invalid JSON', { error: errMsg });
      return success({
        status: 'malformed' as BootstrapAdminTokenStatus,
        tokenPath,
        enabled: true,
      });
    }

    // Validate required fields
    if (
      typeof parsed.clientId !== 'string' ||
      typeof parsed.token !== 'string' ||
      !Array.isArray(parsed.scopes) ||
      typeof parsed.createdAt !== 'string' ||
      typeof parsed.expiresAt !== 'string'
    ) {
      logger?.error('Token file has invalid structure');
      return success({
        status: 'malformed' as BootstrapAdminTokenStatus,
        tokenPath,
        enabled: true,
      });
    }

    // Validate token format
    const payload = decodeJwtPayload(parsed.token);
    if (!payload) {
      logger?.error('Token has invalid JWT format');
      return success({
        status: 'invalid' as BootstrapAdminTokenStatus,
        tokenPath,
        enabled: true,
      });
    }

    // Verify token subject matches clientId
    if (payload.sub !== parsed.clientId) {
      logger?.error('Token subject mismatch', { 
        sub: payload.sub, 
        clientId: parsed.clientId 
      });
      return success({
        status: 'invalid' as BootstrapAdminTokenStatus,
        tokenPath,
        enabled: true,
      });
    }

    // Check expiration
    if (isExpired(parsed.expiresAt)) {
      logger?.warn('Token has expired', { expiresAt: parsed.expiresAt });
      return success({
        status: 'expired' as BootstrapAdminTokenStatus,
        tokenPath,
        enabled: true,
        record: {
          clientId: parsed.clientId,
          token: parsed.token,
          scopes: parsed.scopes,
          createdAt: parsed.createdAt,
          expiresAt: parsed.expiresAt,
        },
      });
    }

    // Token is structurally valid (signature not verified)
    logger?.info('Token is valid', { clientId: parsed.clientId });
    
    return success({
      status: 'valid' as BootstrapAdminTokenStatus,
      tokenPath,
      enabled: true,
      record: {
        clientId: parsed.clientId,
        token: parsed.token,
        scopes: parsed.scopes,
        createdAt: parsed.createdAt,
        expiresAt: parsed.expiresAt,
      },
    });
  }

  /**
   * Get the path to the bootstrap admin token file.
   */
  getTokenPath(): string {
    return this.context.tokenPath;
  }

  /**
   * Check if bootstrap admin is enabled.
   */
  isEnabled(): boolean {
    return this.context.enabled;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a bootstrap admin workflow service.
 */
export function createBootstrapAdminWorkflow(
  context: BootstrapAdminContext,
): BootstrapAdminWorkflow {
  return new BootstrapAdminWorkflow(context);
}
