/**
 * Sessions Messages Command Handler
 *
 * Implements `openaidy sessions messages <sessionId>` command.
 * Calls GET /sessions/:sessionId/messages via the HTTP REST API.
 */

import * as p from '@clack/prompts';
import { readAdminToken } from '../../lib/admin-token.js';
import { resolveCLIConfig } from '../../lib/config.js';
import { formatMessageList } from '../../formatters/sessions.js';
import type { CommandResult } from '../../types.js';

export async function sessionsMessagesHandler(
  args: string[],
): Promise<CommandResult> {
  if (args.includes('-h') || args.includes('--help')) {
    p.note(
      `Usage: openaidy sessions messages <sessionId>

List all messages in a session.

Examples:
  pnpm openaidy sessions messages sess_abc123

Exit Codes:
  0  Success
  1  Server unreachable, not authenticated, or session not found`,
      'sessions messages',
    );
    return { exitCode: 0 };
  }

  const sessionId = args[0];
  if (!sessionId) {
    p.log.error('Session ID is required.\n\nUsage: openaidy sessions messages <sessionId>');
    return { exitCode: 2, error: 'Missing session ID' };
  }

  const config = resolveCLIConfig();
  const token = await readAdminToken(config.tokenPath);
  if (!token.ok) {
    p.log.error(token.error);
    return { exitCode: 1, error: token.error };
  }

  const s = p.spinner();
  s.start('Fetching messages…');

  let res: Response;
  try {
    res = await fetch(`${config.httpUrl}/api/sessions/${sessionId}/messages`, {
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
    const body = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string };
    const msg = `Server returned ${res.status}: ${body.error ?? res.statusText}`;
    p.log.error(msg);
    return { exitCode: 1, error: msg };
  }

  s.stop('Done.');

  const { items } = (await res.json()) as {
    items: Array<{
      id: string;
      role: 'user' | 'assistant' | 'system';
      content: string;
      createdAt: string;
      agentId?: string;
      providerId?: string;
      modelId?: string;
    }>;
  };

  p.note(
    formatMessageList(items, sessionId),
    `Messages (${items.length})`,
  );
  return { exitCode: 0 };
}