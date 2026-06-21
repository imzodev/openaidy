/**
 * Control Plane - Bootstrap Admin Workflow
 *
 * Provides workflow-oriented interface for bootstrap admin operations.
 * This layer normalizes results and errors for CLI consumption while
 * remaining independent from terminal formatting.
 *
 * PR1 (installation-onboarding): adds `signJwt` / `verifyJwt` private
 * helpers and `ensureToken()` method. The JWT primitives mirror
 * `apps/server/src/websocket/middleware/auth.ts:244-265` byte-for-byte
 * (HMAC-SHA256 + base64url + identical payload schema) so a token
 * minted here validates against the server's `AuthMiddleware.validateToken`.
 */

import {
  access,
  mkdir,
  readFile,
  rename,
  writeFile,
  chmod,
} from 'node:fs/promises';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  type WorkflowResult,
  type WorkflowError,
  type BootstrapAdminTokenStatus,
  type BootstrapAdminTokenData,
  type BootstrapAdminInspectResult,
  success,
} from '../types.js';
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
 * and `packages/cli/src/lib/config.ts:53`. PR1 refuses to mint a token
 * with this secret (R-2 / CC-5 — wouldn't be a real secret).
 */
const UNSAFE_DEFAULT_SECRET = 'change-me-in-production';

// ============================================================================
// JWT Primitives (mirror apps/server/src/websocket/middleware/auth.ts)
// ============================================================================

/**
 * JWT payload schema. Identical shape to
 * `apps/server/src/websocket/middleware/auth.ts:20-41`.
 */
type JwtPayload = {
  sub: string;
  type: 'access' | 'refresh' | 'pairing';
  scopes: string[];
  iat: number;
  exp: number;
  jti: string;
  clientType?: string;
  clientVersion?: string;
};

/**
 * Sign a JWT with HMAC-SHA256 + base64url encoding.
 * Byte-for-byte mirror of `apps/server/src/websocket/middleware/auth.ts:244-265`.
 */
function signJwt(payload: JwtPayload, secret: string): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const headerB64 = Buffer.from(JSON.stringify(header), 'utf-8').toString(
    'base64url',
  );
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf-8').toString(
    'base64url',
  );
  const signature = createHmac('sha256', secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');
  return `${headerB64}.${payloadB64}.${signature}`;
}

/**
 * Verify a JWT signature + parse the payload.
 * Returns null on any tampering, malformed shape, or signature mismatch.
 * Byte-for-byte mirror of `apps/server/src/websocket/middleware/auth.ts:270-293`.
 */
function verifyJwt(token: string, secret: string): JwtPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }
    const [header, payload, signature] = parts;
    if (!header || !payload || !signature) {
      return null;
    }
    const expectedSignature = createHmac('sha256', secret)
      .update(`${header}.${payload}`)
      .digest('base64url');
    const provided = Buffer.from(signature, 'utf-8');
    const expected = Buffer.from(expectedSignature, 'utf-8');
    if (provided.length !== expected.length) {
      return null;
    }
    if (!timingSafeEqual(provided, expected)) {
      return null;
    }
    const decoded = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf-8'),
    ) as Record<string, unknown>;
    if (
      typeof decoded.sub !== 'string' ||
      typeof decoded.iat !== 'number' ||
      typeof decoded.exp !== 'number' ||
      !Array.isArray(decoded.scopes)
    ) {
      return null;
    }
    return decoded as unknown as JwtPayload;
  } catch {
    return null;
  }
}

// ============================================================================
// Helpers (existing)
// ============================================================================

/**
 * Decode JWT payload without verification.
 * NOTE: This does NOT verify the signature - that must be done server-side.
 */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = Buffer.from(parts[1] ?? '', 'base64url').toString('utf-8');
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
 * In PR1 this gains `ensureToken()` so the CLI can mint and persist a
 * token without depending on the server's `AuthMiddleware`.
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

    if (!enabled) {
      logger?.info('Bootstrap admin is disabled', { tokenPath });
      return success({
        status: 'disabled' as BootstrapAdminTokenStatus,
        tokenPath,
        enabled: false,
      });
    }

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

    const payload = decodeJwtPayload(parsed.token);
    if (!payload) {
      logger?.error('Token has invalid JWT format');
      return success({
        status: 'invalid' as BootstrapAdminTokenStatus,
        tokenPath,
        enabled: true,
      });
    }

    if (payload.sub !== parsed.clientId) {
      logger?.error('Token subject mismatch', {
        sub: payload.sub,
        clientId: parsed.clientId,
      });
      return success({
        status: 'invalid' as BootstrapAdminTokenStatus,
        tokenPath,
        enabled: true,
      });
    }

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
   * Ensure a valid bootstrap-admin token exists at the configured path.
   *
   * Semantics (mirrors `apps/server/src/bootstrap-admin.ts:42-80`):
   * - Returns null when bootstrap admin is disabled.
   * - Returns the existing valid record (created: false) when one is
   *   present, structurally valid, signature-valid, and unexpired.
   * - Otherwise generates a fresh token via the private `signJwt`
   *   primitive and persists it atomically (tmp+rename+chmod 0o600).
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

    const existing = await this.loadValidRecord(jwtSecret);
    if (existing) {
      this.currentRecord = existing;
      logger?.info('Bootstrap admin token loaded', {
        clientId: existing.clientId,
        tokenPath: this.context.tokenPath,
      });
      return { record: existing, created: false };
    }

    const record = await this.createRecord(jwtSecret);
    await this.persistRecord(record);
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
   * Read and cryptographically validate the existing token record.
   * Returns null for missing files, malformed JSON, missing fields,
   * signature mismatches, or expired tokens.
   */
  private async loadValidRecord(
    secret: string,
  ): Promise<BootstrapAdminRecord | null> {
    let raw: string;
    try {
      raw = await readFile(this.context.tokenPath, 'utf-8');
    } catch {
      return null;
    }

    let parsed: Partial<BootstrapAdminRecord>;
    try {
      parsed = JSON.parse(raw) as Partial<BootstrapAdminRecord>;
    } catch {
      return null;
    }

    if (
      typeof parsed.clientId !== 'string' ||
      typeof parsed.token !== 'string' ||
      !Array.isArray(parsed.scopes) ||
      typeof parsed.createdAt !== 'string' ||
      typeof parsed.expiresAt !== 'string'
    ) {
      return null;
    }

    const payload = verifyJwt(parsed.token, secret);
    if (!payload) {
      return null;
    }

    if (payload.sub !== parsed.clientId) {
      return null;
    }

    if (!parsed.scopes.includes('*')) {
      return null;
    }

    if (isExpired(parsed.expiresAt)) {
      return null;
    }

    return {
      clientId: parsed.clientId,
      token: parsed.token,
      scopes: [...parsed.scopes],
      createdAt: parsed.createdAt,
      expiresAt: parsed.expiresAt,
    };
  }

  /**
   * Mint a fresh admin token via the workflow's `signJwt` primitive
   * and derive the record's ISO timestamps from the JWT iat/exp claims.
   */
  private async createRecord(secret: string): Promise<BootstrapAdminRecord> {
    const clientId = this.context.clientId ?? 'bootstrap-admin';
    const expiresInMs = this.context.tokenExpiryMs ?? 30 * 24 * 60 * 60 * 1000;
    const now = Math.floor(Date.now() / 1000);
    const exp = now + Math.floor(expiresInMs / 1000);

    const payload: JwtPayload = {
      sub: clientId,
      type: 'access',
      scopes: ['*'],
      iat: now,
      exp,
      jti: randomUUID(),
    };

    const token = signJwt(payload, secret);
    const decoded = verifyJwt(token, secret);
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

  /**
   * Atomically write the record via tmp+rename, then chmod 0o600.
   * Mirrors `apps/server/src/bootstrap-admin.ts:148-158`.
   */
  private async persistRecord(record: BootstrapAdminRecord): Promise<void> {
    await mkdir(this.context.tokenPath.replace(/[/\\][^/\\]+$/, ''), {
      recursive: true,
    });

    const tempPath = `${this.context.tokenPath}.tmp`;
    const contents = `${JSON.stringify(record, null, 2)}\n`;

    await writeFile(tempPath, contents, { encoding: 'utf-8', mode: 0o600 });
    await chmod(tempPath, 0o600);
    await rename(tempPath, this.context.tokenPath);
    await chmod(this.context.tokenPath, 0o600);
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
