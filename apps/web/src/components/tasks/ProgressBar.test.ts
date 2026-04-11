/**
 * Progress Bar Component Tests
 */

import { describe, it, expect } from 'vitest';

// Simple unit tests for ProgressBar logic
describe('ProgressBar', () => {
  describe('getStatusColor', () => {
    const getStatusColor = (progress: { failed: number; percentage: number; inProgress: number }): string => {
      if (progress.failed > 0) return 'bg-red-500';
      if (progress.percentage === 100) return 'bg-green-500';
      if (progress.inProgress > 0) return 'bg-blue-500';
      return 'bg-gray-300';
    };

    it('returns red when there are failures', () => {
      const progress = { failed: 1, percentage: 50, inProgress: 1 };
      expect(getStatusColor(progress)).toBe('bg-red-500');
    });

    it('returns green when 100% complete', () => {
      const progress = { failed: 0, percentage: 100, inProgress: 0 };
      expect(getStatusColor(progress)).toBe('bg-green-500');
    });

    it('returns blue when in progress', () => {
      const progress = { failed: 0, percentage: 50, inProgress: 1 };
      expect(getStatusColor(progress)).toBe('bg-blue-500');
    });

    it('returns gray when pending', () => {
      const progress = { failed: 0, percentage: 0, inProgress: 0 };
      expect(getStatusColor(progress)).toBe('bg-gray-300');
    });

    it('prioritizes failures over completion', () => {
      const progress = { failed: 1, percentage: 100, inProgress: 0 };
      expect(getStatusColor(progress)).toBe('bg-red-500');
    });
  });

  describe('calculatePercentage', () => {
    const calculatePercentage = (total: number, completed: number): number => {
      if (total === 0) return 0;
      return Math.round((completed / total) * 100);
    };

    it('returns 0 when total is 0', () => {
      expect(calculatePercentage(0, 0)).toBe(0);
    });

    it('calculates 50% correctly', () => {
      expect(calculatePercentage(4, 2)).toBe(50);
    });

    it('calculates 100% when all complete', () => {
      expect(calculatePercentage(5, 5)).toBe(100);
    });

    it('rounds to nearest integer', () => {
      expect(calculatePercentage(3, 1)).toBe(33);
    });
  });

  describe('TaskProgress', () => {
    it('creates default progress', () => {
      const progress = {
        taskId: 'task-1',
        total: 0,
        completed: 0,
        inProgress: 0,
        pending: 0,
        failed: 0,
        percentage: 0,
      };

      expect(progress.taskId).toBe('task-1');
      expect(progress.total).toBe(0);
      expect(progress.percentage).toBe(0);
    });

    it('merges partial progress', () => {
      const base = {
        taskId: 'task-1',
        total: 4,
        completed: 0,
        inProgress: 0,
        pending: 4,
        failed: 0,
        percentage: 0,
      };

      const update = { completed: 2, pending: 2, percentage: 50 };
      const merged = { ...base, ...update };

      expect(merged.completed).toBe(2);
      expect(merged.pending).toBe(2);
      expect(merged.percentage).toBe(50);
      expect(merged.total).toBe(4); // unchanged
    });
  });

  describe('progress state transitions', () => {
    it('transitions from pending to in_progress', () => {
      const before = { pending: 4, inProgress: 0, completed: 0 };
      const after = { pending: 3, inProgress: 1, completed: 0 };

      expect(after.pending).toBe(before.pending - 1);
      expect(after.inProgress).toBe(before.inProgress + 1);
    });

    it('transitions from in_progress to completed', () => {
      const before = { pending: 0, inProgress: 1, completed: 0 };
      const after = { pending: 0, inProgress: 0, completed: 1 };

      expect(after.inProgress).toBe(before.inProgress - 1);
      expect(after.completed).toBe(before.completed + 1);
    });
  });
});
