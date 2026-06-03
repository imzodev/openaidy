/**
 * Bootstrap Admin Token Helper
 *
 * Shared utility for reading and validating the bootstrap-admin token file.
 * Used by commands that call the HTTP REST API.
 */

import { readFile } from 'node:fs/promises';

type BootstrapAdminRecord = {
  clientId: string;
  token: string;
  scopes: string[];
  createdAt: string;
  expiresAt: string;
};

/**
 * Result of reading the admin token
 */
export type ReadAdminTokenResult =
  | { ok: true; token: string }
  | { ok: false; error: string };

/**
 * Read and validate the bootstrap-admin token file.
 */
export async function readAdminToken(
  tokenPath: string,
): Promise<ReadAdminTokenResult> {
  let raw: string;
  try {
    raw = await readFile(tokenPath, 'utf-8');
  } catch {
    return {
      ok: false,
      error: `Bootstrap admin token not found at ${tokenPath}.\nMake sure the server has been started at least once.`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: `Token file at ${tokenPath} contains invalid JSON.` };
  }

  const record = parsed as Partial<BootstrapAdminRecord>;
  if (typeof record.token !== 'string') {
    return { ok: false, error: `Token file at ${tokenPath} has invalid structure.` };
  }

  return { ok: true, token: record.token };
}