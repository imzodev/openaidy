/**
 * Subtask Execution Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskService, type TaskServiceOptions } from './service';

// Mock types
type MockTask = {
  id: string;
  title: string;
  sessionId?: string | null;
};

type MockSubtask = {
  id: string;
  taskId: string;
  title: string;
  description: string;
  status: string;
  parentSubtaskId?: string | null;
  sessionId?: string | null;
};

describe('Subtask Execution', () => {
  let taskService: TaskService;
  let mockTasksRepo: {
    findById: ReturnType<typeof vi.fn>;
    updateStatus: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  let mockSubtasksRepo: {
    findById: ReturnType<typeof vi.fn>;
    listByTask: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateStatus: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  let mockTaskAgentsRepo: {
    listByTask: ReturnType<typeof vi.fn>;
    assignMultiple: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };
  let mockSessionService: {
    createSession: ReturnType<typeof vi.fn>;
    submitMessage: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockTasksRepo = {
      findById: vi.fn(),
      updateStatus: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    };

    mockSubtasksRepo = {
      findById: vi.fn(),
      listByTask: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
      updateStatus: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({ id: 'new-subtask' }),
    };

    mockTaskAgentsRepo = {
      listByTask: vi.fn().mockResolvedValue([]),
      assignMultiple: vi.fn().mockResolvedValue([]),
      remove: vi.fn().mockResolvedValue({}),
    };

    mockSessionService = {
      createSession: vi.fn().mockResolvedValue({ id: 'session-1' }),
      submitMessage: vi.fn().mockResolvedValue({ ok: true }),
    };

    const options: TaskServiceOptions = {
      tasksRepo: mockTasksRepo as any,
      subtasksRepo: mockSubtasksRepo as any,
      taskAgentsRepo: mockTaskAgentsRepo as any,
      sessionService: mockSessionService as any,
    };

    taskService = new TaskService(options);
  });

  describe('executeSubtasks', () => {
    it('executes all subtasks without dependencies', async () => {
      mockTasksRepo.findById.mockResolvedValue({
        id: 'task-1',
        title: 'Test Task',
      } as MockTask);

      mockSubtasksRepo.listByTask.mockResolvedValue([
        { id: 'subtask-1', status: 'pending', title: 'A', description: 'A' },
        { id: 'subtask-2', status: 'pending', title: 'B', description: 'B' },
      ] as MockSubtask[]);

      mockSubtasksRepo.findById.mockResolvedValue({
        id: 'subtask-1',
        taskId: 'task-1',
        title: 'Test',
        description: 'Test',
        status: 'pending',
      } as MockSubtask);

      const result = await taskService.executeSubtasks('task-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.startedCount).toBe(2);
      }
    });

    it('only executes subtasks with completed dependencies', async () => {
      mockTasksRepo.findById.mockResolvedValue({
        id: 'task-1',
        title: 'Test Task',
      } as MockTask);

      mockSubtasksRepo.listByTask.mockResolvedValue([
        { id: 'subtask-1', status: 'pending', title: 'A', description: 'A' },
        { id: 'subtask-2', status: 'pending', title: 'B', description: 'B', parentSubtaskId: 'subtask-1' },
      ] as MockSubtask[]);

      mockSubtasksRepo.findById.mockResolvedValue({
        id: 'subtask-1',
        taskId: 'task-1',
        title: 'Test',
        description: 'Test',
        status: 'pending',
      } as MockSubtask);

      const result = await taskService.executeSubtasks('task-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Only subtask-1 should start (subtask-2 depends on it)
        expect(result.data.startedCount).toBe(1);
      }
    });

    it('returns error if task not found', async () => {
      mockTasksRepo.findById.mockResolvedValue(null);

      const result = await taskService.executeSubtasks('nonexistent');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('task.not_found');
      }
    });
  });

  describe('completeSubtask', () => {
    it('updates subtask status and result', async () => {
      mockSubtasksRepo.findById.mockResolvedValue({
        id: 'subtask-1',
        taskId: 'task-1',
        status: 'in_progress',
      } as MockSubtask);

      mockSubtasksRepo.update.mockResolvedValue({
        id: 'subtask-1',
        status: 'completed',
        result: 'Success result',
      });

      mockSubtasksRepo.listByTask.mockResolvedValue([
        { id: 'subtask-1', status: 'completed' },
      ]);

      const result = await taskService.completeSubtask('subtask-1', 'Success result');

      expect(result.ok).toBe(true);
      expect(mockSubtasksRepo.update).toHaveBeenCalledWith('subtask-1', {
        status: 'completed',
        result: 'Success result',
      });
    });

    it('updates task to done when all subtasks complete', async () => {
      mockSubtasksRepo.findById.mockResolvedValue({
        id: 'subtask-2',
        taskId: 'task-1',
        status: 'in_progress',
      } as MockSubtask);

      mockSubtasksRepo.update.mockResolvedValue({
        id: 'subtask-2',
        status: 'completed',
        result: 'Done',
      });

      mockSubtasksRepo.listByTask.mockResolvedValue([
        { id: 'subtask-1', status: 'completed' },
        { id: 'subtask-2', status: 'completed' },
      ]);

      await taskService.completeSubtask('subtask-2', 'Done');

      expect(mockTasksRepo.updateStatus).toHaveBeenCalledWith('task-1', 'done');
    });

    it('returns error if subtask not found', async () => {
      mockSubtasksRepo.findById.mockResolvedValue(null);

      const result = await taskService.completeSubtask('nonexistent', 'result');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('subtask.not_found');
      }
    });
  });

  describe('failSubtask', () => {
    it('updates subtask status to failed with error', async () => {
      mockSubtasksRepo.findById.mockResolvedValue({
        id: 'subtask-1',
        taskId: 'task-1',
        status: 'in_progress',
      } as MockSubtask);

      mockSubtasksRepo.update.mockResolvedValue({
        id: 'subtask-1',
        status: 'failed',
        result: 'Error: Something went wrong',
      });

      const result = await taskService.failSubtask('subtask-1', 'Something went wrong');

      expect(result.ok).toBe(true);
      expect(mockSubtasksRepo.update).toHaveBeenCalledWith('subtask-1', {
        status: 'failed',
        result: 'Something went wrong',
      });
    });
  });

  describe('getNextExecutableSubtasks', () => {
    it('returns only pending subtasks with completed dependencies', async () => {
      mockSubtasksRepo.listByTask.mockResolvedValue([
        { id: 'subtask-1', status: 'pending' },
        { id: 'subtask-2', status: 'in_progress' },
        { id: 'subtask-3', status: 'pending', parentSubtaskId: 'subtask-1' },
        { id: 'subtask-4', status: 'pending', parentSubtaskId: 'subtask-2' },
      ] as MockSubtask[]);

      const result = await taskService.getNextExecutableSubtasks('task-1');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('subtask-1');
    });

    it('returns all pending subtasks when no dependencies exist', async () => {
      mockSubtasksRepo.listByTask.mockResolvedValue([
        { id: 'subtask-1', status: 'pending' },
        { id: 'subtask-2', status: 'pending' },
        { id: 'subtask-3', status: 'completed' },
      ] as MockSubtask[]);

      const result = await taskService.getNextExecutableSubtasks('task-1');

      expect(result).toHaveLength(2);
    });

    it('returns empty array when no executable subtasks', async () => {
      mockSubtasksRepo.listByTask.mockResolvedValue([
        { id: 'subtask-1', status: 'completed' },
        { id: 'subtask-2', status: 'in_progress' },
      ] as MockSubtask[]);

      const result = await taskService.getNextExecutableSubtasks('task-1');

      expect(result).toHaveLength(0);
    });
  });
});
