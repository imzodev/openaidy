/**
 * Sessions Get Command Handler
 *
 * Implements `openaidy sessions get <sessionId>` command.
 * Calls GET /sessions/:sessionId via the HTTP REST API.
 */

import * as p from '@clack/prompts';
import { readAdminToken } from '../../lib/admin-token.js';
import { resolveCLIConfig } from '../../lib/config.js';
import { formatSessionDetail } from '../../formatters/sessions.js';
import type { CommandResult } from '../../types.js';

export async function sessionsGetHandler(
  args: string[],
): Promise<CommandResult> {
  if (args.includes('-h') || args.includes('--help')) {
    p.note(
      `Usage: openaidy sessions get <sessionId>

Get details of a specific session.

Examples:
  pnpm openaidy sessions get sess_abc123

Exit Codes:
  0  Success
  1  Server unreachable, not authenticated, or session not found`,
      'sessions get',
    );
    return { exitCode: 0 };
  }

  const sessionId = args[0];
  if (!sessionId) {
    p.log.error(
      'Session ID is required.\n\nUsage: openaidy sessions get <sessionId>',
    );
    return { exitCode: 2, error: 'Missing session ID' };
  }

  const config = resolveCLIConfig();
  const token = await readAdminToken(config.tokenPath);
  if (!token.ok) {
    p.log.error(token.error);
    return { exitCode: 1, error: token.error };
  }

  const s = p.spinner();
  s.start('Fetching session…');

  let res: Response;
  try {
    res = await fetch(`${config.httpUrl}/sessions/${sessionId}`, {
      headers: { Authorization: `Bearer ${token.token}` },
    });
  } catch (err) {
    s.stop('Failed.');
    const msg = `Cannot reach server at ${config.httpUrl}.\n${err instanceof Error ? err.message : String(err)}`;
    p.log.error(msg);
    return { exitCode: 1, error: msg };
  }

  if (res.status === 404) {
    s.stop('Not found.');
    p.log.error(`Session not found: ${sessionId}`);
    return { exitCode: 1, error: `Session not found: ${sessionId}` };
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

  const session = (await res.json()) as {
    id: string;
    title: string;
    createdAt: string;
    updatedAt?: string;
  };

  p.note(formatSessionDetail(session), session.title);
  return { exitCode: 0 };
}
