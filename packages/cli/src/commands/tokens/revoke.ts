/**
 * Tokens Revoke Command Handler
 *
 * Implements `openaidy tokens revoke` command.
 */

import { readFile } from 'node:fs/promises';
import { resolveCLIConfig } from '../../lib/config.js';
import type { CommandResult } from '../../types.js';

type BootstrapAdminRecord = {
  token: string;
};

async function readAdminToken(tokenPath: string): Promise<string | null> {
  try {
    const raw = await readFile(tokenPath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<BootstrapAdminRecord>;
    return typeof parsed.token === 'string' ? parsed.token : null;
  } catch {
    return null;
  }
}

export async function tokensRevokeHandler(
  args: string[],
): Promise<CommandResult> {
  if (args.includes('-h') || args.includes('--help')) {
    return {
      exitCode: 0,
      output: `
Usage: openaidy tokens revoke <id>

Revoke an access token by its ID. This is irreversible.

Arguments:
  <id>   The token ID (from "tokens list")

Examples:
  pnpm openaidy tokens revoke abc123xyz

Exit Codes:
  0  Token revoked
  1  Error (not found, server unreachable)
  2  Missing argument
`,
    };
  }

  const id = args[0];
  if (!id || id.startsWith('--')) {
    return {
      exitCode: 2,
      error: 'Missing argument: <id>\nRun with --help for usage.',
    };
  }

  const config = resolveCLIConfig();
  const token = await readAdminToken(config.tokenPath);

  if (!token) {
    return {
      exitCode: 1,
      error: `Bootstrap admin token not found at ${config.tokenPath}.\nMake sure the server has been started at least once.`,
    };
  }

  let res: Response;
  try {
    res = await fetch(`${config.httpUrl}/api/access-tokens/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      exitCode: 1,
      error: `Cannot reach server at ${config.httpUrl}.\n${msg}\n\nMake sure the server is running.`,
    };
  }

  if (res.status === 404) {
    return { exitCode: 1, error: `Token not found: ${id}` };
  }

  if (!res.ok) {
    const body = (await res
      .json()
      .catch(() => ({ error: res.statusText }))) as { error?: string };
    return {
      exitCode: 1,
      error: `Server returned ${res.status}: ${body.error ?? res.statusText}`,
    };
  }

  const result = (await res.json()) as { key: { name: string; id: string } };
  return {
    exitCode: 0,
    output: `Revoked: ${result.key.name} (${result.key.id})`,
  };
}
