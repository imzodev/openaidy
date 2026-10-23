/**
 * Subtask Execution Tests
 *
 * Tests for subtask queries and edits. Execution itself (runs, branching,
 * loops, approvals, retries) is covered against a real database in
 * workflow-run.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskService, type TaskServiceOptions } from './service';

// Mock types
type MockTasksRepo = {
  findById: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  updateStatus: ReturnType<typeof vi.fn>;
  list: ReturnType<typeof vi.fn>;
};

type MockSubtasksRepo = {
  findById: ReturnType<typeof vi.fn>;
  listByTask: ReturnType<typeof vi.fn>;
  listEdgesByTask: ReturnType<typeof vi.fn>;
  addEdges: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  updateStatus: ReturnType<typeof vi.fn>;
  assignAgent: ReturnType<typeof vi.fn>;
  setResult: ReturnType<typeof vi.fn>;
  completeSubtask: ReturnType<typeof vi.fn>;
  failSubtask: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  getCountsByStatus: ReturnType<typeof vi.fn>;
  setAwaitingApproval: ReturnType<typeof vi.fn>;
  resolveApproval: ReturnType<typeof vi.fn>;
  recordLoopIteration: ReturnType<typeof vi.fn>;
  listAll: ReturnType<typeof vi.fn>;
  incrementRetryCount: ReturnType<typeof vi.fn>;
  resetOne: ReturnType<typeof vi.fn>;
};

type MockTaskAgentsRepo = {
  listByTask: ReturnType<typeof vi.fn>;
  assignMultiple: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
};

type MockSessionService = {
  createSession: ReturnType<typeof vi.fn>;
  submitMessage: ReturnType<typeof vi.fn>;
  submitMessageStreaming: ReturnType<typeof vi.fn>;
};

describe('Subtask Execution', () => {
  let taskService: TaskService;
  let mockTasksRepo: MockTasksRepo;
  let mockSubtasksRepo: MockSubtasksRepo;
  let mockTaskAgentsRepo: MockTaskAgentsRepo;
  let mockSessionService: MockSessionService;

  beforeEach(() => {
    mockSubtasksRepo = {
      findById: vi.fn(),
      listByTask: vi.fn(),
      listEdgesByTask: vi.fn().mockResolvedValue([]),
      addEdges: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue({}),
      updateStatus: vi.fn().mockResolvedValue({}),
      assignAgent: vi.fn().mockResolvedValue({}),
      setResult: vi.fn().mockResolvedValue({}),
      completeSubtask: vi.fn().mockResolvedValue({}),
      failSubtask: vi.fn().mockResolvedValue({}),
      create: vi.fn(),
      getCountsByStatus: vi.fn().mockResolvedValue({
        pending: 0,
        in_progress: 0,
        completed: 0,
        failed: 0,
        assigned: 0,
      }),
      setAwaitingApproval: vi.fn().mockResolvedValue({}),
      resolveApproval: vi.fn().mockResolvedValue({}),
      recordLoopIteration: vi.fn().mockResolvedValue({}),
      listAll: vi.fn().mockResolvedValue([]),
      incrementRetryCount: vi.fn().mockResolvedValue({}),
      resetOne: vi.fn().mockResolvedValue({}),
    };

    mockTasksRepo = {
      findById: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
      updateStatus: vi.fn().mockResolvedValue({}),
      list: vi.fn(),
    };

    mockTaskAgentsRepo = {
      listByTask: vi.fn().mockResolvedValue([]),
      assignMultiple: vi.fn().mockResolvedValue([]),
      remove: vi.fn().mockResolvedValue(undefined),
    };

    mockSessionService = {
      createSession: vi.fn().mockResolvedValue({ id: 'session-1' }),
      submitMessage: vi.fn(),
      submitMessageStreaming: vi.fn().mockResolvedValue({}),
    };

    taskService = new TaskService({
      tasksRepo: mockTasksRepo as unknown as TaskServiceOptions['tasksRepo'],
      subtasksRepo:
        mockSubtasksRepo as unknown as TaskServiceOptions['subtasksRepo'],
      taskAgentsRepo:
        mockTaskAgentsRepo as unknown as TaskServiceOptions['taskAgentsRepo'],
      sessionService: mockSessionService as unknown as NonNullable<
        TaskServiceOptions['sessionService']
      >,
    });
  });

  describe('getNextExecutableSubtasks', () => {
    it('returns only pending subtasks with completed dependencies', async () => {
      mockSubtasksRepo.listByTask.mockResolvedValue([
        { id: 'subtask-1', status: 'pending' },
        { id: 'subtask-2', status: 'in_progress' },
        { id: 'subtask-3', status: 'pending' },
        { id: 'subtask-4', status: 'pending' },
        { id: 'subtask-5', status: 'pending' },
        { id: 'subtask-6', status: 'completed' },
      ]);
      mockSubtasksRepo.listEdgesByTask.mockResolvedValue([
        { subtaskId: 'subtask-3', dependsOnSubtaskId: 'subtask-1' },
        { subtaskId: 'subtask-4', dependsOnSubtaskId: 'subtask-2' },
        { subtaskId: 'subtask-5', dependsOnSubtaskId: 'subtask-6' },
      ]);

      const result = await taskService.getNextExecutableSubtasks('task-1');

      // subtask-1 has no dependencies
      // subtask-3 depends on subtask-1 (pending - not completed)
      // subtask-4 depends on subtask-2 (in_progress - not completed)
      // subtask-5 depends on subtask-6 (completed - so executable)
      expect(result).toHaveLength(2);
      expect(result.map((s) => s.id)).toContain('subtask-1');
      expect(result.map((s) => s.id)).toContain('subtask-5');
    });

    it('returns empty array if no executable subtasks', async () => {
      // All pending subtasks have dependencies on non-completed subtasks
      mockSubtasksRepo.listByTask.mockResolvedValue([
        { id: 'subtask-1', status: 'completed' },
        { id: 'subtask-2', status: 'in_progress' },
        { id: 'subtask-3', status: 'pending' },
        { id: 'subtask-4', status: 'pending' },
      ]);
      mockSubtasksRepo.listEdgesByTask.mockResolvedValue([
        // subtask-3 depends on subtask-2 which is in_progress (not completed)
        { subtaskId: 'subtask-3', dependsOnSubtaskId: 'subtask-2' },
        // subtask-4 depends on subtask-5 which doesn't exist
        { subtaskId: 'subtask-4', dependsOnSubtaskId: 'subtask-5' },
      ]);

      const result = await taskService.getNextExecutableSubtasks('task-1');

      expect(result).toHaveLength(0);
    });

    it('requires ALL dependencies to complete when a subtask has multiple (regression: previously only the first dependency was tracked)', async () => {
      mockSubtasksRepo.listByTask.mockResolvedValue([
        { id: 'subtask-1', status: 'completed' },
        { id: 'subtask-2', status: 'pending' },
        { id: 'subtask-3', status: 'pending' },
      ]);
      mockSubtasksRepo.listEdgesByTask.mockResolvedValue([
        { subtaskId: 'subtask-3', dependsOnSubtaskId: 'subtask-1' },
        { subtaskId: 'subtask-3', dependsOnSubtaskId: 'subtask-2' },
      ]);

      let result = await taskService.getNextExecutableSubtasks('task-1');
      expect(result.map((s) => s.id)).not.toContain('subtask-3');

      // subtask-2 completes too — subtask-3 should now be executable.
      mockSubtasksRepo.listByTask.mockResolvedValue([
        { id: 'subtask-1', status: 'completed' },
        { id: 'subtask-2', status: 'completed' },
        { id: 'subtask-3', status: 'pending' },
      ]);

      result = await taskService.getNextExecutableSubtasks('task-1');
      expect(result.map((s) => s.id)).toContain('subtask-3');
    });

    it('returns all pending subtasks when none have dependencies', async () => {
      mockSubtasksRepo.listByTask.mockResolvedValue([
        { id: 'subtask-1', status: 'pending' },
        { id: 'subtask-2', status: 'pending' },
        { id: 'subtask-3', status: 'pending' },
      ]);

      const result = await taskService.getNextExecutableSubtasks('task-1');

      expect(result).toHaveLength(3);
    });
  });

  describe('updateSubtask', () => {
    it('resets a completed subtask to pending when its description changes', async () => {
      mockSubtasksRepo.findById.mockResolvedValue({
        id: 'subtask-1',
        title: 'Step 1',
        description: 'Old instructions',
        status: 'completed',
        taskId: 'task-1',
      });

      const result = await taskService.updateSubtask('subtask-1', {
        description: 'New instructions',
      });

      expect(result.ok).toBe(true);
      expect(mockSubtasksRepo.resetOne).toHaveBeenCalledWith('subtask-1');
      expect(mockSubtasksRepo.update).toHaveBeenCalledWith('subtask-1', {
        description: 'New instructions',
      });
    });

    it('resets a failed subtask to pending when its title changes', async () => {
      mockSubtasksRepo.findById.mockResolvedValue({
        id: 'subtask-1',
        title: 'Old title',
        description: 'desc',
        status: 'failed',
        taskId: 'task-1',
      });

      await taskService.updateSubtask('subtask-1', { title: 'New title' });

      expect(mockSubtasksRepo.resetOne).toHaveBeenCalledWith('subtask-1');
    });

    it('does not reset a completed subtask when the description is unchanged', async () => {
      mockSubtasksRepo.findById.mockResolvedValue({
        id: 'subtask-1',
        title: 'Step 1',
        description: 'Same instructions',
        status: 'completed',
        taskId: 'task-1',
      });

      await taskService.updateSubtask('subtask-1', {
        description: 'Same instructions',
      });

      expect(mockSubtasksRepo.resetOne).not.toHaveBeenCalled();
    });

    it('does not reset a pending subtask when its description changes', async () => {
      mockSubtasksRepo.findById.mockResolvedValue({
        id: 'subtask-1',
        title: 'Step 1',
        description: 'Old instructions',
        status: 'pending',
        taskId: 'task-1',
      });

      await taskService.updateSubtask('subtask-1', {
        description: 'New instructions',
      });

      expect(mockSubtasksRepo.resetOne).not.toHaveBeenCalled();
    });

    it('does not reset when unrelated fields change (e.g. a loop config edit)', async () => {
      mockSubtasksRepo.findById.mockResolvedValue({
        id: 'subtask-1',
        title: 'Step 1',
        description: 'Old instructions',
        status: 'completed',
        taskId: 'task-1',
      });

      await taskService.updateSubtask('subtask-1', {
        loop: {
          maxIterations: 3,
          conditionOperator: 'contains',
          conditionValue: 'done',
        },
      });

      expect(mockSubtasksRepo.resetOne).not.toHaveBeenCalled();
    });
  });
});
