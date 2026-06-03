/**
 * Subtasks List Command Handler
 *
 * Implements `openaidy subtasks list <taskId>` command.
 */

import * as p from '@clack/prompts';
import { resolveCLIConfig } from '../../../lib/config.js';
import { readAdminToken } from '../../../lib/admin-token.js';
import { formatSubtaskList } from '../../../formatters/subtasks.js';
import type { CommandResult } from '../../../types.js';

export async function subtasksListHandler(
  args: string[],
): Promise<CommandResult> {
  if (args.includes('-h') || args.includes('--help')) {
    p.note(
      `Usage: openaidy subtasks list <taskId>

List all subtasks for a specific task.

Arguments:
  <taskId>    Task ID (required)

Examples:
  pnpm openaidy subtasks list abc123

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
    const msg = 'Task ID is required.\nUsage: openaidy subtasks list <taskId>';
    p.log.error(msg);
    return { exitCode: 2, error: msg };
  }

  const taskId = positional[0];

  let res: Response;
  try {
    res = await fetch(`${config.httpUrl}/api/tasks/${taskId}/subtasks`, {
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

  const { items } = (await res.json()) as {
    items: Array<{
      id: string; taskId: string; title: string;
      status: import('@openaidy/shared-types').SubtaskStatus;
      assignedAgentId: string | null; result: string | null;
      retryCount: number; createdAt: string; updatedAt: string;
    }>;
  };
  p.note(formatSubtaskList(items), `Subtasks for ${taskId}`);
  return { exitCode: 0 };
}