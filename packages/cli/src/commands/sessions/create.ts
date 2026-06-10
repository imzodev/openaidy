/**
 * Sessions Create Command Handler
 *
 * Implements `openaidy sessions create <title>` command.
 * Calls POST /sessions via the HTTP REST API.
 */

import * as p from '@clack/prompts';
import { readAdminToken } from '../../lib/admin-token.js';
import { resolveCLIConfig } from '../../lib/config.js';
import type { CommandResult } from '../../types.js';

export async function sessionsCreateHandler(
  args: string[],
): Promise<CommandResult> {
  if (args.includes('-h') || args.includes('--help')) {
    p.note(
      `Usage: openaidy sessions create [title]

Create a new session.

Arguments:
  title    Session title (default: "New Session")

Examples:
  pnpm openaidy sessions create
  pnpm openaidy sessions create "My Chat"

Exit Codes:
  0  Success (session created)
  1  Server unreachable, not authenticated, or validation error`,
      'sessions create',
    );
    return { exitCode: 0 };
  }

  const title = args[0] ?? 'New Session';

  const config = resolveCLIConfig();
  const token = await readAdminToken(config.tokenPath);
  if (!token.ok) {
    p.log.error(token.error);
    return { exitCode: 1, error: token.error };
  }

  const s = p.spinner();
  s.start('Creating session…');

  let res: Response;
  try {
    res = await fetch(`${config.httpUrl}/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token.token}`,
      },
      body: JSON.stringify({ title }),
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

  const session = (await res.json()) as { id: string; title: string };
  p.log.success(`Session created: "${session.title}" (${session.id})`);
  return { exitCode: 0 };
}
