import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TaskService, createTaskService } from './service';
import type { Task, Subtask, TaskAgent } from '@openaidy/db';
import type { PlanningService } from '../planning/service';

// Mock repository types - use interface-like types for mocking
interface MockTasksRepository {
  create: ReturnType<typeof vi.fn>;
  findById: ReturnType<typeof vi.fn>;
  list: ReturnType<typeof vi.fn>;
  listByStatuses: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  updateStatus: ReturnType<typeof vi.fn>;
  updatePlanningStatus: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
}

interface MockSubtasksRepository {
  create: ReturnType<typeof vi.fn>;
  findById: ReturnType<typeof vi.fn>;
  listByTask: ReturnType<typeof vi.fn>;
  listByStatus: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  updateStatus: ReturnType<typeof vi.fn>;
  assignAgent: ReturnType<typeof vi.fn>;
  setResult: ReturnType<typeof vi.fn>;
  getCountsByStatus: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
}

interface MockTaskAgentsRepository {
  assign: ReturnType<typeof vi.fn>;
  assignMultiple: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  listByTask: ReturnType<typeof vi.fn>;
}

interface MockAgentRegistry {
  getAgent: ReturnType<typeof vi.fn>;
}

// Mock factory functions
const createMockTasksRepo = (): MockTasksRepository => ({
  create: vi.fn(),
  findById: vi.fn(),
  list: vi.fn(),
  listByStatuses: vi.fn(),
  update: vi.fn(),
  updateStatus: vi.fn(),
  updatePlanningStatus: vi.fn(),
  delete: vi.fn(),
});

const createMockSubtasksRepo = (): MockSubtasksRepository => ({
  create: vi.fn(),
  findById: vi.fn(),
  listByTask: vi.fn(),
  listByStatus: vi.fn(),
  update: vi.fn(),
  updateStatus: vi.fn(),
  assignAgent: vi.fn(),
  setResult: vi.fn(),
  getCountsByStatus: vi.fn(),
  delete: vi.fn(),
});

const createMockTaskAgentsRepo = (): MockTaskAgentsRepository => ({
  assign: vi.fn(),
  assignMultiple: vi.fn(),
  remove: vi.fn(),
  listByTask: vi.fn(),
});

const createMockAgentRegistry = (): MockAgentRegistry => ({
  getAgent: vi.fn(),
});

describe('TaskService', () => {
  let service: TaskService;
  let tasksRepo: ReturnType<typeof createMockTasksRepo>;
  let subtasksRepo: ReturnType<typeof createMockSubtasksRepo>;
  let taskAgentsRepo: ReturnType<typeof createMockTaskAgentsRepo>;
  let agentRegistry: ReturnType<typeof createMockAgentRegistry>;

  const mockTask: Task = {
    id: 'task1',
    title: 'Test Task',
    description: 'Test description',
    status: 'backlog',
    priority: 'medium',
    planningEnabled: false,
    planningStatus: null,
    sessionId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockSubtask: Subtask = {
    id: 'subtask1',
    taskId: 'task1',
    parentSubtaskId: null as unknown,
    title: 'Test Subtask',
    description: 'Subtask description',
    status: 'pending',
    assignedAgentId: undefined as unknown,
    sessionId: null,
    orderIndex: 0,
    result: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    retryCount: 0,
    pendingVerificationResult: null,
  } as unknown as Subtask;

  const mockTaskAgent: TaskAgent = {
    taskId: 'task1',
    agentId: 'agent1',
    role: 'primary',
    assignedAt: new Date(),
  };

  beforeEach(() => {
    tasksRepo = createMockTasksRepo();
    subtasksRepo = createMockSubtasksRepo();
    taskAgentsRepo = createMockTaskAgentsRepo();
    agentRegistry = createMockAgentRegistry();

    service = createTaskService({
      tasksRepo: tasksRepo as unknown as import('@openaidy/db').TasksRepository,
      subtasksRepo:
        subtasksRepo as unknown as import('@openaidy/db').SubtasksRepository,
      taskAgentsRepo:
        taskAgentsRepo as unknown as import('@openaidy/db').TaskAgentsRepository,
      agents: agentRegistry as unknown as import('../agents').AgentRegistry,
    });
  });

  describe('createTask', () => {
    it('should create a task with basic fields', async () => {
      tasksRepo.create = vi.fn().mockResolvedValue(mockTask);

      const result = await service.createTask({
        title: 'Test Task',
        description: 'Test description',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.title).toBe('Test Task');
        expect(tasksRepo.create).toHaveBeenCalledWith({
          title: 'Test Task',
          description: 'Test description',
        });
      }
    });

    it('should create a task with priority', async () => {
      tasksRepo.create = vi
        .fn()
        .mockResolvedValue({ ...mockTask, priority: 'high' });

      const result = await service.createTask({
        title: 'Test Task',
        description: 'Test description',
        priority: 'high',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(tasksRepo.create).toHaveBeenCalledWith({
          title: 'Test Task',
          description: 'Test description',
          priority: 'high',
        });
      }
    });

    it('should create a task with planning enabled', async () => {
      tasksRepo.create = vi
        .fn()
        .mockResolvedValue({ ...mockTask, planningEnabled: true });

      const result = await service.createTask({
        title: 'Test Task',
        description: 'Test description',
        planningEnabled: true,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(tasksRepo.create).toHaveBeenCalledWith({
          title: 'Test Task',
          description: 'Test description',
          planningEnabled: true,
        });
      }
    });

    it('should fail if agent does not exist', async () => {
      agentRegistry.getAgent = vi.fn().mockReturnValue(null);

      const result = await service.createTask({
        title: 'Test Task',
        description: 'Test description',
        agents: [{ agentId: 'nonexistent' }],
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('agent.not_found');
      }
    });

    it('should assign agents when creating task', async () => {
      tasksRepo.create = vi.fn().mockResolvedValue(mockTask);
      agentRegistry.getAgent = vi
        .fn()
        .mockReturnValue({ id: 'agent1', name: 'Agent 1' });
      taskAgentsRepo.assignMultiple = vi
        .fn()
        .mockResolvedValue([mockTaskAgent]);

      const result = await service.createTask({
        title: 'Test Task',
        description: 'Test description',
        agents: [{ agentId: 'agent1', role: 'primary' }],
      });

      expect(result.ok).toBe(true);
      expect(taskAgentsRepo.assignMultiple).toHaveBeenCalledWith('task1', [
        { agentId: 'agent1', role: 'primary' },
      ]);
    });
  });

  describe('createTask with planning', () => {
    const mockPlanningTask = { ...mockTask, planningEnabled: true };

    it('triggers planningService.planTask when planningEnabled=true', async () => {
      tasksRepo.create = vi.fn().mockResolvedValue(mockPlanningTask);
      const planTask = vi.fn().mockResolvedValue({ ok: true, subtasks: [] });
      const serviceWithPlanning = createTaskService({
        tasksRepo:
          tasksRepo as unknown as import('@openaidy/db').TasksRepository,
        subtasksRepo:
          subtasksRepo as unknown as import('@openaidy/db').SubtasksRepository,
        taskAgentsRepo:
          taskAgentsRepo as unknown as import('@openaidy/db').TaskAgentsRepository,
        planningService: { planTask } as unknown as PlanningService,
      });

      const result = await serviceWithPlanning.createTask({
        title: 'Test Task',
        description: 'Test description',
        planningEnabled: true,
      });

      expect(result.ok).toBe(true);
      // planTask is fire-and-forget — wait for it via a tick
      await new Promise((r) => setTimeout(r, 0));
      expect(planTask).toHaveBeenCalledWith('task1');
    });

    it('does NOT trigger planningService when planningEnabled=false', async () => {
      tasksRepo.create = vi.fn().mockResolvedValue(mockTask);
      const planTask = vi.fn().mockResolvedValue({ ok: true, subtasks: [] });
      const serviceWithPlanning = createTaskService({
        tasksRepo:
          tasksRepo as unknown as import('@openaidy/db').TasksRepository,
        subtasksRepo:
          subtasksRepo as unknown as import('@openaidy/db').SubtasksRepository,
        taskAgentsRepo:
          taskAgentsRepo as unknown as import('@openaidy/db').TaskAgentsRepository,
        planningService: { planTask } as unknown as PlanningService,
      });

      await serviceWithPlanning.createTask({
        title: 'Test Task',
        description: 'Test description',
        planningEnabled: false,
      });

      await new Promise((r) => setTimeout(r, 0));
      expect(planTask).not.toHaveBeenCalled();
    });

    it('does NOT trigger planning when no planningService provided', async () => {
      tasksRepo.create = vi.fn().mockResolvedValue(mockPlanningTask);

      const result = await service.createTask({
        title: 'Test Task',
        description: 'Test description',
        planningEnabled: true,
      });

      expect(result.ok).toBe(true);
    });

    it('task creation succeeds even if planningService.planTask rejects', async () => {
      tasksRepo.create = vi.fn().mockResolvedValue(mockPlanningTask);
      const planTask = vi.fn().mockRejectedValue(new Error('unexpected error'));
      const serviceWithPlanning = createTaskService({
        tasksRepo:
          tasksRepo as unknown as import('@openaidy/db').TasksRepository,
        subtasksRepo:
          subtasksRepo as unknown as import('@openaidy/db').SubtasksRepository,
        taskAgentsRepo:
          taskAgentsRepo as unknown as import('@openaidy/db').TaskAgentsRepository,
        planningService: { planTask } as unknown as PlanningService,
      });

      const result = await serviceWithPlanning.createTask({
        title: 'Test Task',
        description: 'Test description',
        planningEnabled: true,
      });

      expect(result.ok).toBe(true);
      // Let the background promise reject without crashing
      await new Promise((r) => setTimeout(r, 0));
    });
  });

  describe('getTask', () => {
    it('should return a task by ID', async () => {
      tasksRepo.findById = vi.fn().mockResolvedValue(mockTask);

      const result = await service.getTask('task1');

      expect(result).toEqual(mockTask);
      expect(tasksRepo.findById).toHaveBeenCalledWith('task1');
    });

    it('should return null for non-existent task', async () => {
      tasksRepo.findById = vi.fn().mockResolvedValue(null);

      const result = await service.getTask('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('getTaskWithDetails', () => {
    it('should return task with agents, subtasks, and progress', async () => {
      tasksRepo.findById = vi.fn().mockResolvedValue(mockTask);
      taskAgentsRepo.listByTask = vi.fn().mockResolvedValue([mockTaskAgent]);
      subtasksRepo.listByTask = vi.fn().mockResolvedValue([mockSubtask]);
      subtasksRepo.getCountsByStatus = vi.fn().mockResolvedValue({
        pending: 1,
        assigned: 0,
        in_progress: 0,
        completed: 0,
        failed: 0,
      });

      const result = await service.getTaskWithDetails('task1');

      expect(result).not.toBeNull();
      expect(result?.agents).toHaveLength(1);
      expect(result?.subtasks).toHaveLength(1);
      expect(result?.progress.total).toBe(1);
      expect(result?.progress.completed).toBe(0);
    });

    it('should return null for non-existent task', async () => {
      tasksRepo.findById = vi.fn().mockResolvedValue(null);

      const result = await service.getTaskWithDetails('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('listTasks', () => {
    it('should list all tasks', async () => {
      tasksRepo.list = vi.fn().mockResolvedValue([mockTask]);

      const result = await service.listTasks();

      expect(result).toHaveLength(1);
      expect(tasksRepo.list).toHaveBeenCalledWith(undefined);
    });

    it('should list tasks filtered by status', async () => {
      tasksRepo.list = vi.fn().mockResolvedValue([mockTask]);

      await service.listTasks('backlog');

      expect(tasksRepo.list).toHaveBeenCalledWith('backlog');
    });
  });

  describe('listTasksForKanban', () => {
    it('should group tasks by status', async () => {
      const todoTask = { ...mockTask, id: 'task2', status: 'todo' as const };
      tasksRepo.list = vi.fn().mockResolvedValue([mockTask, todoTask]);

      const result = await service.listTasksForKanban();

      expect(result.backlog).toHaveLength(1);
      expect(result.todo).toHaveLength(1);
      expect(result.in_progress).toHaveLength(0);
    });
  });

  describe('updateTask', () => {
    it('should update a task', async () => {
      tasksRepo.findById = vi.fn().mockResolvedValue(mockTask);
      tasksRepo.update = vi
        .fn()
        .mockResolvedValue({ ...mockTask, title: 'Updated' });

      const result = await service.updateTask('task1', { title: 'Updated' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.title).toBe('Updated');
      }
    });

    it('should fail for non-existent task', async () => {
      tasksRepo.findById = vi.fn().mockResolvedValue(null);

      const result = await service.updateTask('nonexistent', {
        title: 'Updated',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('task.not_found');
      }
    });
  });

  describe('updateTaskStatus', () => {
    it('should update task status', async () => {
      tasksRepo.findById = vi.fn().mockResolvedValue(mockTask);
      tasksRepo.updateStatus = vi
        .fn()
        .mockResolvedValue({ ...mockTask, status: 'in_progress' });

      const result = await service.updateTaskStatus('task1', 'in_progress');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.status).toBe('in_progress');
      }
    });
  });

  describe('deleteTask', () => {
    it('should delete a task', async () => {
      tasksRepo.findById = vi.fn().mockResolvedValue(mockTask);
      tasksRepo.delete = vi.fn().mockResolvedValue(mockTask);

      const result = await service.deleteTask('task1');

      expect(result.ok).toBe(true);
      expect(tasksRepo.delete).toHaveBeenCalledWith('task1');
    });

    it('should fail for non-existent task', async () => {
      tasksRepo.findById = vi.fn().mockResolvedValue(null);

      const result = await service.deleteTask('nonexistent');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('task.not_found');
      }
    });
  });

  describe('assignAgents', () => {
    it('should assign agents to a task', async () => {
      tasksRepo.findById = vi.fn().mockResolvedValue(mockTask);
      agentRegistry.getAgent = vi.fn().mockReturnValue({ id: 'agent1' });
      taskAgentsRepo.assignMultiple = vi
        .fn()
        .mockResolvedValue([mockTaskAgent]);

      const result = await service.assignAgents('task1', [
        { agentId: 'agent1' },
      ]);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toHaveLength(1);
      }
    });

    it('should fail if task does not exist', async () => {
      tasksRepo.findById = vi.fn().mockResolvedValue(null);

      const result = await service.assignAgents('nonexistent', [
        { agentId: 'agent1' },
      ]);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('task.not_found');
      }
    });

    it('should fail if agent does not exist', async () => {
      tasksRepo.findById = vi.fn().mockResolvedValue(mockTask);
      agentRegistry.getAgent = vi.fn().mockReturnValue(null);

      const result = await service.assignAgents('task1', [
        { agentId: 'nonexistent' },
      ]);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('agent.not_found');
      }
    });
  });

  describe('removeAgent', () => {
    it('should remove an agent from a task', async () => {
      taskAgentsRepo.remove = vi.fn().mockResolvedValue(mockTaskAgent);

      const result = await service.removeAgent('task1', 'agent1');

      expect(result.ok).toBe(true);
      expect(taskAgentsRepo.remove).toHaveBeenCalledWith('task1', 'agent1');
    });
  });

  describe('createSubtask', () => {
    it('should create a subtask', async () => {
      tasksRepo.findById = vi.fn().mockResolvedValue(mockTask);
      subtasksRepo.create = vi.fn().mockResolvedValue(mockSubtask);

      const result = await service.createSubtask({
        taskId: 'task1',
        title: 'Test Subtask',
        description: 'Subtask description',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.title).toBe('Test Subtask');
      }
    });

    it('should fail if task does not exist', async () => {
      tasksRepo.findById = vi.fn().mockResolvedValue(null);

      const result = await service.createSubtask({
        taskId: 'nonexistent',
        title: 'Test Subtask',
        description: 'Subtask description',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('task.not_found');
      }
    });

    it('should fail if assigned agent does not exist', async () => {
      tasksRepo.findById = vi.fn().mockResolvedValue(mockTask);
      agentRegistry.getAgent = vi.fn().mockReturnValue(null);

      const result = await service.createSubtask({
        taskId: 'task1',
        title: 'Test Subtask',
        description: 'Subtask description',
        assignedAgentId: 'nonexistent',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('agent.not_found');
      }
    });
  });

  describe('updateSubtaskStatus', () => {
    it('should update subtask status', async () => {
      subtasksRepo.updateStatus = vi
        .fn()
        .mockResolvedValue({ ...mockSubtask, status: 'completed' });

      const result = await service.updateSubtaskStatus('subtask1', 'completed');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.status).toBe('completed');
      }
    });

    it('should fail if subtask does not exist', async () => {
      subtasksRepo.updateStatus = vi.fn().mockResolvedValue(null);

      const result = await service.updateSubtaskStatus(
        'nonexistent',
        'completed',
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('subtask.not_found');
      }
    });
  });

  describe('assignSubtaskAgent', () => {
    it('should assign an agent to a subtask', async () => {
      agentRegistry.getAgent = vi.fn().mockReturnValue({ id: 'agent1' });
      subtasksRepo.assignAgent = vi
        .fn()
        .mockResolvedValue({ ...mockSubtask, assignedAgentId: 'agent1' });

      const result = await service.assignSubtaskAgent('subtask1', 'agent1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.assignedAgentId).toBe('agent1');
      }
    });

    it('should fail if agent does not exist', async () => {
      agentRegistry.getAgent = vi.fn().mockReturnValue(null);

      const result = await service.assignSubtaskAgent(
        'subtask1',
        'nonexistent',
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('agent.not_found');
      }
    });
  });

  describe('setSubtaskResult', () => {
    it('should set subtask result', async () => {
      subtasksRepo.setResult = vi
        .fn()
        .mockResolvedValue({ ...mockSubtask, result: 'Done!' });

      const result = await service.setSubtaskResult('subtask1', 'Done!');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.result).toBe('Done!');
      }
    });

    it('should fail if subtask does not exist', async () => {
      subtasksRepo.setResult = vi.fn().mockResolvedValue(null);

      const result = await service.setSubtaskResult('nonexistent', 'Done!');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('subtask.not_found');
      }
    });
  });

  describe('getTaskProgress', () => {
    it('should return progress info', async () => {
      subtasksRepo.getCountsByStatus = vi.fn().mockResolvedValue({
        pending: 2,
        assigned: 1,
        in_progress: 1,
        completed: 3,
        failed: 1,
      });

      const result = await service.getTaskProgress('task1');

      expect(result.total).toBe(8);
      expect(result.completed).toBe(3);
      expect(result.inProgress).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.pending).toBe(3); // pending + assigned
    });
  });

  describe('updatePlanningStatus', () => {
    it('should update planning status', async () => {
      tasksRepo.findById = vi.fn().mockResolvedValue(mockTask);
      tasksRepo.updatePlanningStatus = vi
        .fn()
        .mockResolvedValue({ ...mockTask, planningStatus: 'in_progress' });

      const result = await service.updatePlanningStatus('task1', 'in_progress');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.planningStatus).toBe('in_progress');
      }
    });

    it('should fail if task does not exist', async () => {
      tasksRepo.findById = vi.fn().mockResolvedValue(null);

      const result = await service.updatePlanningStatus(
        'nonexistent',
        'in_progress',
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('task.not_found');
      }
    });
  });

  describe('createSubtasks', () => {
    it('should create multiple subtasks', async () => {
      tasksRepo.findById = vi.fn().mockResolvedValue(mockTask);
      subtasksRepo.create = vi
        .fn()
        .mockResolvedValueOnce({ ...mockSubtask, id: 'sub1', orderIndex: 0 })
        .mockResolvedValueOnce({ ...mockSubtask, id: 'sub2', orderIndex: 1 });

      const result = await service.createSubtasks('task1', [
        { title: 'Subtask 1', description: 'First' },
        { title: 'Subtask 2', description: 'Second' },
      ]);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toHaveLength(2);
        expect(subtasksRepo.create).toHaveBeenCalledTimes(2);
      }
    });

    it('should fail if task does not exist', async () => {
      tasksRepo.findById = vi.fn().mockResolvedValue(null);

      const result = await service.createSubtasks('nonexistent', [
        { title: 'Subtask 1', description: 'First' },
      ]);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('task.not_found');
      }
    });
  });
});
