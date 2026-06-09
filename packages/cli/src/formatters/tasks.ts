/**
 * Task List Formatter
 *
 * Formats task data for CLI output.
 */

import type { TaskStatus, TaskPriority } from '@openaidy/shared-types';

/**
 * Map status to a readable label
 */
export function formatStatus(status: TaskStatus): string {
  const labels: Record<TaskStatus, string> = {
    backlog: 'Backlog',
    todo: 'To Do',
    in_progress: 'In Progress',
    review: 'Review',
    done: 'Done',
    cancelled: 'Cancelled',
  };
  return labels[status] ?? status;
}

/**
 * Map priority to a single-char indicator
 */
export function formatPriority(p: TaskPriority): string {
  const map: Record<TaskPriority, string> = {
    low: '⚐',
    medium: '⚐',
    high: '⚑',
    urgent: '✷',
  };
  return map[p] ?? ' ';
}

/**
 * Format a relative date string
 */
export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const now = Date.now();
  const diff = now - d.getTime();
  const secs = Math.floor(diff / 1000);
  const mins = Math.floor(secs / 60);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);

  if (secs < 60) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Format a full date
 */
export function formatFullDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Format a single task line for list output
 */
export function formatTaskLine(task: {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
}): string {
  return `[${formatStatus(task.status)}] ${formatPriority(task.priority)} ${task.title}`;
}

/**
 * Format a task detail block (for `tasks get`)
 */
export function formatTaskDetail(task: {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  planningEnabled: boolean;
  planningStatus: string | null;
  sessionId: string | null;
  agents: Array<{ agentId: string; role: string; assignedAt: string }>;
  progress: {
    total: number;
    completed: number;
    inProgress: number;
    failed: number;
  };
  createdAt: string;
  updatedAt: string;
}): string {
  const lines: string[] = [];
  lines.push(`ID:             ${task.id}`);
  lines.push(`Title:          ${task.title}`);
  lines.push(`Description:   ${task.description}`);
  lines.push(`Status:        ${formatStatus(task.status)}`);
  lines.push(`Priority:      ${task.priority}`);
  lines.push(
    `Planning:      ${task.planningEnabled ? 'enabled' : 'disabled'}${task.planningStatus ? ` (${task.planningStatus})` : ''}`,
  );
  lines.push(`Session:       ${task.sessionId ?? '—'}`);
  lines.push(`Created:       ${formatFullDate(task.createdAt)}`);
  lines.push(`Updated:       ${formatFullDate(task.updatedAt)}`);

  if (task.agents.length > 0) {
    lines.push('Agents:');
    for (const a of task.agents) {
      lines.push(`  - ${a.agentId} (${a.role})`);
    }
  } else {
    lines.push('Agents:         none');
  }

  const pg = task.progress;
  lines.push(
    `Subtasks:       ${pg.total} total · ${pg.completed} completed · ${pg.inProgress} in progress · ${pg.failed} failed`,
  );

  return lines.join('\n');
}

/**
 * Format task list (for `tasks list`)
 */
export function formatTaskList(
  tasks: Array<{
    id: string;
    title: string;
    status: TaskStatus;
    priority: TaskPriority;
    createdAt: string;
  }>,
): string {
  if (tasks.length === 0) return 'No tasks found.';

  const lines: string[] = [];
  lines.push('Tasks');
  lines.push('=====');
  lines.push('');

  const order: TaskStatus[] = [
    'backlog',
    'todo',
    'in_progress',
    'review',
    'done',
    'cancelled',
  ];
  const grouped = new Map<TaskStatus, typeof tasks>();
  for (const t of tasks) {
    const bucket = grouped.get(t.status) ?? [];
    bucket.push(t);
    grouped.set(t.status, bucket);
  }

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

/**
 * Format a Kanban board (for `tasks kanban`)
 */
export function formatKanbanBoard(
  board: Record<
    TaskStatus,
    Array<{
      id: string;
      title: string;
      priority: TaskPriority;
    }>
  >,
): string {
  const order: TaskStatus[] = [
    'backlog',
    'todo',
    'in_progress',
    'review',
    'done',
    'cancelled',
  ];
  const lines: string[] = [];
  lines.push('Kanban Board');
  lines.push('===========');
  lines.push('');

  for (const status of order) {
    const col = board[status] ?? [];
    lines.push(`${formatStatus(status)} (${col.length})`);
    if (col.length === 0) {
      lines.push('  —');
    } else {
      for (const t of col) {
        lines.push(`  ${formatPriority(t.priority)} ${t.title}  [${t.id}]`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}
