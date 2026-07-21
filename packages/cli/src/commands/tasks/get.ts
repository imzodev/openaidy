/**
 * Tasks Get Command Handler
 *
 * Implements `openaidy tasks get <id>` command.
 */

import * as p from '@clack/prompts';
import { resolveCLIConfig } from '../../lib/config.js';
import { readAdminToken } from '../../lib/admin-token.js';
import { formatTaskDetail } from '../../formatters/tasks.js';
import type { CommandResult } from '../../types.js';
import type { TaskWithDetails } from '@openaidy/shared-types';

export async function tasksGetHandler(args: string[]): Promise<CommandResult> {
  if (args.includes('-h') || args.includes('--help')) {
    p.note(
      `Usage: openaidy tasks get <id>

Get full details for a specific task.

Arguments:
  <id>    Task ID (required)

Examples:
  pnpm openaidy tasks get abc123

Exit Codes:
  0  Success
  1  Error (server unreachable, not authenticated)
  2  Missing task ID`,
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

  const positional: string[] = [];
  for (const arg of args) {
    if (arg.startsWith('--')) break;
    positional.push(arg);
  }

  if (positional.length === 0) {
    const msg = 'Task ID is required.\nUsage: openaidy tasks get <id>';
    p.log.error(msg);
    return { exitCode: 2, error: msg };
  }

  const taskId = positional[0];

  let res: Response;
  try {
    res = await fetch(`${config.httpUrl}/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${tokenResult.token}` },
    });
  } catch (err) {
    const msg = `Cannot reach server at ${config.httpUrl}.\n${err instanceof Error ? err.message : String(err)}`;
    p.log.error(msg);
    return { exitCode: 1, error: msg };
  }

  if (!res.ok) {
    if (res.status === 404) {
      const msg = `Task "${taskId}" not found.`;
      p.log.error(msg);
      return { exitCode: 1, error: msg };
    }
    const body = (await res
      .json()
      .catch(() => ({ error: res.statusText }))) as { error?: string };
    const msg = `Server returned ${res.status}: ${body.error ?? res.statusText}`;
    p.log.error(msg);
    return { exitCode: 1, error: msg };
  }

  const { data } = (await res.json()) as { data: TaskWithDetails };
  p.note(formatTaskDetail(data), `Task: ${data.title}`);
  return { exitCode: 0 };
}
