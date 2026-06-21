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
 * Read and validate the bootstrap-admin token file.
 *
 * @returns The parsed token record, or an error result
 */
async function readAdminToken(
  tokenPath: string,
): Promise<{ ok: true; record: BootstrapAdminRecord } | FailedServerClient> {
  let raw: string;
  try {
    raw = await readFile(tokenPath, 'utf-8');
  } catch {
    return {
      ok: false,
      error: `Bootstrap admin token not found at ${tokenPath}.\nMake sure the server has been started at least once to generate the token.`,
      exitCode: 1,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      error: `Token file at ${tokenPath} contains invalid JSON.`,
      exitCode: 1,
    };
  }

  const record = parsed as Partial<BootstrapAdminRecord>;
  if (
    typeof record.clientId !== 'string' ||
    typeof record.token !== 'string' ||
    !Array.isArray(record.scopes) ||
    typeof record.createdAt !== 'string' ||
    typeof record.expiresAt !== 'string'
  ) {
    return {
      ok: false,
      error: `Token file at ${tokenPath} has invalid structure.`,
      exitCode: 1,
    };
  }

  return { ok: true, record: record as BootstrapAdminRecord };
}

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

  // Read admin token
  const tokenResult = await readAdminToken(config.tokenPath);
  if (!tokenResult.ok) {
    return tokenResult;
  }

  const { token } = tokenResult.record;

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
