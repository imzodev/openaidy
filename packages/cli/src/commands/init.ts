/**
 * openaidy init - Generate or refresh the bootstrap-admin token.
 *
 * PR1 (installation-onboarding). This handler replaces the legacy
 * `initAddon` / `updateConfig` exports that were never wired into the
 * command registry and had no real importers (see T1.7 verification:
 * `rg 'initAddon|updateConfig' packages/` returns zero real hits).
 *
 * Behavior (per PR1 spec R-1, R-2, R-3, R-6):
 *  - First run: mints a JWT via {@link BootstrapAdminWorkflow.ensureToken}
 *    and persists to `resolveCLIConfig().tokenPath` (mode 0o600 on POSIX).
 *  - Valid existing token: reuses without rewriting the file.
 *  - Expired / corrupt / missing-field record: regenerates.
 *  - JWT secret is the unsafe default `'change-me-in-production'`:
 *    exits 1 with remediation message (R-2 / CC-3).
 *  - `BOOTSTRAP_ADMIN_ENABLED=false`: exits 1.
 *  - Prints exactly one parseable line `Bootstrap admin token: <jwt>`
 *    on success so the install scripts can grep it.
 */

import { resolve } from 'node:path';
import {
  createBootstrapAdminWorkflow,
  type BootstrapAdminContext,
} from '@openaidy/control-plane';
import type { CommandResult } from '../types.js';
import { createCLIError, formatCLIError } from '../errors.js';

/**
 * Default JWT secret that {@link resolveCLIConfig} falls back to when
 * WS_TOKEN_SECRET is unset. Kept in sync with
 * `packages/cli/src/lib/config.ts:53` and
 * `apps/server/src/websocket/types.ts:21`.
 */
const UNSAFE_DEFAULT_SECRET = 'change-me-in-production';

/**
 * Default bootstrap-admin client ID — must match the server's
 * `BootstrapAdminManager` default at `apps/server/src/bootstrap-admin.ts`.
 */
const DEFAULT_BOOTSTRAP_CLIENT_ID = 'bootstrap-admin';

/**
 * Default token expiry: 30 days in milliseconds (matches server default).
 */
const DEFAULT_TOKEN_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Help text for `openaidy init --help`.
 */
const HELP_TEXT = `
Usage: openaidy init [options]

Generate or refresh the bootstrap-admin token.

This command:
  - Mints a fresh admin JWT if no token file exists (or the existing
    one is expired, corrupt, or missing required fields).
  - Reuses an existing valid token without rewriting the file.
  - Persists the token to $OPENAIDY_HOME/credentials/bootstrap-admin.json
    (POSIX mode 0o600).
  - Prints the token value to stdout on success.

The token is required on first browser login. Open the URL printed by
the installer and paste the token into the login screen.

Options:
  -h, --help          Show this help message

Environment:
  WS_TOKEN_SECRET       JWT signing secret (required; not the default)
  OPENAIDY_HOME         Install root (default: ~/.openaidy)
  BOOTSTRAP_ADMIN_ENABLED   Set to 'false' to disable (default: true)

Exit Codes:
  0  Token generated or reused successfully
  1  JWT secret is the unsafe default / bootstrap admin disabled /
     persistence failure

Examples:
  openaidy init
  WS_TOKEN_SECRET=$(openssl rand -hex 32) openaidy init
`;

/**
 * Build the {@link BootstrapAdminContext} from env vars, applying the
 * same resolution rules as `resolveCLIConfig()` but reading from the
 * passed-in env so tests can isolate state.
 */
function buildContext(env: NodeJS.ProcessEnv): BootstrapAdminContext {
  const jwtSecret = env.WS_TOKEN_SECRET ?? UNSAFE_DEFAULT_SECRET;
  const enabled = env.BOOTSTRAP_ADMIN_ENABLED !== 'false';

  // Honor OPENAIDY_HOME per PR1 NDQ-5; otherwise mirror the server default
  // by passing an explicit tokenPath. The CLI's config.ts will fall back
  // to the repo-local default when neither is set; here we surface the
  // env override first.
  const tokenPath =
    env.BOOTSTRAP_ADMIN_TOKEN_PATH ??
    (env.OPENAIDY_HOME
      ? resolve(env.OPENAIDY_HOME, 'credentials', 'bootstrap-admin.json')
      : resolve('.openaidy', 'credentials', 'bootstrap-admin.json'));

  return {
    enabled,
    tokenPath,
    jwtSecret,
    clientId: DEFAULT_BOOTSTRAP_CLIENT_ID,
    tokenExpiryMs: DEFAULT_TOKEN_EXPIRY_MS,
  };
}

/**
 * The `openaidy init` command handler.
 *
 * Accepts the test-only `envOverride` parameter so unit tests can
 * drive env resolution without mutating real `process.env`. The runtime
 * call from `commands/index.ts` passes no second arg, so the default
 * `process.env` is used.
 */
export async function initHandler(
  args: string[],
  envOverride?: NodeJS.ProcessEnv,
): Promise<CommandResult> {
  if (args.includes('-h') || args.includes('--help')) {
    process.stdout.write(HELP_TEXT);
    return { exitCode: 0 };
  }

  const env = envOverride ?? process.env;
  const ctx = buildContext(env);

  if (!ctx.enabled) {
    const err = createCLIError(
      'BOOTSTRAP_DISABLED',
      'Bootstrap admin is disabled. Set BOOTSTRAP_ADMIN_ENABLED=true and re-run.',
    );
    return { exitCode: err.exitCode, error: formatCLIError(err) };
  }

  if (ctx.jwtSecret === UNSAFE_DEFAULT_SECRET) {
    const err = createCLIError(
      'INTERNAL_ERROR',
      'Refusing to generate token with default JWT secret. Set WS_TOKEN_SECRET in your environment.',
    );
    return { exitCode: err.exitCode, error: formatCLIError(err) };
  }

  let result;
  try {
    const wf = createBootstrapAdminWorkflow(ctx);
    result = await wf.ensureToken();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Map known unsafe-default error from the workflow to the CLI's
    // own pre-check so the user gets the prescribed remediation hint.
    if (message.includes('default JWT secret')) {
      const e = createCLIError(
        'INTERNAL_ERROR',
        'Refusing to generate token with default JWT secret. Set WS_TOKEN_SECRET in your environment.',
      );
      return { exitCode: e.exitCode, error: formatCLIError(e) };
    }
    const cliErr = createCLIError(
      'PERSISTENCE_FAILURE',
      `Failed to ensure bootstrap admin token: ${message}`,
    );
    return { exitCode: cliErr.exitCode, error: formatCLIError(cliErr) };
  }

  if (!result) {
    const err = createCLIError(
      'BOOTSTRAP_DISABLED',
      'Bootstrap admin is disabled.',
    );
    return { exitCode: err.exitCode, error: formatCLIError(err) };
  }

  process.stdout.write(`Bootstrap admin token: ${result.record.token}\n`);
  return { exitCode: 0 };
}

// Re-export for the registry and any future programmatic consumers.
export default initHandler;
