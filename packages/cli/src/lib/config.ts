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
 * Resolution order for each value:
 * 1. Explicit env var override (e.g., OPENAIDY_WS_URL, OPENAIDY_HOME)
 * 2. Server-compatible env var (e.g., WS_PORT + WS_PATH)
 * 3. Hardcoded default
 */
export function resolveCLIConfig(
  env: NodeJS.ProcessEnv = process.env,
): CLIConfig {
  // WebSocket URL resolution
  const wsUrl =
    env.OPENAIDY_WS_URL ??
    `ws://localhost:${env.WS_PORT ?? '3001'}${env.WS_PATH ?? '/ws'}`;

  // HTTP REST API URL resolution
  const httpUrl =
    env.OPENAIDY_SERVER_URL ?? `http://localhost:${env.PORT ?? '3001'}`;

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
