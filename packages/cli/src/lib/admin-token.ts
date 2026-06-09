/**
 * Bootstrap Admin Token Reader
 *
 * Reads and validates the bootstrap-admin token file so CLI commands
 * can authenticate against the OpenAidy HTTP API.
 *
 * All CLI commands must use this instead of duplicating readAdminToken logic.
 */

import { readFile } from 'node:fs/promises';

export type BootstrapAdminRecord = {
  clientId: string;
  token: string;
  scopes: string[];
  createdAt: string;
  expiresAt: string;
};

/**
 * Result of reading the admin token from disk.
 * Commands must check `.ok` before accessing `.token`.
 */
export type ReadAdminTokenResult =
  | { ok: true; token: string }
  | { ok: false; error: string };

/**
 * Read and validate the bootstrap-admin token file.
 *
 * @param tokenPath - Absolute path to the bootstrap-admin.json file.
 * @returns ok=true with the raw JWT token, or ok=false with an error message.
 */
export async function readAdminToken(
  tokenPath: string,
): Promise<ReadAdminTokenResult> {
  let raw: string;
  try {
    raw = await readFile(tokenPath, 'utf-8');
  } catch {
    return { ok: false, error: `Bootstrap admin token not found at ${tokenPath}.` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: `Token file at ${tokenPath} contains invalid JSON.` };
  }

  const record = parsed as Partial<BootstrapAdminRecord>;
  if (
    typeof record.token !== 'string' ||
    record.token.length === 0
  ) {
    return { ok: false, error: `Token file at ${tokenPath} has invalid structure (missing "token" field).` };
  }

  return { ok: true, token: record.token };
}