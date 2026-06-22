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
 * No hardcoded port/path defaults. `OPENAIDY_PORT` and `WS_PATH` are required;
 * callers that don't need server URLs (e.g. `openaidy init`) should not call
 * this function. The server enforces the same contract in its zod schema.
 */
export function resolveCLIConfig(
  env: NodeJS.ProcessEnv = process.env,
): CLIConfig {
  if (!env.OPENAIDY_PORT) {
    throw new Error(
      'OPENAIDY_PORT is required to construct server URLs. ' +
        'Set it in $OPENAIDY_HOME/.env or as an environment variable.',
    );
  }
  if (!env.WS_PATH) {
    throw new Error(
      'WS_PATH is required to construct the WebSocket URL. ' +
        'Set it in $OPENAIDY_HOME/.env (e.g. WS_PATH=/ws).',
    );
  }

  // WebSocket URL: explicit OPENAIDY_WS_URL wins; otherwise build from
  // OPENAIDY_PORT + WS_PATH. Both required, no fallbacks.
  const wsUrl =
    env.OPENAIDY_WS_URL ?? `ws://localhost:${env.OPENAIDY_PORT}${env.WS_PATH}`;

  // HTTP URL: explicit OPENAIDY_SERVER_URL wins; otherwise build from OPENAIDY_PORT.
  const httpUrl =
    env.OPENAIDY_SERVER_URL ?? `http://localhost:${env.OPENAIDY_PORT}`;

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

  // JWT secret (must match server)
  const jwtSecret = env.WS_TOKEN_SECRET ?? 'change-me-in-production';

  // Bootstrap admin enabled
  const bootstrapAdminEnabled = env.BOOTSTRAP_ADMIN_ENABLED !== 'false';

  return { wsUrl, httpUrl, tokenPath, jwtSecret, bootstrapAdminEnabled };
}
