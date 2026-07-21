/**
 * Shared helpers for resolving the JWT signing secret across the CLI and
 * the server. The install script persists the secret to
 * `$OPENAIDY_HOME/state/install.json` so manual restarts (without the
 * install script's env) still produce the same JWT signature — otherwise
 * `BootstrapAdminManager.ensureToken()` would silently regenerate the
 * admin JWT on every restart because signature validation would fail
 * against the env-default unsafe secret, and the user would lose access
 * to the UI.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The unsafe default JWT secret that signals "WS_TOKEN_SECRET was not
 * configured". Both the CLI's `init` command and the server refuse to
 * mint or verify tokens signed with this secret — see
 * `packages/control-plane/src/workflows/bootstrap-admin.ts:380-384` and
 * `apps/server/src/websocket/middleware/auth.ts`.
 */
export const UNSAFE_DEFAULT_JWT_SECRET = 'change-me-in-production';

/**
 * Read the persisted JWT signing secret from
 * `$OPENAIDY_HOME/state/install.json`. Returns undefined when the file is
 * missing, unreadable, or malformed — callers fall back to the env var
 * or the unsafe default in that case.
 *
 * Synchronous because the only callers (env schema resolution at server
 * startup, CLI init) read this once before any I/O concurrency matters.
 */
export function readJwtSecretFromState(
  openAidyHome: string,
): string | undefined {
  try {
    const raw = readFileSync(
      resolve(openAidyHome, 'state', 'install.json'),
      'utf-8',
    );
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (
      typeof parsed.wsTokenSecret === 'string' &&
      parsed.wsTokenSecret.length > 0 &&
      parsed.wsTokenSecret !== UNSAFE_DEFAULT_JWT_SECRET
    ) {
      return parsed.wsTokenSecret;
    }
  } catch {
    // File missing or unreadable — not an error, just fall through.
  }
  return undefined;
}

/**
 * Resolve the JWT signing secret with a stable precedence:
 *   1. Explicit non-empty env var (anything other than the unsafe default)
 *   2. `$OPENAIDY_HOME/state/install.json` (set by the install script),
 *      checked in the order `openAidyHomes` lists them so callers can
 *      cover both an explicit `OPENAIDY_HOME` and a default location.
 *   3. The unsafe default sentinel (callers are expected to refuse to
 *      mint or verify with this value)
 *
 * Treating an empty `WS_TOKEN_SECRET` env var as "not set" prevents a
 * common foot-gun where exporting `WS_TOKEN_SECRET=` would otherwise
 * beat the manifest fallback and leave the server using the unsafe
 * default on restart.
 */
export function resolveJwtSecret(
  envValue: string | undefined,
  openAidyHomes: string | string[],
): string {
  if (
    typeof envValue === 'string' &&
    envValue.length > 0 &&
    envValue !== UNSAFE_DEFAULT_JWT_SECRET
  ) {
    return envValue;
  }
  const homes = Array.isArray(openAidyHomes) ? openAidyHomes : [openAidyHomes];
  for (const home of homes) {
    const fromState = readJwtSecretFromState(home);
    if (fromState) return fromState;
  }
  return UNSAFE_DEFAULT_JWT_SECRET;
}
