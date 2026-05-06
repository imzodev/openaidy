/**
 * Task Service Session Integration Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskService, type TaskServiceOptions } from './service';

// Mock types
type MockTask = {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  planningEnabled: boolean;
  sessionId?: string | null;
};

type MockSubtask = {
  id: string;
  taskId: string;
  title: string;
  description: string;
  status: string;
  sessionId?: string | null;
};

describe('TaskService Session Integration', () => {
  let taskService: TaskService;
  let mockSessionService: {
    createSession: ReturnType<typeof vi.fn>;
    submitMessageStreaming: ReturnType<typeof vi.fn>;
    getSession: ReturnType<typeof vi.fn>;
  };
  let mockTasksRepo: {
    findById: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    list: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    updateStatus: ReturnType<typeof vi.fn>;
    updatePlanningStatus: ReturnType<typeof vi.fn>;
  };
  let mockSubtasksRepo: {
    findById: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateStatus: ReturnType<typeof vi.fn>;
    listByTask: ReturnType<typeof vi.fn>;
    getCountsByStatus: ReturnType<typeof vi.fn>;
    assignAgent: ReturnType<typeof vi.fn>;
    setResult: ReturnType<typeof vi.fn>;
  };
  let mockTaskAgentsRepo: {
    listByTask: ReturnType<typeof vi.fn>;
    assignMultiple: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockSessionService = {
      createSession: vi.fn().mockResolvedValue({ id: 'session-1' }),
      submitMessageStreaming: vi.fn().mockResolvedValue({ ok: true }),
      getSession: vi.fn().mockResolvedValue({ id: 'session-1' }),
    };

    mockTasksRepo = {
      findById: vi.fn().mockResolvedValue({
        id: 'task-1',
        title: 'Test Task',
        description: 'Test description',
        status: 'todo',
        priority: 'medium',
        planningEnabled: false,
        sessionId: null,
      } as MockTask),
      create: vi.fn().mockResolvedValue({
        id: 'task-1',
        title: 'Test Task',
        description: 'Test description',
      }),
      update: vi.fn().mockResolvedValue({}),
      list: vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockResolvedValue({}),
      updateStatus: vi.fn().mockResolvedValue({}),
      updatePlanningStatus: vi.fn().mockResolvedValue({}),
    };

    mockSubtasksRepo = {
      findById: vi.fn().mockResolvedValue({
        id: 'subtask-1',
        taskId: 'task-1',
        title: 'Subtask',
        description: 'Subtask description',
        status: 'pending',
        sessionId: null,
      } as MockSubtask),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      updateStatus: vi.fn().mockResolvedValue({}),
      listByTask: vi.fn().mockResolvedValue([]),
      getCountsByStatus: vi.fn().mockResolvedValue({
        pending: 0,
        assigned: 0,
        in_progress: 0,
        completed: 0,
        failed: 0,
      }),
      assignAgent: vi.fn().mockResolvedValue({}),
      setResult: vi.fn().mockResolvedValue({}),
    };

    mockTaskAgentsRepo = {
      listByTask: vi.fn().mockResolvedValue([]),
      assignMultiple: vi.fn().mockResolvedValue([]),
      remove: vi.fn().mockResolvedValue({}),
    };

    const options: TaskServiceOptions = {
      tasksRepo: mockTasksRepo as unknown as TaskServiceOptions['tasksRepo'],
      subtasksRepo:
        mockSubtasksRepo as unknown as TaskServiceOptions['subtasksRepo'],
      taskAgentsRepo:
        mockTaskAgentsRepo as unknown as TaskServiceOptions['taskAgentsRepo'],
      sessionService: mockSessionService as unknown as NonNullable<
        TaskServiceOptions['sessionService']
      >,
    };

    taskService = new TaskService(options);
  });

  describe('executeTask', () => {
    it('creates session and links to task', async () => {
      const result = await taskService.executeTask('task-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.sessionId).toBe('session-1');
      }
      expect(mockSessionService.createSession).toHaveBeenCalledWith(
        'Task: Test Task',
      );
      expect(mockTasksRepo.update).toHaveBeenCalledWith('task-1', {
        sessionId: 'session-1',
      });
    });

    it('submits task description as initial message', async () => {
      await taskService.executeTask('task-1');

      expect(mockSessionService.submitMessageStreaming).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'session-1',
          content: 'Test description',
          role: 'user',
        }),
      );
    });

    it('updates task status to in_progress', async () => {
      await taskService.executeTask('task-1');

      expect(mockTasksRepo.updateStatus).toHaveBeenCalledWith(
        'task-1',
        'in_progress',
      );
    });

    it('moves task to review after successful execution when no subtasks exist', async () => {
      mockSubtasksRepo.listByTask.mockResolvedValueOnce([]);

      await taskService.executeTask('task-1');

      expect(mockTasksRepo.updateStatus).toHaveBeenCalledWith(
        'task-1',
        'review',
      );
    });

    it('keeps task in progress after execution when subtasks exist', async () => {
      mockSubtasksRepo.listByTask.mockResolvedValueOnce([
        {
          id: 'subtask-1',
          taskId: 'task-1',
          title: 'Subtask',
          description: 'Subtask description',
          status: 'pending',
          sessionId: null,
        } as MockSubtask,
      ]);

      await taskService.executeTask('task-1');

      expect(mockTasksRepo.updateStatus).not.toHaveBeenCalledWith(
        'task-1',
        'review',
      );
    });

    it('throws if task not found', async () => {
      mockTasksRepo.findById.mockResolvedValueOnce(null);

      const result = await taskService.executeTask('nonexistent');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('task.not_found');
        expect(result.error.message).toContain('nonexistent');
      }
    });

    it('returns error if session service not configured', async () => {
      const noSessionService = new TaskService({
        tasksRepo: mockTasksRepo as unknown as TaskServiceOptions['tasksRepo'],
        subtasksRepo:
          mockSubtasksRepo as unknown as TaskServiceOptions['subtasksRepo'],
        taskAgentsRepo:
          mockTaskAgentsRepo as unknown as TaskServiceOptions['taskAgentsRepo'],
      });

      const result = await noSessionService.executeTask('task-1');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('session.not_configured');
      }
    });
  });

  describe('executeSubtask', () => {
    it('creates session and links to subtask', async () => {
      const result = await taskService.executeSubtask('subtask-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.sessionId).toBe('session-1');
      }
      expect(mockSessionService.createSession).toHaveBeenCalledWith(
        'Subtask: Subtask',
      );
      expect(mockSubtasksRepo.update).toHaveBeenCalledWith('subtask-1', {
        sessionId: 'session-1',
      });
    });

    it('updates subtask status to in_progress', async () => {
      await taskService.executeSubtask('subtask-1');

      expect(mockSubtasksRepo.updateStatus).toHaveBeenCalledWith(
        'subtask-1',
        'in_progress',
      );
    });

    it('submits subtask description as initial message', async () => {
      await taskService.executeSubtask('subtask-1');

      expect(mockSessionService.submitMessageStreaming).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'session-1',
          content: 'Subtask description',
          role: 'user',
        }),
      );
    });

    it('throws if subtask not found', async () => {
      mockSubtasksRepo.findById.mockResolvedValueOnce(null);

      const result = await taskService.executeSubtask('nonexistent');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('subtask.not_found');
      }
    });
  });

  describe('getTaskSession', () => {
    it('returns session ID if linked', async () => {
      mockTasksRepo.findById.mockResolvedValueOnce({
        id: 'task-1',
        sessionId: 'session-1',
      } as MockTask);

      const result = await taskService.getTaskSession('task-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.sessionId).toBe('session-1');
      }
    });

    it('returns null if no session linked', async () => {
      mockTasksRepo.findById.mockResolvedValueOnce({
        id: 'task-1',
        sessionId: null,
      } as MockTask);

      const result = await taskService.getTaskSession('task-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.sessionId).toBeNull();
      }
    });

    it('returns error if task not found', async () => {
      mockTasksRepo.findById.mockResolvedValueOnce(null);

      const result = await taskService.getTaskSession('nonexistent');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('task.not_found');
      }
    });
  });

  describe('getSubtaskSession', () => {
    it('returns session ID if linked', async () => {
      mockSubtasksRepo.findById.mockResolvedValueOnce({
        id: 'subtask-1',
        sessionId: 'session-1',
      } as MockSubtask);

      const result = await taskService.getSubtaskSession('subtask-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.sessionId).toBe('session-1');
      }
    });

    it('returns null if no session linked', async () => {
      mockSubtasksRepo.findById.mockResolvedValueOnce({
        id: 'subtask-1',
        sessionId: null,
      } as MockSubtask);

      const result = await taskService.getSubtaskSession('subtask-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.sessionId).toBeNull();
      }
    });
  });
});
