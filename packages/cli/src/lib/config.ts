/**
 * CLI Configuration
 *
 * Resolves CLI-related settings from environment variables with sensible defaults.
 * These mirror the server's env vars so the CLI and server can share the same
 * .env file during development.
 *
 * PR1 (installation-onboarding) NDQ-5: when `OPENAIDY_HOME` is set, the
 * bootstrap-admin token path is computed relative to it (mirrors the
 * server's `apps/server/src/lib/env.ts:27` resolution). This lets the
 * installer use a single source of truth for the install root while
 * `pnpm dev` keeps the legacy repo-local default.
 */
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import {
  DEFAULT_SERVER_PORT,
  resolveJwtSecret,
  UNSAFE_DEFAULT_JWT_SECRET,
} from '@openaidy/config';

/**
 * CLI configuration resolved from environment
 */
export type CLIConfig = {
  /** WebSocket server URL */
  wsUrl: string;
  /** HTTP REST API base URL */
  httpUrl: string;
  /** Path to the bootstrap-admin token file */
  tokenPath: string;
  /** JWT secret (must match server's WS_TOKEN_SECRET) */
  jwtSecret: string;
  /** Whether bootstrap-admin is enabled */
  bootstrapAdminEnabled: boolean;
};

/**
 * Resolve CLI configuration from environment variables.
 *
 * `OPENAIDY_PORT` and `WS_PATH` are optional with sensible defaults
 * (3001 and /ws, matching the server's defaults), so the CLI works
 * out of the box without env config. Override via env or
 * `OPENAIDY_WS_URL` / `OPENAIDY_SERVER_URL` for non-standard deployments.
 */
export function resolveCLIConfig(
  env: NodeJS.ProcessEnv = process.env,
): CLIConfig {
  const port = env.OPENAIDY_PORT ?? String(DEFAULT_SERVER_PORT);
  const wsPath = env.WS_PATH ?? '/ws';

  const wsUrl = env.OPENAIDY_WS_URL ?? `ws://localhost:${port}${wsPath}`;

  const httpUrl = env.OPENAIDY_SERVER_URL ?? `http://localhost:${port}`;

  // Token path resolution (NDQ-5):
  // 1. Explicit BOOTSTRAP_ADMIN_TOKEN_PATH wins always
  // 2. OPENAIDY_HOME → resolve(OPENAIDY_HOME, 'credentials', 'bootstrap-admin.json')
  // 3. Repo-local default (.openaidy/credentials/bootstrap-admin.json) — preserves
  //    the `pnpm dev` workflow.
  const tokenPath =
    env.BOOTSTRAP_ADMIN_TOKEN_PATH ??
    (env.OPENAIDY_HOME
      ? resolve(env.OPENAIDY_HOME, 'credentials', 'bootstrap-admin.json')
      : resolve('.openaidy/credentials/bootstrap-admin.json'));

  // JWT secret (must match server). Search the install manifest under
  // both candidate homes: the explicit OPENAIDY_HOME (or its dev-mode
  // `.openaidy` default) AND `~/.openaidy` (the install script's default
  // when no env is set). The first hit wins; otherwise the env var (if
  // any) wins; otherwise we fall back to the unsafe default sentinel —
  // the CLI's `init` command refuses to mint with that value.
  const jwtSecret = resolveJwtSecret(env.WS_TOKEN_SECRET, [
    env.OPENAIDY_HOME ?? resolve('.openaidy'),
    resolve(homedir(), '.openaidy'),
  ]);

  // Bootstrap admin enabled
  const bootstrapAdminEnabled = env.BOOTSTRAP_ADMIN_ENABLED !== 'false';

  return { wsUrl, httpUrl, tokenPath, jwtSecret, bootstrapAdminEnabled };
}

export { UNSAFE_DEFAULT_JWT_SECRET };
