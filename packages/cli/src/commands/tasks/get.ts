/**
 * Tasks Get Command Handler
 *
 * Implements `openaidy tasks get <id>` command.
 */

import * as p from '@clack/prompts';
import { resolveCLIConfig } from '../../lib/config.js';
import { readAdminToken } from '../../lib/admin-token.js';
import type { CommandResult } from '../../types.js';

type TaskDetail = {
  id: string; title: string; description: string;
  status: string; priority: string;
  planningEnabled: boolean; planningStatus: string | null;
  sessionId: string | null;
  agents: Array<{ agentId: string; role: string; assignedAt: string }>;
  subtaskCount: { pending: number; in_progress: number; completed: number; failed: number };
  createdAt: string; updatedAt: string;
};

const STATUS_LABELS: Record<string, string> = {
  backlog: 'Backlog', todo: 'To Do', in_progress: 'In Progress',
  review: 'Review', done: 'Done', cancelled: 'Cancelled',
};
const PRIORITY_CHARS: Record<string, string> = {
  low: '⚐', medium: '⚐', high: '⚑', urgent: '✷',
};

function formatStatus(s: string) { return STATUS_LABELS[s] ?? s; }
function formatPriority(p: string) { return PRIORITY_CHARS[p] ?? ' '; }

function formatFullDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatTaskDetail(task: TaskDetail): string {
  const lines: string[] = [];
  lines.push(`ID:             ${task.id}`);
  lines.push(`Title:          ${task.title}`);
  lines.push(`Description:   ${task.description}`);
  lines.push(`Status:        ${formatStatus(task.status)}`);
  lines.push(`Priority:      ${task.priority}`);
  lines.push(`Planning:      ${task.planningEnabled ? 'enabled' : 'disabled'}${task.planningStatus ? ` (${task.planningStatus})` : ''}`);
  lines.push(`Session:       ${task.sessionId ?? '—'}`);
  lines.push(`Created:       ${formatFullDate(task.createdAt)}`);
  lines.push(`Updated:       ${formatFullDate(task.updatedAt)}`);
  if (task.agents.length > 0) {
    lines.push('Agents:');
    for (const a of task.agents) lines.push(`  - ${a.agentId} (${a.role})`);
  } else {
    lines.push('Agents:         none');
  }
  const sc = task.subtaskCount;
  lines.push(`Subtasks:       ${sc.pending} pending · ${sc.in_progress} in progress · ${sc.completed} done · ${sc.failed} failed`);
  return lines.join('\n');
}

export async function tasksGetHandler(
  args: string[],
): Promise<CommandResult> {
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
    const msg = `Bootstrap admin token not found at ${config.tokenPath}.`;
    p.log.error(msg);
    return { exitCode: 1, error: msg };
  }

  // Collect args until first -- flag
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
    res = await fetch(`${config.httpUrl}/api/tasks/${taskId}`, {
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

  const { data } = (await res.json()) as { data: TaskDetail };
  p.note(formatTaskDetail(data), `Task: ${data.title}`);
  return { exitCode: 0 };
}