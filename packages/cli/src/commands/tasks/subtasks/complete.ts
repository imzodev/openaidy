/**
 * Subtasks Complete Command Handler
 *
 * Implements `openaidy subtasks complete <subtaskId>` command.
 */

import * as p from '@clack/prompts';
import { resolveCLIConfig } from '../../../lib/config.js';
import { readAdminToken } from '../../../lib/admin-token.js';
import type { CommandResult } from '../../../types.js';

export async function subtasksCompleteHandler(
  args: string[],
): Promise<CommandResult> {
  if (args.includes('-h') || args.includes('--help')) {
    p.note(
      `Usage: openaidy subtasks complete <subtaskId> [--result <result>]

Mark a subtask as completed.

Arguments:
  <subtaskId>    Subtask ID (required)

Options:
  --result <r>   Completion result / summary (optional)

Examples:
  pnpm openaidy subtasks complete abc123
  pnpm openaidy subtasks complete abc123 --result "API endpoint implemented and tested"

Exit Codes:
  0  Success
  1  Error (server unreachable, not authenticated, subtask not found)
  2  Missing subtask ID`,
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
  let result: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--result' && i + 1 < args.length) {
      result = args[++i];
    } else if (!args[i].startsWith('--')) {
      positional.push(args[i]);
    }
  }

  if (positional.length === 0) {
    const msg = 'Subtask ID is required.\nUsage: openaidy subtasks complete <subtaskId>';
    p.log.error(msg);
    return { exitCode: 2, error: msg };
  }

  const subtaskId = positional[0];
  const body: Record<string, string> = {};
  if (result) body.result = result;

  let res: Response;
  try {
    res = await fetch(`${config.httpUrl}/api/subtasks/${subtaskId}/complete`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenResult.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const msg = `Cannot reach server at ${config.httpUrl}.\n${err instanceof Error ? err.message : String(err)}`;
    p.log.error(msg);
    return { exitCode: 1, error: msg };
  }

  if (!res.ok) {
    if (res.status === 404) {
      const msg = `Subtask "${subtaskId}" not found.`;
      p.log.error(msg);
      return { exitCode: 1, error: msg };
    }
    const body = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: { message?: string } };
    const msg = `Server returned ${res.status}: ${body.error?.message ?? res.statusText}`;
    p.log.error(msg);
    return { exitCode: 1, error: msg };
  }

  p.log.success(`Subtask "${subtaskId}" marked as completed.`);
  return { exitCode: 0 };
}