/**
 * Subtask Execution Tests
 *
 * Tests for subtask execution, completion, and dependency handling.
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

  describe('executeSubtask', () => {
    it('executes subtask without dependencies', async () => {
      mockSubtasksRepo.findById.mockResolvedValue({
        id: 'subtask-1',
        title: 'Test Subtask',
        description: 'Test description',
        status: 'pending',
        taskId: 'task-1',
      });
      mockSubtasksRepo.listByTask.mockResolvedValue([
        {
          id: 'subtask-1',
          title: 'Test Subtask',
          status: 'pending',
          taskId: 'task-1',
        },
      ]);

      const result = await taskService.executeSubtask('subtask-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.sessionId).toBe('session-1');
      }
      expect(mockSubtasksRepo.updateStatus).toHaveBeenCalledWith(
        'subtask-1',
        'in_progress',
      );
      expect(mockSessionService.createSession).toHaveBeenCalled();
    });

    it('returns error if session service not configured', async () => {
      const serviceWithoutSession = new TaskService({
        tasksRepo: mockTasksRepo as unknown as TaskServiceOptions['tasksRepo'],
        subtasksRepo:
          mockSubtasksRepo as unknown as TaskServiceOptions['subtasksRepo'],
        taskAgentsRepo:
          mockTaskAgentsRepo as unknown as TaskServiceOptions['taskAgentsRepo'],
      });

      const result = await serviceWithoutSession.executeSubtask('subtask-1');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('session.not_configured');
      }
    });

    it('returns error if subtask not found', async () => {
      mockSubtasksRepo.findById.mockResolvedValue(null);

      const result = await taskService.executeSubtask('nonexistent');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('subtask.not_found');
      }
    });

    it('does not execute if a dependency is not completed', async () => {
      mockSubtasksRepo.findById.mockResolvedValue({
        id: 'subtask-2',
        status: 'pending',
        taskId: 'task-1',
      });
      mockSubtasksRepo.listByTask.mockResolvedValue([
        { id: 'subtask-1', status: 'in_progress', taskId: 'task-1' },
        { id: 'subtask-2', status: 'pending', taskId: 'task-1' },
      ]);
      mockSubtasksRepo.listEdgesByTask.mockResolvedValue([
        { subtaskId: 'subtask-2', dependsOnSubtaskId: 'subtask-1' },
      ]);

      const result = await taskService.executeSubtask('subtask-2');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('subtask.dependency_not_met');
      }
    });

    it('allows execution once its dependency is completed', async () => {
      mockSubtasksRepo.findById.mockResolvedValue({
        id: 'subtask-2',
        title: 'Child Subtask',
        description: 'Description',
        status: 'pending',
        taskId: 'task-1',
      });
      mockSubtasksRepo.listByTask.mockResolvedValue([
        {
          id: 'subtask-1',
          title: 'Parent Subtask',
          status: 'completed',
          result: 'Parent result',
          taskId: 'task-1',
        },
        {
          id: 'subtask-2',
          title: 'Child Subtask',
          status: 'pending',
          taskId: 'task-1',
        },
      ]);
      mockSubtasksRepo.listEdgesByTask.mockResolvedValue([
        { subtaskId: 'subtask-2', dependsOnSubtaskId: 'subtask-1' },
      ]);

      const result = await taskService.executeSubtask('subtask-2');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.sessionId).toBe('session-1');
      }
    });

    it('does not execute until ALL of multiple dependencies are completed (regression: previously only the first dependency was tracked)', async () => {
      mockSubtasksRepo.findById.mockResolvedValue({
        id: 'subtask-3',
        title: 'Merge',
        description: 'Combine A and B',
        status: 'pending',
        taskId: 'task-1',
      });
      mockSubtasksRepo.listByTask.mockResolvedValue([
        {
          id: 'subtask-1',
          title: 'A',
          status: 'completed',
          result: 'Result A',
          taskId: 'task-1',
        },
        { id: 'subtask-2', title: 'B', status: 'pending', taskId: 'task-1' },
        {
          id: 'subtask-3',
          title: 'Merge',
          status: 'pending',
          taskId: 'task-1',
        },
      ]);
      mockSubtasksRepo.listEdgesByTask.mockResolvedValue([
        { subtaskId: 'subtask-3', dependsOnSubtaskId: 'subtask-1' },
        { subtaskId: 'subtask-3', dependsOnSubtaskId: 'subtask-2' },
      ]);

      const result = await taskService.executeSubtask('subtask-3');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('subtask.dependency_not_met');
      }
    });

    it("includes only its actual dependencies' results in the handoff, bounded and excluding unrelated completed subtasks", async () => {
      mockSubtasksRepo.findById.mockResolvedValue({
        id: 'subtask-3',
        title: 'Merge',
        description: 'Combine A and B',
        status: 'pending',
        taskId: 'task-1',
      });
      mockSubtasksRepo.listByTask.mockResolvedValue([
        {
          id: 'subtask-1',
          title: 'A',
          status: 'completed',
          result: 'Result A',
          taskId: 'task-1',
        },
        {
          id: 'subtask-2',
          title: 'B',
          status: 'completed',
          result: 'Result B',
          taskId: 'task-1',
        },
        {
          id: 'subtask-unrelated',
          title: 'Unrelated',
          status: 'completed',
          result: 'Should not appear',
          taskId: 'task-1',
        },
        {
          id: 'subtask-3',
          title: 'Merge',
          status: 'pending',
          taskId: 'task-1',
        },
      ]);
      mockSubtasksRepo.listEdgesByTask.mockResolvedValue([
        { subtaskId: 'subtask-3', dependsOnSubtaskId: 'subtask-1' },
        { subtaskId: 'subtask-3', dependsOnSubtaskId: 'subtask-2' },
      ]);

      const result = await taskService.executeSubtask('subtask-3');

      expect(result.ok).toBe(true);
      const [messageInput] =
        mockSessionService.submitMessageStreaming.mock.calls[0]!;
      expect(messageInput.content).toContain('Result A');
      expect(messageInput.content).toContain('Result B');
      expect(messageInput.content).not.toContain('Should not appear');
    });

    it('honors a configured dependency-context limit instead of the hardcoded default', async () => {
      const configuredService = new TaskService({
        tasksRepo: mockTasksRepo as unknown as TaskServiceOptions['tasksRepo'],
        subtasksRepo:
          mockSubtasksRepo as unknown as TaskServiceOptions['subtasksRepo'],
        taskAgentsRepo:
          mockTaskAgentsRepo as unknown as TaskServiceOptions['taskAgentsRepo'],
        sessionService: mockSessionService as unknown as NonNullable<
          TaskServiceOptions['sessionService']
        >,
        getExecutionConfig: () => ({
          maxRetries: 5,
          depContextPerItemChars: 10,
          depContextTotalChars: 8000,
        }),
      });

      mockSubtasksRepo.findById.mockResolvedValue({
        id: 'subtask-2',
        title: 'Child Subtask',
        description: 'Description',
        status: 'pending',
        taskId: 'task-1',
      });
      mockSubtasksRepo.listByTask.mockResolvedValue([
        {
          id: 'subtask-1',
          title: 'Parent Subtask',
          status: 'completed',
          result: 'This result is much longer than ten characters',
          taskId: 'task-1',
        },
        {
          id: 'subtask-2',
          title: 'Child Subtask',
          status: 'pending',
          taskId: 'task-1',
        },
      ]);
      mockSubtasksRepo.listEdgesByTask.mockResolvedValue([
        { subtaskId: 'subtask-2', dependsOnSubtaskId: 'subtask-1' },
      ]);

      const result = await configuredService.executeSubtask('subtask-2');

      expect(result.ok).toBe(true);
      const [messageInput] =
        mockSessionService.submitMessageStreaming.mock.calls[0]!;
      expect(messageInput.content).not.toContain(
        'This result is much longer than ten characters',
      );
      expect(messageInput.content).toContain('This resul');
    });

    it('honors a configured total dependency-context limit, dropping later dependencies once the combined budget is spent', async () => {
      const configuredService = new TaskService({
        tasksRepo: mockTasksRepo as unknown as TaskServiceOptions['tasksRepo'],
        subtasksRepo:
          mockSubtasksRepo as unknown as TaskServiceOptions['subtasksRepo'],
        taskAgentsRepo:
          mockTaskAgentsRepo as unknown as TaskServiceOptions['taskAgentsRepo'],
        sessionService: mockSessionService as unknown as NonNullable<
          TaskServiceOptions['sessionService']
        >,
        getExecutionConfig: () => ({
          maxRetries: 5,
          depContextPerItemChars: 1000,
          depContextTotalChars: 10,
        }),
      });

      mockSubtasksRepo.findById.mockResolvedValue({
        id: 'subtask-3',
        title: 'Merge',
        description: 'Combine A and B',
        status: 'pending',
        taskId: 'task-1',
      });
      mockSubtasksRepo.listByTask.mockResolvedValue([
        {
          id: 'subtask-1',
          title: 'A',
          status: 'completed',
          result: 'AAAAAAAAAA',
          taskId: 'task-1',
        },
        {
          id: 'subtask-2',
          title: 'B',
          status: 'completed',
          result: 'BBBBBBBBBB',
          taskId: 'task-1',
        },
        {
          id: 'subtask-3',
          title: 'Merge',
          status: 'pending',
          taskId: 'task-1',
        },
      ]);
      mockSubtasksRepo.listEdgesByTask.mockResolvedValue([
        { subtaskId: 'subtask-3', dependsOnSubtaskId: 'subtask-1' },
        { subtaskId: 'subtask-3', dependsOnSubtaskId: 'subtask-2' },
      ]);

      const result = await configuredService.executeSubtask('subtask-3');

      expect(result.ok).toBe(true);
      const [messageInput] =
        mockSessionService.submitMessageStreaming.mock.calls[0]!;
      // The 10-char total budget is fully spent on the first dependency, so
      // the second is dropped entirely rather than truncated.
      expect(messageInput.content).toContain('AAAAAAAAAA');
      expect(messageInput.content).not.toContain('BBBBBBBBBB');
    });

    it('routes the loop-iteration "previous attempt" context through the configured per-item limit (regression for commit 7487d43)', async () => {
      const configuredService = new TaskService({
        tasksRepo: mockTasksRepo as unknown as TaskServiceOptions['tasksRepo'],
        subtasksRepo:
          mockSubtasksRepo as unknown as TaskServiceOptions['subtasksRepo'],
        taskAgentsRepo:
          mockTaskAgentsRepo as unknown as TaskServiceOptions['taskAgentsRepo'],
        sessionService: mockSessionService as unknown as NonNullable<
          TaskServiceOptions['sessionService']
        >,
        getExecutionConfig: () => ({
          maxRetries: 5,
          depContextPerItemChars: 10,
          depContextTotalChars: 8000,
        }),
      });

      mockSubtasksRepo.findById.mockResolvedValue({
        id: 'subtask-loop',
        title: 'Loop Subtask',
        description: 'Refine the draft',
        status: 'pending',
        taskId: 'task-1',
        loopMaxIterations: 5,
        loopIterationCount: 1,
        loopLastResult:
          'This previous result is much longer than ten characters',
        loopConditionOperator: 'contains',
        loopConditionValue: 'done',
      });
      mockSubtasksRepo.listByTask.mockResolvedValue([
        {
          id: 'subtask-loop',
          title: 'Loop Subtask',
          status: 'pending',
          taskId: 'task-1',
        },
      ]);
      mockSubtasksRepo.listEdgesByTask.mockResolvedValue([]);

      const result = await configuredService.executeSubtask('subtask-loop');

      expect(result.ok).toBe(true);
      const [messageInput] =
        mockSessionService.submitMessageStreaming.mock.calls[0]!;
      expect(messageInput.content).not.toContain(
        'This previous result is much longer than ten characters',
      );
      expect(messageInput.content).toContain('This previ');
      expect(messageInput.content).toContain('iteration 2 of 5');
    });
  });

  describe('executeSubtasks', () => {
    it('executes all subtasks without dependencies', async () => {
      mockTasksRepo.findById.mockResolvedValue({ id: 'task-1' });
      mockSubtasksRepo.listByTask.mockResolvedValue([
        {
          id: 'subtask-1',
          status: 'pending',
          title: 'Subtask 1',
          description: 'Desc 1',
          taskId: 'task-1',
        },
        {
          id: 'subtask-2',
          status: 'pending',
          title: 'Subtask 2',
          description: 'Desc 2',
          taskId: 'task-1',
        },
      ]);
      // Mock findById for executeSubtask calls
      mockSubtasksRepo.findById
        .mockResolvedValueOnce({
          id: 'subtask-1',
          status: 'pending',
          title: 'Subtask 1',
          description: 'Desc 1',
          taskId: 'task-1',
        })
        .mockResolvedValueOnce({
          id: 'subtask-2',
          status: 'pending',
          title: 'Subtask 2',
          description: 'Desc 2',
          taskId: 'task-1',
        });

      const result = await taskService.executeSubtasks('task-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.startedCount).toBe(2);
      }
    });

    it('only executes subtasks with completed dependencies', async () => {
      mockTasksRepo.findById.mockResolvedValue({ id: 'task-1' });
      mockSubtasksRepo.listByTask.mockResolvedValue([
        {
          id: 'subtask-1',
          status: 'pending',
          title: 'Subtask 1',
          description: 'Desc 1',
          taskId: 'task-1',
        },
        {
          id: 'subtask-2',
          status: 'pending',
          title: 'Subtask 2',
          description: 'Desc 2',
          taskId: 'task-1',
        },
      ]);
      mockSubtasksRepo.listEdgesByTask.mockResolvedValue([
        { subtaskId: 'subtask-2', dependsOnSubtaskId: 'subtask-1' },
      ]);
      // Mock findById for executeSubtask call
      mockSubtasksRepo.findById.mockResolvedValue({
        id: 'subtask-1',
        status: 'pending',
        title: 'Subtask 1',
        description: 'Desc 1',
        taskId: 'task-1',
      });

      const result = await taskService.executeSubtasks('task-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Only subtask-1 has no dependencies
        expect(result.data.startedCount).toBe(1);
      }
    });

    it('does not execute a subtask until ALL of its multiple dependencies are completed (regression)', async () => {
      mockTasksRepo.findById.mockResolvedValue({ id: 'task-1' });
      mockSubtasksRepo.listByTask.mockResolvedValue([
        {
          id: 'subtask-1',
          status: 'completed',
          title: 'A',
          description: 'Desc A',
          result: 'Result A',
          taskId: 'task-1',
        },
        {
          id: 'subtask-2',
          status: 'pending',
          title: 'B',
          description: 'Desc B',
          taskId: 'task-1',
        },
        {
          id: 'subtask-3',
          status: 'pending',
          title: 'Merge',
          description: 'Desc Merge',
          taskId: 'task-1',
        },
      ]);
      mockSubtasksRepo.listEdgesByTask.mockResolvedValue([
        { subtaskId: 'subtask-3', dependsOnSubtaskId: 'subtask-1' },
        { subtaskId: 'subtask-3', dependsOnSubtaskId: 'subtask-2' },
      ]);
      mockSubtasksRepo.findById.mockResolvedValue({
        id: 'subtask-2',
        status: 'pending',
        title: 'B',
        description: 'Desc B',
        taskId: 'task-1',
      });

      const result = await taskService.executeSubtasks('task-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Only subtask-2 is executable; subtask-3 still waits on subtask-2.
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

    it('returns startedCount 0 if no pending subtasks', async () => {
      mockTasksRepo.findById.mockResolvedValue({ id: 'task-1' });
      mockSubtasksRepo.listByTask.mockResolvedValue([
        {
          id: 'subtask-1',
          status: 'completed',
          title: 'Subtask 1',
          description: 'Desc 1',
          taskId: 'task-1',
        },
        {
          id: 'subtask-2',
          status: 'in_progress',
          title: 'Subtask 2',
          description: 'Desc 2',
          taskId: 'task-1',
        },
      ]);

      const result = await taskService.executeSubtasks('task-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.startedCount).toBe(0);
      }
    });
  });

  describe('completeSubtask', () => {
    it('updates subtask status and result', async () => {
      mockSubtasksRepo.findById.mockResolvedValue({
        id: 'subtask-1',
        taskId: 'task-1',
      });
      mockSubtasksRepo.completeSubtask.mockResolvedValue({
        id: 'subtask-1',
        status: 'completed',
        result: 'Success result',
      });
      mockSubtasksRepo.listByTask.mockResolvedValue([
        { id: 'subtask-1', status: 'completed' },
      ]);

      const result = await taskService.completeSubtask(
        'subtask-1',
        'Success result',
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.status).toBe('completed');
        expect(result.data.result).toBe('Success result');
      }
    });

    it('updates task to done when all subtasks complete', async () => {
      mockSubtasksRepo.findById.mockResolvedValue({
        id: 'subtask-2',
        taskId: 'task-1',
      });
      mockSubtasksRepo.completeSubtask.mockResolvedValue({
        id: 'subtask-2',
        status: 'completed',
        result: 'Done',
      });
      mockSubtasksRepo.listByTask.mockResolvedValue([
        { id: 'subtask-1', status: 'completed' },
        { id: 'subtask-2', status: 'completed' },
      ]);

      await taskService.completeSubtask('subtask-2', 'Done');

      expect(mockTasksRepo.updateStatus).toHaveBeenCalledWith(
        'task-1',
        'review',
      );
    });

    it('does not update task if subtasks remain incomplete', async () => {
      mockSubtasksRepo.findById.mockResolvedValue({
        id: 'subtask-1',
        taskId: 'task-1',
      });
      mockSubtasksRepo.completeSubtask.mockResolvedValue({
        id: 'subtask-1',
        status: 'completed',
        result: 'Partial result',
      });
      mockSubtasksRepo.listByTask.mockResolvedValue([
        { id: 'subtask-1', status: 'completed' },
        { id: 'subtask-2', status: 'pending' },
      ]);

      await taskService.completeSubtask('subtask-1', 'Partial result');

      expect(mockTasksRepo.updateStatus).not.toHaveBeenCalled();
    });

    it('returns error if subtask not found', async () => {
      mockSubtasksRepo.findById.mockResolvedValue(null);

      const result = await taskService.completeSubtask('nonexistent', 'Result');

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
      });
      mockSubtasksRepo.failSubtask.mockResolvedValue({
        id: 'subtask-1',
        status: 'failed',
        result: 'Error: Something went wrong',
      });

      const result = await taskService.failSubtask(
        'subtask-1',
        'Error: Something went wrong',
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.status).toBe('failed');
        expect(result.data.result).toBe('Error: Something went wrong');
      }
    });

    it('returns error if subtask not found', async () => {
      mockSubtasksRepo.findById.mockResolvedValue(null);

      const result = await taskService.failSubtask('nonexistent', 'Error');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('subtask.not_found');
      }
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

  describe('conditional edges', () => {
    it('routes to the matching branch when the condition is met', async () => {
      mockSubtasksRepo.findById.mockResolvedValue({
        id: 'subtask-2',
        title: 'Only if approved',
        description: 'desc',
        status: 'pending',
        taskId: 'task-1',
      });
      mockSubtasksRepo.listByTask.mockResolvedValue([
        {
          id: 'subtask-1',
          status: 'completed',
          result: 'OUTCOME: approved',
          taskId: 'task-1',
        },
        { id: 'subtask-2', status: 'pending', taskId: 'task-1' },
      ]);
      mockSubtasksRepo.listEdgesByTask.mockResolvedValue([
        {
          subtaskId: 'subtask-2',
          dependsOnSubtaskId: 'subtask-1',
          edgeKind: 'conditional',
          conditionOperator: 'equals',
          conditionValue: 'approved',
        },
      ]);

      const result = await taskService.executeSubtask('subtask-2');
      expect(result.ok).toBe(true);
    });

    it('does not route to the non-matching branch', async () => {
      mockSubtasksRepo.findById.mockResolvedValue({
        id: 'subtask-2',
        title: 'Only if approved',
        description: 'desc',
        status: 'pending',
        taskId: 'task-1',
      });
      mockSubtasksRepo.listByTask.mockResolvedValue([
        {
          id: 'subtask-1',
          status: 'completed',
          result: 'OUTCOME: rejected',
          taskId: 'task-1',
        },
        { id: 'subtask-2', status: 'pending', taskId: 'task-1' },
      ]);
      mockSubtasksRepo.listEdgesByTask.mockResolvedValue([
        {
          subtaskId: 'subtask-2',
          dependsOnSubtaskId: 'subtask-1',
          edgeKind: 'conditional',
          conditionOperator: 'equals',
          conditionValue: 'approved',
        },
      ]);

      const result = await taskService.executeSubtask('subtask-2');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('subtask.dependency_not_met');
      }
    });
  });

  describe('approval gate subtasks', () => {
    it('pauses instead of creating a session or submitting a message', async () => {
      mockSubtasksRepo.findById.mockResolvedValue({
        id: 'subtask-approve',
        title: 'Approve deploy',
        description: 'desc',
        status: 'pending',
        subtaskKind: 'approval_gate',
        taskId: 'task-1',
      });
      mockSubtasksRepo.listByTask.mockResolvedValue([
        {
          id: 'subtask-approve',
          status: 'pending',
          subtaskKind: 'approval_gate',
          taskId: 'task-1',
        },
      ]);

      const result = await taskService.executeSubtask('subtask-approve');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.sessionId).toBeNull();
      }
      expect(mockSubtasksRepo.setAwaitingApproval).toHaveBeenCalledWith(
        'subtask-approve',
        true,
      );
      expect(mockSessionService.createSession).not.toHaveBeenCalled();
      expect(mockSessionService.submitMessageStreaming).not.toHaveBeenCalled();
    });
  });

  describe('resolveApproval', () => {
    it('completes the subtask on approval', async () => {
      mockSubtasksRepo.findById.mockResolvedValue({
        id: 'subtask-approve',
        taskId: 'task-1',
        subtaskKind: 'approval_gate',
        awaitingApprovalSince: new Date(),
      });
      mockSubtasksRepo.completeSubtask.mockResolvedValue({
        id: 'subtask-approve',
        status: 'completed',
      });
      mockSubtasksRepo.listByTask.mockResolvedValue([
        { id: 'subtask-approve', status: 'completed' },
      ]);

      const result = await taskService.resolveApproval(
        'subtask-approve',
        'approved',
        'looks good',
      );

      expect(result.ok).toBe(true);
      expect(mockSubtasksRepo.resolveApproval).toHaveBeenCalledWith(
        'subtask-approve',
        { decision: 'approved', note: 'looks good', approvedBy: null },
      );
      expect(mockSubtasksRepo.completeSubtask).toHaveBeenCalled();
    });

    it('fails the subtask on rejection, leaving dependents ineligible', async () => {
      mockSubtasksRepo.findById.mockResolvedValue({
        id: 'subtask-approve',
        taskId: 'task-1',
        subtaskKind: 'approval_gate',
        awaitingApprovalSince: new Date(),
      });
      mockSubtasksRepo.failSubtask.mockResolvedValue({
        id: 'subtask-approve',
        status: 'failed',
      });

      const result = await taskService.resolveApproval(
        'subtask-approve',
        'rejected',
        'not ready',
      );

      expect(result.ok).toBe(true);
      expect(mockSubtasksRepo.failSubtask).toHaveBeenCalledWith(
        'subtask-approve',
        'OUTCOME: rejected\n\nnot ready',
      );
    });

    it('errors when the subtask is not an approval gate', async () => {
      mockSubtasksRepo.findById.mockResolvedValue({
        id: 'subtask-1',
        taskId: 'task-1',
        subtaskKind: 'agent',
      });

      const result = await taskService.resolveApproval('subtask-1', 'approved');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('subtask.not_approval_gate');
      }
    });

    it('errors when the subtask is not currently awaiting approval', async () => {
      mockSubtasksRepo.findById.mockResolvedValue({
        id: 'subtask-approve',
        taskId: 'task-1',
        subtaskKind: 'approval_gate',
        awaitingApprovalSince: null,
      });
      // The repo enforces "still awaiting approval" atomically in its
      // UPDATE's WHERE clause and returns null when the row doesn't
      // match (see SubtasksRepository.resolveApproval).
      mockSubtasksRepo.resolveApproval.mockResolvedValue(null);

      const result = await taskService.resolveApproval(
        'subtask-approve',
        'approved',
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('subtask.not_awaiting_approval');
      }
    });
  });

  describe('bounded loops', () => {
    it('re-runs the subtask when the loop condition is not yet met', async () => {
      mockSubtasksRepo.findById
        .mockResolvedValueOnce({
          id: 'subtask-loop',
          taskId: 'task-1',
          loopMaxIterations: 3,
          loopConditionOperator: 'contains',
          loopConditionValue: 'approved',
          loopIterationCount: 0,
        })
        .mockResolvedValueOnce({
          id: 'subtask-loop',
          taskId: 'task-1',
          status: 'pending',
          loopMaxIterations: 3,
          loopIterationCount: 1,
        });
      mockSubtasksRepo.listByTask.mockResolvedValue([
        { id: 'subtask-loop', status: 'pending', taskId: 'task-1' },
      ]);

      const result = await taskService.completeSubtask(
        'subtask-loop',
        'OUTCOME: needs-work',
      );

      expect(result.ok).toBe(true);
      expect(mockSubtasksRepo.recordLoopIteration).toHaveBeenCalledWith(
        'subtask-loop',
        { result: 'OUTCOME: needs-work' },
      );
      expect(mockSubtasksRepo.completeSubtask).not.toHaveBeenCalled();
    });

    it('fails the subtask once iterations are exhausted without convergence', async () => {
      mockSubtasksRepo.findById.mockResolvedValue({
        id: 'subtask-loop',
        taskId: 'task-1',
        loopMaxIterations: 3,
        loopConditionOperator: 'contains',
        loopConditionValue: 'approved',
        loopIterationCount: 2,
      });
      mockSubtasksRepo.failSubtask.mockResolvedValue({
        id: 'subtask-loop',
        status: 'failed',
      });

      const result = await taskService.completeSubtask(
        'subtask-loop',
        'OUTCOME: needs-work',
      );

      expect(result.ok).toBe(true);
      expect(mockSubtasksRepo.failSubtask).toHaveBeenCalled();
      expect(mockSubtasksRepo.recordLoopIteration).not.toHaveBeenCalled();
    });

    it('completes normally once the loop condition converges', async () => {
      mockSubtasksRepo.findById.mockResolvedValue({
        id: 'subtask-loop',
        taskId: 'task-1',
        loopMaxIterations: 3,
        loopConditionOperator: 'contains',
        loopConditionValue: 'approved',
        loopIterationCount: 1,
      });
      mockSubtasksRepo.completeSubtask.mockResolvedValue({
        id: 'subtask-loop',
        status: 'completed',
        result: 'OUTCOME: approved',
      });
      mockSubtasksRepo.listByTask.mockResolvedValue([
        { id: 'subtask-loop', status: 'completed', taskId: 'task-1' },
      ]);

      const result = await taskService.completeSubtask(
        'subtask-loop',
        'OUTCOME: approved',
      );

      expect(result.ok).toBe(true);
      expect(mockSubtasksRepo.completeSubtask).toHaveBeenCalled();
      expect(mockSubtasksRepo.recordLoopIteration).not.toHaveBeenCalled();
    });
  });

  describe('checkStuckSubtasks', () => {
    it('skips subtasks that are awaiting approval', async () => {
      mockSubtasksRepo.listAll.mockResolvedValue([
        {
          id: 'subtask-approve',
          status: 'in_progress',
          awaitingApprovalSince: new Date(Date.now() - 10 * 60 * 1000),
          updatedAt: new Date(Date.now() - 10 * 60 * 1000),
          retryCount: 0,
        },
      ]);

      await taskService.checkStuckSubtasks();

      expect(mockSubtasksRepo.updateStatus).not.toHaveBeenCalled();
      expect(mockSubtasksRepo.incrementRetryCount).not.toHaveBeenCalled();
    });

    it('retries a stuck subtask under the default max-retries limit', async () => {
      mockSubtasksRepo.listAll.mockResolvedValue([
        {
          id: 'subtask-stuck',
          status: 'in_progress',
          updatedAt: new Date(Date.now() - 10 * 60 * 1000),
          retryCount: 2,
        },
      ]);

      await taskService.checkStuckSubtasks();

      // Default maxRetries is 5, so retryCount 2 is still under the limit.
      expect(mockSubtasksRepo.incrementRetryCount).toHaveBeenCalledWith(
        'subtask-stuck',
      );
      expect(mockSubtasksRepo.updateStatus).not.toHaveBeenCalledWith(
        'subtask-stuck',
        'failed',
      );
    });

    it('honors a configured max-retries limit instead of the hardcoded default', async () => {
      const configuredService = new TaskService({
        tasksRepo: mockTasksRepo as unknown as TaskServiceOptions['tasksRepo'],
        subtasksRepo:
          mockSubtasksRepo as unknown as TaskServiceOptions['subtasksRepo'],
        taskAgentsRepo:
          mockTaskAgentsRepo as unknown as TaskServiceOptions['taskAgentsRepo'],
        sessionService: mockSessionService as unknown as NonNullable<
          TaskServiceOptions['sessionService']
        >,
        getExecutionConfig: () => ({
          maxRetries: 2,
          depContextPerItemChars: 2000,
          depContextTotalChars: 8000,
        }),
      });

      mockSubtasksRepo.listAll.mockResolvedValue([
        {
          id: 'subtask-stuck',
          status: 'in_progress',
          updatedAt: new Date(Date.now() - 10 * 60 * 1000),
          retryCount: 2,
        },
      ]);

      await configuredService.checkStuckSubtasks();

      // retryCount 2 meets the configured limit of 2 (vs the hardcoded
      // default of 5), so this should fail instead of retrying.
      expect(mockSubtasksRepo.updateStatus).toHaveBeenCalledWith(
        'subtask-stuck',
        'failed',
      );
      expect(mockSubtasksRepo.incrementRetryCount).not.toHaveBeenCalled();
    });
  });

  describe('triggerSubtaskRetry', () => {
    it('sends the generic retry message when no reason is given', async () => {
      mockSubtasksRepo.findById.mockResolvedValue({
        id: 'subtask-1',
        sessionId: 'session-1',
        assignedAgentId: 'agent-1',
      });

      const result = await taskService.triggerSubtaskRetry('subtask-1');

      expect(result.ok).toBe(true);
      const [messageInput] =
        mockSessionService.submitMessageStreaming.mock.calls[0]!;
      expect(messageInput.content).toBe(
        'Please continue and complete this subtask. Focus on delivering the actual output requested. Do not ask what to do — execute the task directly.',
      );
    });

    it('includes the verification reason in the retry message when given', async () => {
      mockSubtasksRepo.findById.mockResolvedValue({
        id: 'subtask-1',
        sessionId: 'session-1',
        assignedAgentId: 'agent-1',
      });

      const result = await taskService.triggerSubtaskRetry(
        'subtask-1',
        'The headline claimed in the response does not appear anywhere in the actual tool results.',
      );

      expect(result.ok).toBe(true);
      const [messageInput] =
        mockSessionService.submitMessageStreaming.mock.calls[0]!;
      expect(messageInput.content).toContain(
        'The headline claimed in the response does not appear anywhere in the actual tool results.',
      );
      expect(messageInput.content).toContain('marked incomplete');
    });

    it('truncates an excessively long reason instead of forwarding it verbatim', async () => {
      mockSubtasksRepo.findById.mockResolvedValue({
        id: 'subtask-1',
        sessionId: 'session-1',
        assignedAgentId: 'agent-1',
      });
      const longReason = 'x'.repeat(5000);

      await taskService.triggerSubtaskRetry('subtask-1', longReason);

      const [messageInput] =
        mockSessionService.submitMessageStreaming.mock.calls[0]!;
      // Pin the exact bound (not just "shorter than input") so shrinking the
      // cap, or dropping the slice entirely, fails this test. Extract the
      // embedded reason rather than counting 'x' across the whole message,
      // since the fixed wording around it ("execute") also contains an x.
      const match = messageInput.content.match(
        /missing:\n\n([\s\S]*?)\n\nAddress this directly/,
      );
      expect(match).not.toBeNull();
      expect(match![1]).toBe(
        `${'x'.repeat(1500)}\n\n[…reason truncated at 1500 chars…]`,
      );
    });
  });
});
