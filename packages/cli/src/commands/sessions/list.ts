/**
 * Sessions List Command Handler
 *
 * Implements `openaidy sessions list` command.
 * Calls GET /sessions via the HTTP REST API.
 */

import * as p from '@clack/prompts';
import { readAdminToken } from '../../lib/admin-token.js';
import { resolveCLIConfig } from '../../lib/config.js';
import {
  formatSessionList,
  formatEmptyState,
} from '../../formatters/sessions.js';
import type { CommandResult } from '../../types.js';

export async function sessionsListHandler(
  args: string[],
): Promise<CommandResult> {
  if (args.includes('-h') || args.includes('--help')) {
    p.note(
      `Usage: openaidy sessions list [options]

List all sessions.

Options:
  --limit <n>    Maximum number of sessions to show (default: 50)

Examples:
  pnpm openaidy sessions list
  pnpm openaidy sessions list --limit 20

Exit Codes:
  0  Success
  1  Server unreachable or not authenticated`,
      'sessions list',
    );
    return { exitCode: 0 };
  }

  const config = resolveCLIConfig();
  const token = await readAdminToken(config.tokenPath);
  if (!token.ok) {
    p.log.error(token.error);
    return { exitCode: 1, error: token.error };
  }

  const limit = extractLimit(args);

  const s = p.spinner();
  s.start('Fetching sessions…');

  let res: Response;
  try {
    res = await fetch(`${config.httpUrl}/sessions`, {
      headers: { Authorization: `Bearer ${token.token}` },
    });
  } catch (err) {
    s.stop('Failed.');
    const msg = `Cannot reach server at ${config.httpUrl}.\n${err instanceof Error ? err.message : String(err)}`;
    p.log.error(msg);
    return { exitCode: 1, error: msg };
  }

  if (!res.ok) {
    s.stop('Failed.');
    const body = (await res
      .json()
      .catch(() => ({ error: res.statusText }))) as { error?: string };
    const msg = `Server returned ${res.status}: ${body.error ?? res.statusText}`;
    p.log.error(msg);
    return { exitCode: 1, error: msg };
  }

  s.stop('Done.');

  const { items } = (await res.json()) as {
    items: Array<{ id: string; title: string; createdAt: string }>;
  };
  const sessions = items.slice(0, limit);

  p.note(
    sessions.length > 0 ? formatSessionList(sessions) : formatEmptyState(),
    sessions.length > 0 ? `Sessions (${items.length})` : 'Sessions',
  );

  return { exitCode: 0 };
}

function extractLimit(args: string[]): number {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) {
      const n = parseInt(args[i + 1], 10);
      return isNaN(n) || n < 1 ? 50 : n;
    }
  }
  return 50;
}
