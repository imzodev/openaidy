/**
 * Tasks Formatter Unit Tests
 */

import { describe, it, expect } from 'vitest';
import {
  formatStatus,
  formatPriority,
  formatDate,
  formatFullDate,
  formatTaskLine,
  formatTaskDetail,
  formatTaskList,
  formatKanbanBoard,
} from './tasks.js';

describe('formatStatus', () => {
  it('returns human-readable labels', () => {
    expect(formatStatus('backlog')).toBe('Backlog');
    expect(formatStatus('todo')).toBe('To Do');
    expect(formatStatus('in_progress')).toBe('In Progress');
    expect(formatStatus('review')).toBe('Review');
    expect(formatStatus('done')).toBe('Done');
    expect(formatStatus('cancelled')).toBe('Cancelled');
  });

  it('returns unknown status as-is', () => {
    expect(formatStatus('unknown')).toBe('unknown');
  });
});

describe('formatPriority', () => {
  it('returns correct symbols', () => {
    expect(formatPriority('low')).toBe('⚐');
    expect(formatPriority('medium')).toBe('⚐');
    expect(formatPriority('high')).toBe('⚑');
    expect(formatPriority('urgent')).toBe('✷');
  });

  it('returns space for unknown priority', () => {
    expect(formatPriority('weird')).toBe(' ');
  });
});

describe('formatDate', () => {
  it('returns "—" for null/undefined', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate(undefined as unknown as string)).toBe('—');
  });

  it('returns "just now" for very recent dates', () => {
    const now = new Date().toISOString();
    expect(formatDate(now)).toBe('just now');
  });

  it('returns minutes ago for recent dates', () => {
    const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    expect(formatDate(fiveMinsAgo)).toBe('5m ago');
  });

  it('returns hours ago for today's older dates', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    expect(formatDate(twoHoursAgo)).toBe('2h ago');
  });

  it('returns days ago for this week', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatDate(threeDaysAgo)).toBe('3d ago');
  });

  it('returns short date for older dates', () => {
    const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    // Should be a date string, not a relative string
    expect(formatDate(twoWeeksAgo)).not.toMatch(/^\d+m?h?d?a?go$/);
  });
});

describe('formatFullDate', () => {
  it('returns "—" for null', () => {
    expect(formatFullDate(null)).toBe('—');
  });

  it('returns formatted datetime for valid ISO string', () => {
    const iso = '2026-01-15T14:30:00.000Z';
    const result = formatFullDate(iso);
    expect(result).toMatch(/Jan/);
    expect(result).toMatch(/2026/);
  });
});

describe('formatTaskLine', () => {
  it('formats a task with status and priority', () => {
    const result = formatTaskLine({
      id: 'abc123',
      title: 'Fix login bug',
      status: 'in_progress',
      priority: 'high',
    });
    expect(result).toContain('[In Progress]');
    expect(result).toContain('⚑');
    expect(result).toContain('Fix login bug');
  });
});

describe('formatTaskDetail', () => {
  it('renders all fields', () => {
    const task = {
      id: 'abc123',
      title: 'Test Task',
      description: 'This is a test description',
      status: 'todo' as const,
      priority: 'medium' as const,
      planningEnabled: true,
      planningStatus: 'completed' as const,
      sessionId: 'sess-001',
      agents: [{ agentId: 'agent-1', role: 'primary', assignedAt: '2026-01-01T10:00:00Z' }],
      subtaskCount: { pending: 2, in_progress: 1, completed: 5, failed: 0 },
      createdAt: '2026-01-01T10:00:00Z',
      updatedAt: '2026-01-15T14:30:00Z',
    };
    const result = formatTaskDetail(task);
    expect(result).toContain('abc123');
    expect(result).toContain('Test Task');
    expect(result).toContain('This is a test description');
    expect(result).toContain('To Do');
    expect(result).toContain('enabled (completed)');
    expect(result).toContain('sess-001');
    expect(result).toContain('agent-1 (primary)');
    expect(result).toContain('2 pending');
    expect(result).toContain('5 done');
  });

  it('handles no agents and no session', () => {
    const task = {
      id: 'xyz789',
      title: 'Alone Task',
      description: 'No agents here',
      status: 'backlog' as const,
      priority: 'low' as const,
      planningEnabled: false,
      planningStatus: null,
      sessionId: null,
      agents: [],
      subtaskCount: { pending: 0, in_progress: 0, completed: 0, failed: 0 },
      createdAt: '2026-01-01T10:00:00Z',
      updatedAt: '2026-01-01T10:00:00Z',
    };
    const result = formatTaskDetail(task);
    expect(result).toContain('none');
    expect(result).toContain('—');
  });
});

describe('formatTaskList', () => {
  it('returns "No tasks found." for empty array', () => {
    expect(formatTaskList([])).toBe('No tasks found.');
  });

  it('groups tasks by status and sorts by status order', () => {
    const tasks = [
      { id: 't1', title: 'In Progress Task', status: 'in_progress' as const, priority: 'high' as const, createdAt: '2026-01-01T10:00:00Z' },
      { id: 't2', title: 'Done Task', status: 'done' as const, priority: 'low' as const, createdAt: '2026-01-02T10:00:00Z' },
      { id: 't3', title: 'Backlog Task', status: 'backlog' as const, priority: 'medium' as const, createdAt: '2026-01-03T10:00:00Z' },
    ];
    const result = formatTaskList(tasks);
    expect(result).toContain('Backlog');
    expect(result).toContain('In Progress');
    expect(result).toContain('Done');
    expect(result).toContain('In Progress Task');
    expect(result).toContain('Done Task');
    expect(result).toContain('Backlog Task');
  });
});

describe('formatKanbanBoard', () => {
  it('renders all 6 columns with correct headers', () => {
    const board = {
      backlog:     [{ id: 't1', title: 'Backlog Item', priority: 'low' as const }],
      todo:        [],
      in_progress: [{ id: 't2', title: 'Working On It', priority: 'high' as const }],
      review:      [],
      done:        [{ id: 't3', title: 'Completed', priority: 'medium' as const }],
      cancelled:   [],
    };
    const result = formatKanbanBoard(board);
    expect(result).toContain('Backlog (1)');
    expect(result).toContain('To Do (0)');
    expect(result).toContain('In Progress (1)');
    expect(result).toContain('Review (0)');
    expect(result).toContain('Done (1)');
    expect(result).toContain('Cancelled (0)');
    expect(result).toContain('Backlog Item');
    expect(result).toContain('Working On It');
  });

  it('shows "—" for empty columns', () => {
    const emptyBoard: Record<string, Array<{ id: string; title: string; priority: string }>> = {
      backlog: [], todo: [], in_progress: [], review: [], done: [], cancelled: [],
    };
    const result = formatKanbanBoard(emptyBoard);
    const lines = result.split('\n');
    const emptyColLines = lines.filter(l => l.trim() === '—');
    expect(emptyColLines.length).toBe(6);
  });
});