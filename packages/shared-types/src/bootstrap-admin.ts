/**
 * Shared Bootstrap Admin Types
 *
 * The bootstrap-admin token record is produced by both the server
 * (`apps/server/src/bootstrap-admin.ts`) and the CLI's
 * `BootstrapAdminWorkflow.ensureToken()` (control-plane). Defining it
 * here keeps the shape authoritative and prevents drift between
 * implementation layers (per AGENTS.md: "NEVER export types from logic
 * files").
 */

/**
 * Bootstrap admin token file shape on disk.
 *
 * `token` is the JWT value the user pastes into the web UI on first login.
 * `clientId` is the JWT `sub` claim and MUST match the token's `sub`.
 * `scopes` mirrors the JWT `scopes` claim; the bootstrap token always
 * contains `*` (admin wildcard).
 * `createdAt` / `expiresAt` are derived from the JWT `iat` / `exp` and
 * persisted so the CLI can decide validity without re-validating the JWT.
 */
export type BootstrapAdminRecord = {
  clientId: string;
  token: string;
  scopes: string[];
  createdAt: string;
  expiresAt: string;
};

/**
 * Decoded bootstrap-admin JWT payload. Produced/consumed by both the
 * server's `AuthMiddleware` and the CLI's raw-secret signing path
 * (`packages/control-plane/src/lib/bootstrap-admin-jwt.ts`) — the two
 * are byte-for-byte compatible, so this shape is shared rather than
 * declared independently in either logic file.
 */
export type BootstrapAdminJwtPayload = {
  sub: string;
  type: 'access' | 'refresh' | 'pairing';
  scopes: string[];
  iat: number;
  exp: number;
  jti: string;
  clientType?: string;
  clientVersion?: string;
};

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
