/**
 * Subtasks List Command Handler
 *
 * Implements `openaidy subtasks list <taskId>` command.
 */

import * as p from '@clack/prompts';
import { resolveCLIConfig } from '../../../lib/config.js';
import { readAdminToken } from '../../../lib/admin-token.js';
import type { CommandResult } from '../../../types.js';

type SubtaskSummary = {
  id: string; taskId: string; title: string;
  status: string; assignedAgentId: string | null;
  result: string | null; retryCount: number;
  createdAt: string; updatedAt: string;
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending', assigned: 'Assigned',
  in_progress: 'In Progress', completed: 'Completed', failed: 'Failed',
};
function formatStatus(s: string) { return STATUS_LABELS[s] ?? s; }

function formatFullDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatSubtaskList(subtasks: SubtaskSummary[]): string {
  if (subtasks.length === 0) return 'No subtasks found.';
  const lines: string[] = ['Subtasks', '========', ''];
  for (const s of subtasks) {
    lines.push(`[${formatStatus(s.status)}] ${s.title}`);
    lines.push(`  ID:        ${s.id}`);
    lines.push(`  Task:      ${s.taskId}`);
    if (s.assignedAgentId) lines.push(`  Assigned:  ${s.assignedAgentId}`);
    if (s.result) lines.push(`  Result:    ${s.result.length > 80 ? s.result.slice(0, 80) + '…' : s.result}`);
    if (s.retryCount > 0) lines.push(`  Retries:   ${s.retryCount}`);
    lines.push(`  Created:   ${formatFullDate(s.createdAt)}`);
    lines.push('');
  }
  return lines.join('\n');
}

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
    const msg = `Bootstrap admin token not found at ${config.tokenPath}.`;
    p.log.error(msg);
    return { exitCode: 1, error: msg };
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

  const { items } = (await res.json()) as { items: SubtaskSummary[] };
  p.note(formatSubtaskList(items), `Subtasks for ${taskId}`);
  return { exitCode: 0 };
}