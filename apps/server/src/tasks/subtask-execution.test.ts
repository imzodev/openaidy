/**
 * Subtask Execution Tests
 *
 * Tests for subtask execution with dependency handling.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TasksRepository, SubtasksRepository, Subtask } from '@openaidy/db';
import type { SessionMessageService } from '../sessions/service';
import { TaskService } from './service';

describe('Subtask Execution', () => {
  let taskService: TaskService;
  let mockTasksRepo: TasksRepository;
  let mockSubtasksRepo: SubtasksRepository;
  let mockSessionService: SessionMessageService;

  beforeEach(() => {
    mockSubtasksRepo = {
      findById: vi.fn(),
      listByTask: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
      updateStatus: vi.fn().mockResolvedValue({}),
      create: vi.fn(),
      delete: vi.fn(),
    } as any;
    mockTasksRepo = {
      findById: vi.fn(),
      list: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateStatus: vi.fn(),
      delete: vi.fn(),
      listByStatuses: vi.fn(),
    } as any;
    mockSessionService = {
      createSession: vi.fn().mockResolvedValue({ id: 'session-1' }),
      submitMessage: vi.fn().mockResolvedValue({}),
      deleteSession: vi.fn(),
    } as any;
    const mockTaskAgentsRepo = {
      create: vi.fn(),
      delete: vi.fn(),
      listByTask: vi.fn(),
    } as any;
    taskService = new TaskService({
      tasksRepo: mockTasksRepo,
      subtasksRepo: mockSubtasksRepo,
      taskAgentsRepo: mockTaskAgentsRepo,
      sessionService: mockSessionService,
    });
  });

  describe('executeSubtask', () => {
    it('executes subtask without dependencies', async () => {
      vi.mocked(mockSubtasksRepo.findById).mockResolvedValue({
        id: 'subtask-1',
        taskId: 'task-1',
        title: 'Test Subtask',
        description: 'Test description',
        status: 'pending',
        orderIndex: 0,
        createdAt: new Date(),
      } as Subtask);

      const result = await taskService.executeSubtask('subtask-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.sessionId).toBe('session-1');
      }
      expect(mockSubtasksRepo.updateStatus).toHaveBeenCalledWith('subtask-1', 'in_progress');
    });

    it('fails if parent subtask not completed', async () => {
      vi.mocked(mockSubtasksRepo.findById)
        .mockResolvedValueOnce({
          id: 'subtask-2',
          taskId: 'task-1',
          parentSubtaskId: 'subtask-1',
          title: 'Dependent Subtask',
          description: 'Test',
          status: 'pending',
          orderIndex: 1,
          createdAt: new Date(),
        } as Subtask)
        .mockResolvedValueOnce({
          id: 'subtask-1',
          taskId: 'task-1',
          status: 'in_progress',
          title: 'Parent',
          description: 'Test',
          orderIndex: 0,
          createdAt: new Date(),
        } as Subtask);

      const result = await taskService.executeSubtask('subtask-2');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('subtask.dependency_not_met');
      }
    });

    it('allows execution if parent is completed', async () => {
      vi.mocked(mockSubtasksRepo.findById)
        .mockResolvedValueOnce({
          id: 'subtask-2',
          taskId: 'task-1',
          parentSubtaskId: 'subtask-1',
          title: 'Dependent Subtask',
          description: 'Test description',
          status: 'pending',
          orderIndex: 1,
          createdAt: new Date(),
        } as Subtask)
        .mockResolvedValueOnce({
          id: 'subtask-1',
          taskId: 'task-1',
          status: 'completed',
          title: 'Parent',
          description: 'Test',
          orderIndex: 0,
          createdAt: new Date(),
        } as Subtask);

      const result = await taskService.executeSubtask('subtask-2');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.sessionId).toBe('session-1');
      }
    });

    it('fails if subtask not found', async () => {
      vi.mocked(mockSubtasksRepo.findById).mockResolvedValue(null);

      const result = await taskService.executeSubtask('nonexistent');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('subtask.not_found');
      }
    });
  });

  describe('executeSubtasks', () => {
    it('executes all subtasks without dependencies', async () => {
      vi.mocked(mockTasksRepo.findById).mockResolvedValue({
        id: 'task-1',
        title: 'Test Task',
        status: 'todo',
        priority: 'medium',
        workspaceId: 'ws-1',
        createdAt: new Date(),
      } as any);
      vi.mocked(mockSubtasksRepo.listByTask).mockResolvedValue([
        { id: 'subtask-1', status: 'pending', title: 'A', description: 'A', orderIndex: 0, taskId: 'task-1', createdAt: new Date() },
        { id: 'subtask-2', status: 'pending', title: 'B', description: 'B', orderIndex: 1, taskId: 'task-1', createdAt: new Date() },
      ] as Subtask[]);
      vi.mocked(mockSubtasksRepo.findById).mockResolvedValue({
        id: 'subtask-1',
        taskId: 'task-1',
        title: 'Test',
        description: 'Test',
        status: 'pending',
        orderIndex: 0,
        createdAt: new Date(),
      } as Subtask);

      const result = await taskService.executeSubtasks('task-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.startedCount).toBe(2);
      }
    });

    it('only executes subtasks with completed dependencies', async () => {
      vi.mocked(mockTasksRepo.findById).mockResolvedValue({
        id: 'task-1',
        title: 'Test Task',
        status: 'todo',
        priority: 'medium',
        workspaceId: 'ws-1',
        createdAt: new Date(),
      } as any);
      vi.mocked(mockSubtasksRepo.listByTask).mockResolvedValue([
        { id: 'subtask-1', status: 'pending', title: 'A', description: 'A', orderIndex: 0, taskId: 'task-1', createdAt: new Date() },
        { id: 'subtask-2', status: 'pending', title: 'B', description: 'B', orderIndex: 1, taskId: 'task-1', parentSubtaskId: 'subtask-1', createdAt: new Date() },
      ] as Subtask[]);
      vi.mocked(mockSubtasksRepo.findById).mockResolvedValue({
        id: 'subtask-1',
        taskId: 'task-1',
        title: 'Test',
        description: 'Test',
        status: 'pending',
        orderIndex: 0,
        createdAt: new Date(),
      } as Subtask);

      const result = await taskService.executeSubtasks('task-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.startedCount).toBe(1); // Only subtask-1
      }
    });
  });

  describe('completeSubtask', () => {
    it('updates subtask status and result', async () => {
      vi.mocked(mockSubtasksRepo.findById).mockResolvedValue({
        id: 'subtask-1',
        taskId: 'task-1',
        title: 'Test',
        description: 'Test',
        status: 'in_progress',
        orderIndex: 0,
        createdAt: new Date(),
      } as Subtask);
      vi.mocked(mockSubtasksRepo.update).mockResolvedValue({
        id: 'subtask-1',
        status: 'completed',
        result: 'Success result',
      } as Subtask);
      vi.mocked(mockSubtasksRepo.listByTask).mockResolvedValue([
        { id: 'subtask-1', status: 'completed', result: 'Success', taskId: 'task-1', title: 'A', description: 'A', orderIndex: 0, createdAt: new Date() },
      ] as Subtask[]);

      const result = await taskService.completeSubtask('subtask-1', 'Success result');

      expect(result.ok).toBe(true);
      expect(mockSubtasksRepo.update).toHaveBeenCalledWith('subtask-1', {
        status: 'completed',
        result: 'Success result',
      });
    });

    it('updates task to done when all subtasks complete', async () => {
      vi.mocked(mockSubtasksRepo.findById).mockResolvedValue({
        id: 'subtask-2',
        taskId: 'task-1',
        title: 'Test',
        description: 'Test',
        status: 'in_progress',
        orderIndex: 1,
        createdAt: new Date(),
      } as Subtask);
      vi.mocked(mockSubtasksRepo.update).mockResolvedValue({
        id: 'subtask-2',
        status: 'completed',
        result: 'Done',
      } as Subtask);
      vi.mocked(mockSubtasksRepo.listByTask).mockResolvedValue([
        { id: 'subtask-1', status: 'completed', taskId: 'task-1', title: 'A', description: 'A', orderIndex: 0, createdAt: new Date() },
        { id: 'subtask-2', status: 'completed', taskId: 'task-1', title: 'B', description: 'B', orderIndex: 1, createdAt: new Date() },
      ] as Subtask[]);

      await taskService.completeSubtask('subtask-2', 'Done');

      expect(mockTasksRepo.updateStatus).toHaveBeenCalledWith('task-1', 'done');
    });
  });

  describe('failSubtask', () => {
    it('updates subtask status to failed', async () => {
      vi.mocked(mockSubtasksRepo.findById).mockResolvedValue({
        id: 'subtask-1',
        taskId: 'task-1',
        title: 'Test',
        description: 'Test',
        status: 'in_progress',
        orderIndex: 0,
        createdAt: new Date(),
      } as Subtask);
      vi.mocked(mockSubtasksRepo.update).mockResolvedValue({
        id: 'subtask-1',
        status: 'failed',
        result: 'Error: Something went wrong',
      } as Subtask);

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
      vi.mocked(mockSubtasksRepo.listByTask).mockResolvedValue([
        { id: 'subtask-1', status: 'pending', taskId: 'task-1', title: 'A', description: 'A', orderIndex: 0, createdAt: new Date() },
        { id: 'subtask-2', status: 'in_progress', taskId: 'task-1', title: 'B', description: 'B', orderIndex: 1, createdAt: new Date() },
        { id: 'subtask-3', status: 'pending', taskId: 'task-1', parentSubtaskId: 'subtask-1', title: 'C', description: 'C', orderIndex: 2, createdAt: new Date() },
        { id: 'subtask-4', status: 'pending', taskId: 'task-1', parentSubtaskId: 'subtask-2', title: 'D', description: 'D', orderIndex: 3, createdAt: new Date() },
      ] as Subtask[]);

      const result = await taskService.getNextExecutableSubtasks('task-1');

      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe('subtask-1');
    });

    it('returns empty array when no executable subtasks', async () => {
      vi.mocked(mockSubtasksRepo.listByTask).mockResolvedValue([
        { id: 'subtask-1', status: 'in_progress', taskId: 'task-1', title: 'A', description: 'A', orderIndex: 0, createdAt: new Date() },
        { id: 'subtask-2', status: 'completed', taskId: 'task-1', title: 'B', description: 'B', orderIndex: 1, createdAt: new Date() },
      ] as Subtask[]);

      const result = await taskService.getNextExecutableSubtasks('task-1');

      expect(result).toHaveLength(0);
    });
  });
});
