/**
 * Bootstrap Admin Inspection Workflow
 *
 * Provides read-only inspection of bootstrap-admin token state.
 * Reuses the authoritative logic from BootstrapAdminManager without side effects.
 */

import { readFile, access } from 'node:fs/promises';
import type { FastifyBaseLogger } from 'fastify';
import { AuthMiddleware, CAPABILITIES } from './websocket/middleware/auth';
import type { BootstrapAdminRecord } from '@openaidy/shared-types';

export type BootstrapAdminInspectStatus =
  | 'disabled'
  | 'missing'
  | 'malformed'
  | 'invalid'
  | 'expired'
  | 'valid';

export type BootstrapAdminInspectResult = {
  status: BootstrapAdminInspectStatus;
  record?: BootstrapAdminRecord;
  tokenPath: string;
  enabled: boolean;
  error?: string;
};

export type BootstrapAdminInspectOptions = {
  enabled: boolean;
  tokenPath: string;
  jwtSecret: string;
  logger?: FastifyBaseLogger;
};

/**
 * Inspect bootstrap-admin token state without side effects.
 *
 * This is a read-only operation that:
 * - Checks if bootstrap-admin is disabled
 * - Checks if token file exists
 * - Validates token file format
 * - Verifies token signature and expiration
 *
 * Does NOT create or modify any tokens.
 */
export async function inspectBootstrapAdminToken(
  options: BootstrapAdminInspectOptions,
): Promise<BootstrapAdminInspectResult> {
  const { enabled, tokenPath, jwtSecret, logger } = options;

  // Check if bootstrap-admin is disabled
  if (!enabled) {
    logger?.info({ tokenPath }, 'Bootstrap admin is disabled');
    return {
      status: 'disabled',
      tokenPath,
      enabled: false,
    };
  }

  // Check if token file exists
  try {
    await access(tokenPath);
  } catch {
    logger?.info({ tokenPath }, 'Bootstrap admin token file not found');
    return {
      status: 'missing',
      tokenPath,
      enabled: true,
      error: `Token file not found at ${tokenPath}`,
    };
  }

  // Read and parse token file
  let raw: string;
  try {
    raw = await readFile(tokenPath, 'utf-8');
  } catch (err) {
    logger?.error(
      { tokenPath, err },
      'Failed to read bootstrap admin token file',
    );
    return {
      status: 'malformed',
      tokenPath,
      enabled: true,
      error: `Failed to read token file: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  let parsed: Partial<BootstrapAdminRecord>;
  try {
    parsed = JSON.parse(raw) as Partial<BootstrapAdminRecord>;
  } catch (err) {
    logger?.error(
      { tokenPath, err },
      'Bootstrap admin token file is not valid JSON',
    );
    return {
      status: 'malformed',
      tokenPath,
      enabled: true,
      error: `Token file contains invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Validate required fields
  if (
    typeof parsed.clientId !== 'string' ||
    typeof parsed.token !== 'string' ||
    !Array.isArray(parsed.scopes) ||
    typeof parsed.createdAt !== 'string' ||
    typeof parsed.expiresAt !== 'string'
  ) {
    logger?.error(
      { tokenPath },
      'Bootstrap admin token file has invalid structure',
    );
    return {
      status: 'malformed',
      tokenPath,
      enabled: true,
      error: 'Token file has invalid structure (missing required fields)',
    };
  }

  // Create auth middleware for token validation
  const authMiddleware = new AuthMiddleware({
    enabled: true,
    port: parseInt(process.env.WS_PORT || '3001', 10),
    path: '/ws',
    maxConnections: 1,
    heartbeatInterval: 0,
    auth: {
      required: true,
      secret: jwtSecret,
      tokenExpiry: 0, // Not used for validation
    },
    rateLimit: {
      max: 1,
      window: 0,
    },
  });

  // Validate token signature and structure
  const payload = await authMiddleware.validateToken(parsed.token);
  if (!payload) {
    logger?.error({ tokenPath }, 'Bootstrap admin token has invalid signature');
    return {
      status: 'invalid',
      tokenPath,
      enabled: true,
      error: 'Token has invalid signature or is malformed',
    };
  }

  // Verify token subject matches clientId
  if (payload.sub !== parsed.clientId) {
    logger?.error(
      { tokenPath, payload, clientId: parsed.clientId },
      'Token subject mismatch',
    );
    return {
      status: 'invalid',
      tokenPath,
      enabled: true,
      error: `Token subject (${payload.sub}) does not match clientId (${parsed.clientId})`,
    };
  }

  // Verify admin capability
  if (!parsed.scopes.includes(CAPABILITIES.ADMIN)) {
    logger?.error(
      { tokenPath, scopes: parsed.scopes },
      'Token lacks admin capability',
    );
    return {
      status: 'invalid',
      tokenPath,
      enabled: true,
      error: 'Token does not have admin capability',
    };
  }

  // Check expiration
  const expiresAt = new Date(parsed.expiresAt);
  const now = new Date();

  if (expiresAt <= now) {
    logger?.warn(
      { tokenPath, expiresAt: parsed.expiresAt },
      'Bootstrap admin token has expired',
    );
    return {
      status: 'expired',
      record: {
        clientId: parsed.clientId,
        token: parsed.token,
        scopes: parsed.scopes,
        createdAt: parsed.createdAt,
        expiresAt: parsed.expiresAt,
      },
      tokenPath,
      enabled: true,
      error: `Token expired at ${parsed.expiresAt}`,
    };
  }

  // Token is valid
  logger?.info(
    { tokenPath, clientId: parsed.clientId, expiresAt: parsed.expiresAt },
    'Bootstrap admin token is valid',
  );

  return {
    status: 'valid',
    record: {
      clientId: parsed.clientId,
      token: parsed.token,
      scopes: parsed.scopes,
      createdAt: parsed.createdAt,
      expiresAt: parsed.expiresAt,
    },
    tokenPath,
    enabled: true,
  };
}

/**
 * Format bootstrap-admin inspection result for display.
 * Shows token value intentionally only for this explicit command.
 */
export function formatTokenDisplay(
  result: BootstrapAdminInspectResult,
): string {
  const lines: string[] = [];

  lines.push('Bootstrap Admin Token');
  lines.push('='.repeat(24));
  lines.push('');
  lines.push(`Status:    ${result.status}`);
  lines.push(`Path:      ${result.tokenPath}`);
  lines.push(`Enabled:   ${result.enabled}`);
  lines.push('');

  if (result.record) {
    lines.push(`Client ID: ${result.record.clientId}`);
    lines.push(`Created:   ${result.record.createdAt}`);
    lines.push(`Expires:   ${result.record.expiresAt}`);
    lines.push(`Scopes:    ${result.record.scopes.join(', ')}`);
    lines.push('');

    // Only show token value for valid or expired tokens
    if (result.status === 'valid' || result.status === 'expired') {
      lines.push('Token:');
      lines.push(result.record.token);
    }
  }

  if (result.error) {
    lines.push(`Error: ${result.error}`);
  }

  return lines.join('\n');
}
