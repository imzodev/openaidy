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
