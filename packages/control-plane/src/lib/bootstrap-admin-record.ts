/**
 * Bootstrap Admin Record — shared load/persist/inspect logic.
 *
 * This is the single source of truth for the on-disk bootstrap-admin
 * token record: structural validation, expiry checks, atomic
 * persistence, "load if still valid" and read-only inspection. Both
 * `BootstrapAdminWorkflow` (CLI, verifies via a raw JWT secret) and
 * the server's `BootstrapAdminManager` (verifies via `AuthMiddleware`)
 * delegate to these functions instead of each re-implementing them.
 *
 * Signature verification itself is intentionally NOT done here — callers
 * inject a `verify` function so this module has no opinion on how a
 * token is cryptographically checked, only on what a valid *record*
 * looks like.
 */

import { mkdir, readFile, rename, writeFile, chmod } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { BootstrapAdminRecord } from '@openaidy/shared-types';

/** The wildcard scope that marks a token as bootstrap-admin capable. */
export const BOOTSTRAP_ADMIN_SCOPE = '*';

/** Minimal shape a verified JWT payload must have to back a record. */
export type VerifiedBootstrapAdminPayload = {
  sub: string;
  scopes: string[];
};

/**
 * Verify a token's signature and return its payload, or null if the
 * token is invalid/expired/malformed. May be sync or async.
 */
export type BootstrapAdminVerifier = (
  token: string,
) =>
  | Promise<VerifiedBootstrapAdminPayload | null>
  | VerifiedBootstrapAdminPayload
  | null;

/**
 * Decode a token's payload without verifying its signature (used only
 * for read-only inspection). May be sync or async.
 */
export type BootstrapAdminDecoder = (
  token: string,
) => Promise<Record<string, unknown> | null> | Record<string, unknown> | null;

export function isBootstrapAdminRecordExpired(dateStr: string): boolean {
  try {
    return new Date(dateStr).getTime() <= Date.now();
  } catch {
    return true;
  }
}

/** Structural check for the required fields of a persisted record. */
export function hasBootstrapAdminRecordShape(
  parsed: unknown,
): parsed is BootstrapAdminRecord {
  if (!parsed || typeof parsed !== 'object') {
    return false;
  }
  const candidate = parsed as Partial<BootstrapAdminRecord>;
  return (
    typeof candidate.clientId === 'string' &&
    typeof candidate.token === 'string' &&
    Array.isArray(candidate.scopes) &&
    typeof candidate.createdAt === 'string' &&
    typeof candidate.expiresAt === 'string'
  );
}

/**
 * Read and parse the record file. Returns null for a missing file,
 * invalid JSON, or a JSON value that doesn't have the record shape.
 */
async function readRecordFile(
  tokenPath: string,
): Promise<BootstrapAdminRecord | null> {
  let raw: string;
  try {
    raw = await readFile(tokenPath, 'utf-8');
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!hasBootstrapAdminRecordShape(parsed)) {
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
 * Load the on-disk record only if it is structurally valid,
 * cryptographically valid (per `verify`), unexpired, its JWT subject
 * matches the record's `clientId`, and it carries the admin scope.
 * Returns null otherwise — callers should treat null as "mint a new one".
 */
export async function loadValidBootstrapAdminRecord(
  tokenPath: string,
  verify: BootstrapAdminVerifier,
): Promise<BootstrapAdminRecord | null> {
  const record = await readRecordFile(tokenPath);
  if (!record) {
    return null;
  }

  const payload = await verify(record.token);
  if (!payload) {
    return null;
  }

  if (payload.sub !== record.clientId) {
    return null;
  }

  if (!payload.scopes.includes(BOOTSTRAP_ADMIN_SCOPE)) {
    return null;
  }

  if (isBootstrapAdminRecordExpired(record.expiresAt)) {
    return null;
  }

  return record;
}

/**
 * Atomically persist a record: write to a per-write temp file, chmod
 * it, then rename over the target path. The random suffix (rather than
 * a fixed `${tokenPath}.tmp`) keeps concurrent writers pointed at the
 * same path from racing each other's rename()/chmod().
 */
export async function persistBootstrapAdminRecord(
  tokenPath: string,
  record: BootstrapAdminRecord,
): Promise<void> {
  await mkdir(dirname(tokenPath), { recursive: true });

  const tempPath = `${tokenPath}.${randomUUID()}.tmp`;
  const contents = `${JSON.stringify(record, null, 2)}\n`;

  await writeFile(tempPath, contents, { encoding: 'utf-8', mode: 0o600 });
  await chmod(tempPath, 0o600);
  await rename(tempPath, tokenPath);
  await chmod(tokenPath, 0o600);
}

// ============================================================================
// Inspection (read-only status determination)
// ============================================================================

export type BootstrapAdminInspectStatus =
  | 'disabled'
  | 'missing'
  | 'malformed'
  | 'invalid'
  | 'expired'
  | 'valid';

export type BootstrapAdminInspectOutcome = {
  status: BootstrapAdminInspectStatus;
  tokenPath: string;
  enabled: boolean;
  record?: BootstrapAdminRecord;
};

/**
 * Determine the bootstrap-admin token's status without any side
 * effects. Deliberately uses `decode` (no signature check) rather than
 * `verify` — this mirrors long-standing behavior (see
 * `workflows/bootstrap-admin.test.ts`) so status reporting works even
 * when the caller doesn't have the signing secret on hand.
 */
export async function inspectBootstrapAdminRecord(options: {
  enabled: boolean;
  tokenPath: string;
  decode: BootstrapAdminDecoder;
}): Promise<BootstrapAdminInspectOutcome> {
  const { enabled, tokenPath, decode } = options;

  if (!enabled) {
    return { status: 'disabled', tokenPath, enabled: false };
  }

  let raw: string;
  try {
    raw = await readFile(tokenPath, 'utf-8');
  } catch {
    return { status: 'missing', tokenPath, enabled: true };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: 'malformed', tokenPath, enabled: true };
  }

  if (!hasBootstrapAdminRecordShape(parsed)) {
    return { status: 'malformed', tokenPath, enabled: true };
  }

  const record: BootstrapAdminRecord = {
    clientId: parsed.clientId,
    token: parsed.token,
    scopes: [...parsed.scopes],
    createdAt: parsed.createdAt,
    expiresAt: parsed.expiresAt,
  };

  const payload = await decode(record.token);
  if (!payload || typeof payload.sub !== 'string') {
    return { status: 'invalid', tokenPath, enabled: true };
  }

  if (payload.sub !== record.clientId) {
    return { status: 'invalid', tokenPath, enabled: true };
  }

  if (isBootstrapAdminRecordExpired(record.expiresAt)) {
    return { status: 'expired', tokenPath, enabled: true, record };
  }

  return { status: 'valid', tokenPath, enabled: true, record };
}
