/**
 * Control Plane - Bootstrap Admin Workflow
 *
 * Provides workflow-oriented interface for bootstrap admin operations.
 * This layer normalizes results and errors for CLI consumption while
 * remaining independent from terminal formatting.
 *
 * The record load/persist/inspect logic lives in
 * `../lib/bootstrap-admin-record.js` and is shared with the server's
 * `BootstrapAdminManager` (`apps/server/src/bootstrap-admin.ts`) — this
 * workflow only owns the CLI-specific bits: minting via a raw JWT
 * secret (rather than the server's `AuthMiddleware`) and refusing to
 * mint with the unsafe default secret.
 */

import { randomUUID } from 'node:crypto';
import {
  type WorkflowResult,
  type WorkflowError,
  type BootstrapAdminTokenStatus,
  type BootstrapAdminTokenData,
  type BootstrapAdminInspectResult,
  success,
} from '../types.js';
import {
  signBootstrapAdminJwt,
  verifyBootstrapAdminJwt,
  decodeBootstrapAdminJwtPayload,
  type BootstrapAdminJwtPayload,
} from '../lib/bootstrap-admin-jwt.js';
import {
  BOOTSTRAP_ADMIN_SCOPE,
  loadValidBootstrapAdminRecord,
  persistBootstrapAdminRecord,
  inspectBootstrapAdminRecord,
} from '../lib/bootstrap-admin-record.js';
import type { BootstrapAdminRecord } from '@openaidy/shared-types';

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
  /** JWT token expiry in milliseconds (default 30 days) */
  tokenExpiryMs?: number;
  /** Client ID used for new tokens (default 'bootstrap-admin') */
  clientId?: string;
};

// ============================================================================
// Ensure Token Result Type
// ============================================================================

/**
 * Result of {@link BootstrapAdminWorkflow.ensureToken}.
 *
 * `created: true` means a new token was generated and persisted.
 * `created: false` means an existing valid token was reused.
 */
export type BootstrapAdminEnsureResult = {
  record: BootstrapAdminRecord;
  created: boolean;
};

// ============================================================================
// Unsafe-default detection
// ============================================================================

/**
 * The literal default JWT secret the CLI/server fall back to when
 * WS_TOKEN_SECRET is unset. Mirrors `apps/server/src/websocket/types.ts:21`
 * and `packages/cli/src/lib/config.ts:53`. Refuses to mint a token with
 * this secret — it wouldn't be a real secret.
 */
const UNSAFE_DEFAULT_SECRET = 'change-me-in-production';

// ============================================================================
// Bootstrap Admin Workflow Service
// ============================================================================

/**
 * Bootstrap Admin Workflow Service
 *
 * Provides workflow-oriented methods for bootstrap admin operations so
 * the CLI can mint, persist, and inspect a token without depending on
 * the server's `AuthMiddleware`.
 */
export class BootstrapAdminWorkflow {
  private context: BootstrapAdminContext;
  private currentRecord: BootstrapAdminRecord | null = null;

  constructor(context: BootstrapAdminContext) {
    this.context = context;
  }

  /**
   * Inspect bootstrap admin token state.
   *
   * Read-only: does not generate or persist tokens.
   */
  async inspectToken(): Promise<BootstrapAdminInspectResult> {
    const { enabled, tokenPath, logger } = this.context;

    const outcome = await inspectBootstrapAdminRecord({
      enabled,
      tokenPath,
      decode: (token) => decodeBootstrapAdminJwtPayload(token),
    });

    switch (outcome.status) {
      case 'disabled':
        logger?.info('Bootstrap admin is disabled', { tokenPath });
        break;
      case 'missing':
        logger?.info('Token file not found', { tokenPath });
        break;
      case 'malformed':
        logger?.error('Token file is malformed or has an invalid structure');
        break;
      case 'invalid':
        logger?.error('Token has an invalid JWT format or subject mismatch');
        break;
      case 'expired':
        logger?.warn('Token has expired', {
          expiresAt: outcome.record?.expiresAt,
        });
        break;
      case 'valid':
        logger?.info('Token is valid', { clientId: outcome.record?.clientId });
        break;
    }

    return success({
      status: outcome.status,
      tokenPath: outcome.tokenPath,
      enabled: outcome.enabled,
      ...(outcome.record ? { record: outcome.record } : {}),
    });
  }

  /**
   * Ensure a valid bootstrap-admin token exists at the configured path.
   *
   * - Returns null when bootstrap admin is disabled.
   * - Returns the existing valid record (created: false) when one is
   *   present, structurally valid, signature-valid, and unexpired.
   * - Otherwise generates a fresh token via `signBootstrapAdminJwt` and
   *   persists it atomically (tmp+rename+chmod 0o600).
   *
   * Throws an Error with a user-remediable message when the JWT secret
   * is the unsafe default — refusing to mint a token that would be
   * trivially forgeable by anyone who reads the source.
   */
  async ensureToken(): Promise<BootstrapAdminEnsureResult | null> {
    const { enabled, jwtSecret, logger } = this.context;

    if (!enabled) {
      this.currentRecord = null;
      logger?.info('Bootstrap admin is disabled — ensureToken returning null');
      return null;
    }

    if (jwtSecret === UNSAFE_DEFAULT_SECRET) {
      throw new Error(
        'Refusing to generate token with default JWT secret. Set WS_TOKEN_SECRET in your environment.',
      );
    }

    const existing = await loadValidBootstrapAdminRecord(
      this.context.tokenPath,
      (token) => verifyBootstrapAdminJwt(token, jwtSecret),
    );
    if (existing) {
      this.currentRecord = existing;
      logger?.info('Bootstrap admin token loaded', {
        clientId: existing.clientId,
        tokenPath: this.context.tokenPath,
      });
      return { record: existing, created: false };
    }

    const record = this.createRecord(jwtSecret);
    await persistBootstrapAdminRecord(this.context.tokenPath, record);
    this.currentRecord = record;

    logger?.warn('Bootstrap admin token created', {
      clientId: record.clientId,
      tokenPath: this.context.tokenPath,
    });

    return { record, created: true };
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

  // ============================================================================
  // Private helpers (ensureToken path)
  // ============================================================================

  /**
   * Mint a fresh admin token and derive the record's ISO timestamps
   * from the JWT iat/exp claims.
   */
  private createRecord(secret: string): BootstrapAdminRecord {
    const clientId = this.context.clientId ?? 'bootstrap-admin';
    const expiresInMs = this.context.tokenExpiryMs ?? 30 * 24 * 60 * 60 * 1000;
    const now = Math.floor(Date.now() / 1000);
    const exp = now + Math.floor(expiresInMs / 1000);

    const payload: BootstrapAdminJwtPayload = {
      sub: clientId,
      type: 'access',
      scopes: [BOOTSTRAP_ADMIN_SCOPE],
      iat: now,
      exp,
      jti: randomUUID(),
    };

    const token = signBootstrapAdminJwt(payload, secret);
    const decoded = verifyBootstrapAdminJwt(token, secret);
    if (!decoded) {
      throw new Error('Failed to validate generated bootstrap admin token');
    }

    return {
      clientId: decoded.sub,
      token,
      scopes: [...decoded.scopes],
      createdAt: new Date(decoded.iat * 1000).toISOString(),
      expiresAt: new Date(decoded.exp * 1000).toISOString(),
    };
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
