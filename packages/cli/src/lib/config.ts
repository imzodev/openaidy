/**
 * CLI Configuration
 *
 * Resolves CLI-related settings from environment variables with sensible defaults.
 * These mirror the server's env vars so the CLI and server can share the same
 * .env file during development.
 */

import { resolve } from 'node:path';

/**
 * CLI configuration resolved from environment
 */
export type CLIConfig = {
  /** WebSocket server URL */
  wsUrl: string;
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
 * 1. Explicit env var override (e.g., OPENAIDY_WS_URL)
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

  // Token path resolution
  const tokenPath =
    env.BOOTSTRAP_ADMIN_TOKEN_PATH ??
    resolve('.openaidy/credentials/bootstrap-admin.json');

  // JWT secret (must match server)
  const jwtSecret = env.WS_TOKEN_SECRET ?? 'change-me-in-production';

  // Bootstrap admin enabled
  const bootstrapAdminEnabled = env.BOOTSTRAP_ADMIN_ENABLED !== 'false';

  return { wsUrl, tokenPath, jwtSecret, bootstrapAdminEnabled };
}
