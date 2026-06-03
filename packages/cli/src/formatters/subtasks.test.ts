/**
 * Subtasks Formatter Unit Tests
 */

import { describe, it, expect } from 'vitest';
import {
  formatSubtaskStatus,
  formatFullDate,
  formatSubtaskLine,
  formatSubtaskDetail,
  formatSubtaskList,
} from './subtasks.js';
import type { SubtaskStatus } from '@openaidy/shared-types';

describe('formatSubtaskStatus', () => {
  it('returns human-readable labels', () => {
    expect(formatSubtaskStatus('pending')).toBe('Pending');
    expect(formatSubtaskStatus('assigned')).toBe('Assigned');
    expect(formatSubtaskStatus('in_progress')).toBe('In Progress');
    expect(formatSubtaskStatus('completed')).toBe('Completed');
    expect(formatSubtaskStatus('failed')).toBe('Failed');
  });

  it('returns unknown status as-is', () => {
    expect(formatSubtaskStatus('unknown' as SubtaskStatus)).toBe('unknown');
  });
});

describe('formatFullDate', () => {
  it('returns "—" for null', () => {
    expect(formatFullDate(null)).toBe('—');
  });

  it('returns formatted datetime for valid ISO string', () => {
    const result = formatFullDate('2026-01-15T14:30:00.000Z');
    expect(result).toMatch(/Jan/);
    expect(result).toMatch(/2026/);
  });
});

describe('formatSubtaskLine', () => {
  it('formats with status badge and title', () => {
    const line = formatSubtaskLine({
      id: 'st1', taskId: 't1', title: 'Write tests',
      status: 'in_progress' as SubtaskStatus,
      assignedAgentId: null, result: null, retryCount: 0,
      createdAt: '', updatedAt: '',
    });
    expect(line).toContain('[In Progress]');
    expect(line).toContain('Write tests');
  });
});

describe('formatSubtaskDetail', () => {
  it('renders all fields', () => {
    const result = formatSubtaskDetail({
      id: 'st1', taskId: 't1', title: 'Implement feature',
      description: 'Build the thing',
      status: 'completed' as SubtaskStatus,
      assignedAgentId: 'agent-1', result: 'All done!',
      retryCount: 1, createdAt: '2026-01-01T10:00:00Z', updatedAt: '2026-01-02T10:00:00Z',
    });
    expect(result).toContain('st1');
    expect(result).toContain('agent-1');
    expect(result).toContain('All done!');
    expect(result).toContain('1');
  });

  it('truncates long results at 80 chars', () => {
    const longResult = 'A'.repeat(120);
    const result = formatSubtaskDetail({
      id: 'st1', taskId: 't1', title: 'Test', description: 'Desc',
      status: 'completed' as SubtaskStatus,
      assignedAgentId: null, result: longResult,
      retryCount: 0, createdAt: '', updatedAt: '',
    });
    expect(result).toContain('…');
    expect(result).not.toContain('AAAA'.repeat(30));
  });
});

describe('formatSubtaskList', () => {
  it('returns "No subtasks found." for empty array', () => {
    expect(formatSubtaskList([])).toBe('No subtasks found.');
  });

  it('renders all subtask fields', () => {
    const subtasks = [{
      id: 'st1', taskId: 't1', title: 'Step 1',
      status: 'pending' as SubtaskStatus,
      assignedAgentId: null, result: null, retryCount: 0,
      createdAt: '2026-01-01T10:00:00Z', updatedAt: '2026-01-01T10:00:00Z',
    }];
    const result = formatSubtaskList(subtasks);
    expect(result).toContain('[Pending]');
    expect(result).toContain('Step 1');
    expect(result).toContain('st1');
    expect(result).toContain('t1');
  });

  it('renders multiple subtasks', () => {
    const subtasks = [
      { id: 'st1', taskId: 't1', title: 'First', status: 'completed' as SubtaskStatus, assignedAgentId: 'a1', result: 'Done', retryCount: 0, createdAt: '', updatedAt: '' },
      { id: 'st2', taskId: 't1', title: 'Second', status: 'failed' as SubtaskStatus, assignedAgentId: null, result: null, retryCount: 2, createdAt: '', updatedAt: '' },
    ];
    const result = formatSubtaskList(subtasks);
    expect(result).toContain('[Completed]');
    expect(result).toContain('[Failed]');
    expect(result).toContain('a1');
    expect(result).toContain('Retries:   2');
  });
});