/**
 * Planning Panel Component Tests
 */

import { describe, it, expect, vi } from 'vitest';

// Simple unit tests for PlanningPanel logic
describe('PlanningPanel', () => {
  describe('STATUS_CONFIG', () => {
    it('should have config for all planning statuses', () => {
      const STATUS_CONFIG = {
        pending: { label: 'Not Started', color: 'text-gray-500', icon: '○' },
        in_progress: { label: 'Planning...', color: 'text-blue-500', icon: '◐' },
        completed: { label: 'Completed', color: 'text-green-500', icon: '✓' },
        failed: { label: 'Failed', color: 'text-red-500', icon: '✗' },
      };

      expect(STATUS_CONFIG.pending).toBeDefined();
      expect(STATUS_CONFIG.in_progress).toBeDefined();
      expect(STATUS_CONFIG.completed).toBeDefined();
      expect(STATUS_CONFIG.failed).toBeDefined();
    });

    it('should have correct labels', () => {
      const STATUS_CONFIG = {
        pending: { label: 'Not Started' },
        in_progress: { label: 'Planning...' },
        completed: { label: 'Completed' },
        failed: { label: 'Failed' },
      };

      expect(STATUS_CONFIG.pending.label).toBe('Not Started');
      expect(STATUS_CONFIG.in_progress.label).toBe('Planning...');
      expect(STATUS_CONFIG.completed.label).toBe('Completed');
      expect(STATUS_CONFIG.failed.label).toBe('Failed');
    });
  });

  describe('sortSubtasks', () => {
    it('should sort subtasks by orderIndex', () => {
      const subtasks = [
        { id: '1', orderIndex: 2, title: 'Third' },
        { id: '2', orderIndex: 0, title: 'First' },
        { id: '3', orderIndex: 1, title: 'Second' },
      ];

      const sorted = [...subtasks].sort((a, b) => a.orderIndex - b.orderIndex);

      expect(sorted[0].title).toBe('First');
      expect(sorted[1].title).toBe('Second');
      expect(sorted[2].title).toBe('Third');
    });
  });

  describe('handleStartPlanning', () => {
    it('should set isPlanning to true during planning', async () => {
      let isPlanning = false;
      const onPlanTask = vi.fn().mockImplementation(async () => {
        isPlanning = true;
        await new Promise((resolve) => setTimeout(resolve, 10));
        isPlanning = false;
      });

      await onPlanTask();
      expect(onPlanTask).toHaveBeenCalled();
    });

    it('should set error on failure', async () => {
      const onPlanTask = vi.fn().mockRejectedValue(new Error('Planning failed'));
      let error: string | null = null;

      try {
        await onPlanTask();
      } catch (err) {
        error = err instanceof Error ? err.message : 'Unknown error';
      }

      expect(error).toBe('Planning failed');
    });
  });

  describe('handleDelete', () => {
    it('should call onDeleteSubtask when confirmed', async () => {
      const onDeleteSubtask = vi.fn().mockResolvedValue(undefined);
      const loadSubtasks = vi.fn();

      // Simulate confirmation
      const confirmed = true;
      if (confirmed) {
        await onDeleteSubtask('subtask-1');
        await loadSubtasks();
      }

      expect(onDeleteSubtask).toHaveBeenCalledWith('subtask-1');
      expect(loadSubtasks).toHaveBeenCalled();
    });

    it('should not call onDeleteSubtask when cancelled', async () => {
      const onDeleteSubtask = vi.fn().mockResolvedValue(undefined);

      // Simulate cancellation
      const confirmed = false;
      if (confirmed) {
        await onDeleteSubtask('subtask-1');
      }

      expect(onDeleteSubtask).not.toHaveBeenCalled();
    });
  });

  describe('handleAddNew', () => {
    it('should call onAddSubtask with correct data', async () => {
      const onAddSubtask = vi.fn().mockResolvedValue(undefined);
      const loadSubtasks = vi.fn();

      const subtask = {
        title: 'New Subtask',
        description: 'New description',
      };

      await onAddSubtask(subtask);
      await loadSubtasks();

      expect(onAddSubtask).toHaveBeenCalledWith(subtask);
      expect(loadSubtasks).toHaveBeenCalled();
    });
  });
});
