/**
 * Tasks Delete Command Handler
 *
 * Implements `openaidy tasks delete <id>` command.
 */

import * as p from '@clack/prompts';
import { resolveCLIConfig } from '../../lib/config.js';
import { readAdminToken } from '../../lib/admin-token.js';
import type { CommandResult } from '../../types.js';

export async function tasksDeleteHandler(
  args: string[],
): Promise<CommandResult> {
  if (args.includes('-h') || args.includes('--help')) {
    p.note(
      `Usage: openaidy tasks delete <id>

Delete a task permanently.

Arguments:
  <id>    Task ID (required)

Examples:
  pnpm openaidy tasks delete abc123

Exit Codes:
  0  Success
  1  Error (server unreachable, not authenticated, task not found)
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
    const msg = 'Task ID is required.\nUsage: openaidy tasks delete <id>';
    p.log.error(msg);
    return { exitCode: 2, error: msg };
  }

  const taskId = positional[0];

  let res: Response;
  try {
    res = await fetch(`${config.httpUrl}/api/tasks/${taskId}`, {
      method: 'DELETE',
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
    const body = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string };
    const msg = `Server returned ${res.status}: ${body.error ?? res.statusText}`;
    p.log.error(msg);
    return { exitCode: 1, error: msg };
  }

  p.log.success(`Task "${taskId}" deleted.`);
  return { exitCode: 0 };
}