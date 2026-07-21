/**
 * Tasks List Command Handler
 *
 * Implements `openaidy tasks list` command.
 */

import * as p from '@clack/prompts';
import { resolveCLIConfig } from '../../lib/config.js';
import { readAdminToken } from '../../lib/admin-token.js';
import { formatTaskList } from '../../formatters/tasks.js';
import type { CommandResult } from '../../types.js';
import type { TaskStatus, TaskPriority } from '@openaidy/shared-types';

export async function tasksListHandler(args: string[]): Promise<CommandResult> {
  if (args.includes('-h') || args.includes('--help')) {
    p.note(
      `Usage: openaidy tasks list [--status <status>] [--limit <n>]

List all tasks, optionally filtered by status.

Options:
  --status <status>   Filter by status: backlog, todo, in_progress, review, done, cancelled
  --limit <n>         Limit number of results (default: 50)

Examples:
  pnpm openaidy tasks list
  pnpm openaidy tasks list --status in_progress
  pnpm openaidy tasks list --limit 10

Exit Codes:
  0  Success
  1  Error (server unreachable, not authenticated)
  2  Invalid arguments`,
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

  // Parse --status and --limit
  let statusFilter: TaskStatus | undefined;
  let limit = 50;
  const remaining: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--status' && i + 1 < args.length) {
      statusFilter = args[++i] as TaskStatus;
    } else if (args[i] === '--limit' && i + 1 < args.length) {
      limit = parseInt(args[++i], 10);
      if (isNaN(limit) || limit < 1) {
        const msg = '--limit must be a positive integer';
        p.log.error(msg);
        return { exitCode: 2, error: msg };
      }
    } else {
      remaining.push(args[i]);
    }
  }

  if (remaining.length > 0) {
    const msg = `Unknown argument(s): ${remaining.join(', ')}`;
    p.log.error(msg);
    return { exitCode: 2, error: msg };
  }

  const url = new URL(`${config.httpUrl}/tasks`);
  if (statusFilter) url.searchParams.set('status', statusFilter);

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${tokenResult.token}` },
    });
  } catch (err) {
    const msg = `Cannot reach server at ${config.httpUrl}.\n${err instanceof Error ? err.message : String(err)}`;
    p.log.error(msg);
    return { exitCode: 1, error: msg };
  }

  if (!res.ok) {
    const body = (await res
      .json()
      .catch(() => ({ error: res.statusText }))) as { error?: string };
    const msg = `Server returned ${res.status}: ${body.error ?? res.statusText}`;
    p.log.error(msg);
    return { exitCode: 1, error: msg };
  }

  const { items } = (await res.json()) as {
    items: Array<{
      id: string;
      title: string;
      status: TaskStatus;
      priority: TaskPriority;
      createdAt: string;
    }>;
  };
  const slice = items.slice(0, limit);
  p.note(formatTaskList(slice), 'Tasks');
  return { exitCode: 0 };
}
