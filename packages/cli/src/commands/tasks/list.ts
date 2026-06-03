/**
 * Tasks List Command Handler
 *
 * Implements `openaidy tasks list` command.
 */

import * as p from '@clack/prompts';
import { resolveCLIConfig } from '../../lib/config.js';
import { readAdminToken } from '../../lib/admin-token.js';
import type { CommandResult } from '../../types.js';

type TaskSummary = {
  id: string;
  title: string;
  status: string;
  priority: string;
  createdAt: string;
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const now = Date.now();
  const diff = now - d.getTime();
  const secs  = Math.floor(diff / 1000);
  const mins  = Math.floor(secs  / 60);
  const hours = Math.floor(mins  / 60);
  const days  = Math.floor(hours / 24);
  if (secs < 60)  return 'just now';
  if (mins < 60)  return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7)   return `${days}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const STATUS_LABELS: Record<string, string> = {
  backlog:     'Backlog',
  todo:        'To Do',
  in_progress: 'In Progress',
  review:      'Review',
  done:        'Done',
  cancelled:   'Cancelled',
};

const PRIORITY_CHARS: Record<string, string> = {
  low:    '⚐',
  medium: '⚐',
  high:   '⚑',
  urgent: '✷',
};

function formatStatus(s: string) { return STATUS_LABELS[s] ?? s; }
function formatPriority(p: string) { return PRIORITY_CHARS[p] ?? ' '; }

function formatTaskList(tasks: TaskSummary[]): string {
  if (tasks.length === 0) return 'No tasks found.';
  const order = ['backlog', 'todo', 'in_progress', 'review', 'done', 'cancelled'];
  const grouped = new Map<string, TaskSummary[]>();
  for (const t of tasks) {
    const b = grouped.get(t.status) ?? [];
    b.push(t);
    grouped.set(t.status, b);
  }
  const lines: string[] = ['Tasks', '=====', ''];
  for (const status of order) {
    const bucket = grouped.get(status) ?? [];
    if (bucket.length === 0) continue;
    lines.push(`[${formatStatus(status)}]`);
    for (const t of bucket) {
      lines.push(`  ${formatPriority(t.priority)} ${t.title}`);
      lines.push(`    ID:   ${t.id}`);
      lines.push(`    Age:  ${formatDate(t.createdAt)}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export async function tasksListHandler(
  args: string[],
): Promise<CommandResult> {
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
    const msg = `Bootstrap admin token not found at ${config.tokenPath}.`;
    p.log.error(msg);
    return { exitCode: 1, error: msg };
  }

  // Parse --status and --limit
  let statusFilter: string | undefined;
  let limit = 50;
  const remaining: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--status' && i + 1 < args.length) {
      statusFilter = args[++i];
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

  const url = new URL(`${config.httpUrl}/api/tasks`);
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
    const body = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string };
    const msg = `Server returned ${res.status}: ${body.error ?? res.statusText}`;
    p.log.error(msg);
    return { exitCode: 1, error: msg };
  }

  const { items } = (await res.json()) as { items: TaskSummary[] };
  const slice = items.slice(0, limit);
  p.note(formatTaskList(slice), 'Tasks');
  return { exitCode: 0 };
}