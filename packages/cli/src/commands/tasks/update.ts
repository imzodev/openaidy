/**
 * Tasks Update Command Handler
 *
 * Implements `openaidy tasks update <id>` command.
 */

import * as p from '@clack/prompts';
import { resolveCLIConfig } from '../../lib/config.js';
import { readAdminToken } from '../../lib/admin-token.js';
import type { CommandResult } from '../../types.js';

const VALID_PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const VALID_STATUSES   = ['backlog', 'todo', 'in_progress', 'review', 'done', 'cancelled'];

export async function tasksUpdateHandler(
  args: string[],
): Promise<CommandResult> {
  if (args.includes('-h') || args.includes('--help')) {
    p.note(
      `Usage: openaidy tasks update <id> [options]

Update a task's title, description, priority, or status.

Arguments:
  <id>                   Task ID (required)

Options:
  --title <title>        New task title
  --description <desc>   New task description
  --priority <p>         Priority: low, medium, high, urgent
  --status <s>           Status: backlog, todo, in_progress, review, done, cancelled

Examples:
  pnpm openaidy tasks update abc123 --priority high
  pnpm openaidy tasks update abc123 --status done
  pnpm openaidy tasks update abc123 --title "New title" --priority urgent

Exit Codes:
  0  Success
  1  Error (server unreachable, not authenticated, task not found)
  2  Invalid arguments`,
      'Help',
    );
    return { exitCode: 0 };
  }

  const config = resolveCLIConfig();
  const tokenResult = await readAdminToken(config.tokenPath);
  if (!tokenResult.ok) {
    const msg = `Bootstrap admin token not found at ${config.tokenPath}.`;
    p.log.error(msg);
    return { exitCode: 1, error: msg };
  }

  // Collect positional args (task ID)
  const positional: string[] = [];
  const updates: Record<string, unknown> = {};

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === '--title' && i + 1 < args.length) {
      updates.title = args[++i];
    } else if (arg === '--description' && i + 1 < args.length) {
      updates.description = args[++i];
    } else if (arg === '--priority' && i + 1 < args.length) {
      const val = args[++i];
      if (!VALID_PRIORITIES.includes(val)) {
        const msg = `--priority must be one of: ${VALID_PRIORITIES.join(', ')}`;
        p.log.error(msg);
        return { exitCode: 2, error: msg };
      }
      updates.priority = val;
    } else if (arg === '--status' && i + 1 < args.length) {
      const val = args[++i];
      if (!VALID_STATUSES.includes(val)) {
        const msg = `--status must be one of: ${VALID_STATUSES.join(', ')}`;
        p.log.error(msg);
        return { exitCode: 2, error: msg };
      }
      // Route to PATCH /tasks/:id for title/desc/priority,
      // and to PATCH /tasks/:id/status for status
    } else if (!arg.startsWith('--')) {
      positional.push(arg);
    }
    i++;
  }

  if (positional.length === 0) {
    const msg = 'Task ID is required.\nUsage: openaidy tasks update <id>';
    p.log.error(msg);
    return { exitCode: 2, error: msg };
  }

  const taskId = positional[0];

  // Separate status update from other updates
  const { status: _status, ...generalUpdates } = updates;
  const hasGeneral  = Object.keys(generalUpdates).length > 0;
  const hasStatus   = 'status' in updates;

  if (!hasGeneral && !hasStatus) {
    const msg = 'No updates provided. Use --title, --description, --priority, or --status.';
    p.log.error(msg);
    return { exitCode: 2, error: msg };
  }

  const headers = {
    Authorization: `Bearer ${tokenResult.token}`,
    'Content-Type': 'application/json',
  };

  try {
    if (hasGeneral) {
      const res = await fetch(`${config.httpUrl}/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(generalUpdates),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: { message?: string } };
        const msg = `Server returned ${res.status}: ${body.error?.message ?? res.statusText}`;
        if (res.status === 404) {
          p.log.error(`Task "${taskId}" not found.`);
          return { exitCode: 1, error: msg };
        }
        p.log.error(msg);
        return { exitCode: 1, error: msg };
      }
    }

    if (hasStatus) {
      const statusUpdate = updates.status as string;
      const res = await fetch(`${config.httpUrl}/api/tasks/${taskId}/status`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ status: statusUpdate }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: { message?: string } };
        const msg = `Server returned ${res.status}: ${body.error?.message ?? res.statusText}`;
        if (res.status === 404) {
          p.log.error(`Task "${taskId}" not found.`);
          return { exitCode: 1, error: msg };
        }
        p.log.error(msg);
        return { exitCode: 1, error: msg };
      }
    }
  } catch (err) {
    const msg = `Cannot reach server at ${config.httpUrl}.\n${err instanceof Error ? err.message : String(err)}`;
    p.log.error(msg);
    return { exitCode: 1, error: msg };
  }

  p.log.success(`Task "${taskId}" updated.`);
  return { exitCode: 0 };
}