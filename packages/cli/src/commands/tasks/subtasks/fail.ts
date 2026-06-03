/**
 * Subtasks Fail Command Handler
 *
 * Implements `openaidy subtasks fail <subtaskId>` command.
 */

import * as p from '@clack/prompts';
import { resolveCLIConfig } from '../../../lib/config.js';
import { readAdminToken } from '../../../lib/admin-token.js';
import type { CommandResult } from '../../../types.js';

export async function subtasksFailHandler(
  args: string[],
): Promise<CommandResult> {
  if (args.includes('-h') || args.includes('--help')) {
    p.note(
      `Usage: openaidy subtasks fail <subtaskId> [--reason <reason>]

Mark a subtask as failed.

Arguments:
  <subtaskId>    Subtask ID (required)

Options:
  --reason <r>   Failure reason / error message (optional)

Examples:
  pnpm openaidy subtasks fail abc123
  pnpm openaidy subtasks fail abc123 --reason "API rate limit exceeded"

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
    const msg = `Bootstrap admin token not found at ${config.tokenPath}.`;
    p.log.error(msg);
    return { exitCode: 1, error: msg };
  }

  const positional: string[] = [];
  let reason: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--reason' && i + 1 < args.length) {
      reason = args[++i];
    } else if (!args[i].startsWith('--')) {
      positional.push(args[i]);
    }
  }

  if (positional.length === 0) {
    const msg = 'Subtask ID is required.\nUsage: openaidy subtasks fail <subtaskId>';
    p.log.error(msg);
    return { exitCode: 2, error: msg };
  }

  const subtaskId = positional[0];
  const body: Record<string, string> = {};
  if (reason) body.reason = reason;

  let res: Response;
  try {
    res = await fetch(`${config.httpUrl}/api/subtasks/${subtaskId}/fail`, {
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
      p.log.error(`Subtask "${subtaskId}" not found.`);
      return { exitCode: 1, error: `Subtask "${subtaskId}" not found.` };
    }
    const body = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: { message?: string } };
    const msg = `Server returned ${res.status}: ${body.error?.message ?? res.statusText}`;
    p.log.error(msg);
    return { exitCode: 1, error: msg };
  }

  p.log.success(`Subtask "${subtaskId}" marked as failed.`);
  return { exitCode: 0 };
}