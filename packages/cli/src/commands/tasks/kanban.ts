/**
 * Tasks Kanban Command Handler
 *
 * Implements `openaidy tasks kanban` command.
 */

import * as p from '@clack/prompts';
import { resolveCLIConfig } from '../../lib/config.js';
import { readAdminToken } from '../../lib/admin-token.js';
import { formatKanbanBoard } from '../../formatters/tasks.js';
import type { CommandResult } from '../../types.js';
import type { TaskStatus, TaskPriority } from '@openaidy/shared-types';

export async function tasksKanbanHandler(
  args: string[],
): Promise<CommandResult> {
  if (args.includes('-h') || args.includes('--help')) {
    p.note(
      `Usage: openaidy tasks kanban

Display all tasks grouped by status in Kanban board layout.

Examples:
  pnpm openaidy tasks kanban

Exit Codes:
  0  Success
  1  Error (server unreachable, not authenticated)`,
      'Help',
    );
    return { exitCode: 0 };
  }

  const config = resolveCLIConfig();
  const tokenResult = await readAdminToken(config.tokenPath);
  if (!tokenResult.ok) {
    p.log.error(tokenResult.error);
    return { exitCode: 1, error: tokenResult.error };
  }

  let res: Response;
  try {
    res = await fetch(`${config.httpUrl}/api/tasks/kanban`, {
      headers: { Authorization: `Bearer ${tokenResult.token}` },
    });
  } catch (err) {
    const msg = `Cannot reach server at ${config.httpUrl}.\n${err instanceof Error ? err.message : String(err)}`;
    p.log.error(msg);
    return { exitCode: 1, error: msg };
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string };
    const msg = `Server returned ${res.status}: ${body.error ?? res.statusText}`;
    p.log.error(msg);
    return { exitCode: 1, error: msg };
  }

  const board = (await res.json()) as Record<
    TaskStatus,
    Array<{ id: string; title: string; priority: TaskPriority }>
  >;
  p.note(formatKanbanBoard(board), 'Kanban Board');
  return { exitCode: 0 };
}