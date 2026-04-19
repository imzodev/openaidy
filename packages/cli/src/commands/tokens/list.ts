/**
 * Tokens List Command Handler
 *
 * Implements `openaidy tokens list` command.
 */

import { readFile } from 'node:fs/promises';
import { resolveCLIConfig } from '../../lib/config.js';
import type { CommandResult } from '../../types.js';

type TokenRecord = {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revoked: boolean;
};

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

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatTokenList(tokens: TokenRecord[]): string {
  const active = tokens.filter((t) => !t.revoked);
  const revoked = tokens.filter((t) => t.revoked);

  const lines: string[] = ['Access Tokens', '=============', ''];

  if (active.length === 0 && revoked.length === 0) {
    lines.push('No access tokens found.');
    lines.push('');
    lines.push(
      'Create one with: pnpm openaidy tokens create --name "My Token" --scopes "*"',
    );
    return lines.join('\n');
  }

  if (active.length > 0) {
    lines.push(`Active (${active.length})`);
    lines.push('');
    for (const t of active) {
      lines.push(`  ${t.name}`);
      lines.push(`    ID:       ${t.id}`);
      lines.push(`    Prefix:   ${t.keyPrefix}…`);
      lines.push(`    Scopes:   ${t.scopes.join(', ')}`);
      lines.push(`    Created:  ${formatDate(t.createdAt)}`);
      if (t.lastUsedAt) lines.push(`    Last use: ${formatDate(t.lastUsedAt)}`);
      if (t.expiresAt) lines.push(`    Expires:  ${formatDate(t.expiresAt)}`);
      lines.push('');
    }
  }

  if (revoked.length > 0) {
    lines.push(`Revoked (${revoked.length})`);
    lines.push('');
    for (const t of revoked) {
      lines.push(`  ${t.name} [revoked]`);
      lines.push(`    ID:      ${t.id}`);
      lines.push(`    Prefix:  ${t.keyPrefix}…`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

export async function tokensListHandler(
  args: string[],
): Promise<CommandResult> {
  if (args.includes('-h') || args.includes('--help')) {
    return {
      exitCode: 0,
      output: `
Usage: openaidy tokens list

List all access tokens.

Examples:
  pnpm openaidy tokens list

Exit Codes:
  0  Success
  1  Error (server unreachable, not authenticated)
`,
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
    res = await fetch(`${config.httpUrl}/api/access-tokens`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      exitCode: 1,
      error: `Cannot reach server at ${config.httpUrl}.\n${msg}\n\nMake sure the server is running.`,
    };
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

  const { keys } = (await res.json()) as { keys: TokenRecord[] };
  return { exitCode: 0, output: formatTokenList(keys) };
}
