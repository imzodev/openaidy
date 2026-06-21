/**
 * Server Connection Helper
 *
 * Provides a shared utility for CLI commands that need to communicate
 * with the OpenAidy server via WebSocket. Handles token reading,
 * connection setup, and graceful error handling.
 */

import { WebSocketClient } from '@openaidy/sdk';
import { readFile } from 'node:fs/promises';
import type { BootstrapAdminRecord } from '@openaidy/shared-types';
import { readAdminToken } from './admin-token.js';
import { resolveCLIConfig, type CLIConfig } from './config.js';

/**
 * Successful connection result
 */
export type ConnectedServerClient = {
  ok: true;
  client: WebSocketClient;
  token: string;
  config: CLIConfig;
};

/**
 * Failed connection result
 */
export type FailedServerClient = {
  ok: false;
  error: string;
  exitCode: number;
};

/**
 * Result of attempting to connect to the server
 */
export type ServerClientResult = ConnectedServerClient | FailedServerClient;

/**
 * Connect to the OpenAidy WebSocket server using the bootstrap-admin token.
 *
 * This helper:
 * 1. Resolves CLI config (WS URL, token path, etc.)
 * 2. Reads the bootstrap-admin token from disk
 * 3. Creates and connects a WebSocketClient
 * 4. Returns the connected client for command use
 *
 * @param overrides - Optional config overrides (useful for testing)
 * @returns The connected client, or an error description
 */
export async function connectToServer(
  overrides?: Partial<CLIConfig>,
): Promise<ServerClientResult> {
  const config = { ...resolveCLIConfig(), ...overrides };

  // Read admin token using shared helper
  const tokenResult = await readAdminToken(config.tokenPath);
  if (!tokenResult.ok) {
    return {
      ok: false,
      error: tokenResult.error,
      exitCode: 1,
    };
  }

  const { token } = tokenResult;

  // Create WebSocket client
  const client = new WebSocketClient({
    url: config.wsUrl,
    token,
  });

  // Attempt connection
  try {
    await client.connect();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    return {
      ok: false,
      error: `Cannot connect to server at ${config.wsUrl}.\n${message}\n\nMake sure the server is running: pnpm --filter @openaidy/server dev`,
      exitCode: 1,
    };
  }

  return { ok: true, client, token, config };
}
