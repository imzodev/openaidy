/**
 * CLI Configuration
 *
 * Resolves CLI-related settings from environment variables with sensible defaults.
 * These mirror the server's env vars so the CLI and server can share the same
 * .env file during development.
 */

import { resolve } from 'node:path';
import { DEFAULT_SERVER_PORT } from '@openaidy/config';

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
    `ws://localhost:${env.WS_PORT ?? String(DEFAULT_SERVER_PORT)}${env.WS_PATH ?? '/ws'}`;

  // HTTP REST API URL resolution
  const httpUrl =
    env.OPENAIDY_SERVER_URL ??
    `http://localhost:${env.PORT ?? String(DEFAULT_SERVER_PORT)}`;

  // Token path resolution
  const tokenPath =
    env.BOOTSTRAP_ADMIN_TOKEN_PATH ??
    resolve('.openaidy/credentials/bootstrap-admin.json');

  // JWT secret (must match server)
  const jwtSecret = env.WS_TOKEN_SECRET ?? 'change-me-in-production';

  // Bootstrap admin enabled
  const bootstrapAdminEnabled = env.BOOTSTRAP_ADMIN_ENABLED !== 'false';

  return { wsUrl, httpUrl, tokenPath, jwtSecret, bootstrapAdminEnabled };
}
