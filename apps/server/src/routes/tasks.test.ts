import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { taskRoutes, type TaskRoutesOptions } from './tasks';
import type { TaskService, TaskWithDetails, KanbanBoard } from '../tasks/service';
import type { Task } from '@openaidy/db';

// Mock TaskService
const createMockTaskService = () => ({
  createTask: vi.fn(),
  getTask: vi.fn(),
  getTaskWithDetails: vi.fn(),
  listTasks: vi.fn(),
  listTasksForKanban: vi.fn(),
  updateTask: vi.fn(),
  updateTaskStatus: vi.fn(),
  deleteTask: vi.fn(),
  assignAgents: vi.fn(),
  removeAgent: vi.fn(),
  getTaskAgents: vi.fn(),
  createSubtask: vi.fn(),
  getSubtasks: vi.fn(),
  updateSubtaskStatus: vi.fn(),
  assignSubtaskAgent: vi.fn(),
  setSubtaskResult: vi.fn(),
  getTaskProgress: vi.fn(),
  updatePlanningStatus: vi.fn(),
  createSubtasks: vi.fn(),
});

type MockTaskService = ReturnType<typeof createMockTaskService>;

// Helper to build a fastify-like app mock
const buildApp = () => {
  const routes: Array<{
    method: string;
    url: string;
    handler: Function;
  }> = [];

  const app = {
    get: vi.fn((url: string, handler: Function) => {
      routes.push({ method: 'GET', url, handler });
    }),
    post: vi.fn((url: string, handler: Function) => {
      routes.push({ method: 'POST', url, handler });
    }),
    patch: vi.fn((url: string, handler: Function) => {
      routes.push({ method: 'PATCH', url, handler });
    }),
    delete: vi.fn((url: string, handler: Function) => {
      routes.push({ method: 'DELETE', url, handler });
    }),
    _routes: routes,
  };

  return app as unknown as FastifyInstance & { _routes: typeof routes };
};

describe('taskRoutes', () => {
  let mockService: MockTaskService;

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

  const mockTaskWithDetails: TaskWithDetails = {
    ...mockTask,
    agents: [],
    subtasks: [],
    progress: { total: 0, completed: 0, inProgress: 0, failed: 0 },
  };

  beforeEach(() => {
    mockService = createMockTaskService();
  });

  it('should register all task routes', async () => {
    const app = buildApp();
    await taskRoutes(app, { taskService: mockService as unknown as TaskService });

    const registeredRoutes = app._routes.map((r) => `${r.method} ${r.url}`);

    expect(registeredRoutes).toContain('GET /tasks');
    expect(registeredRoutes).toContain('GET /tasks/kanban');
    expect(registeredRoutes).toContain('POST /tasks');
    expect(registeredRoutes).toContain('GET /tasks/:id');
    expect(registeredRoutes).toContain('PATCH /tasks/:id');
    expect(registeredRoutes).toContain('DELETE /tasks/:id');
    expect(registeredRoutes).toContain('PATCH /tasks/:id/status');
    expect(registeredRoutes).toContain('POST /tasks/:taskId/agents');
    expect(registeredRoutes).toContain('DELETE /tasks/:taskId/agents/:agentId');
    expect(registeredRoutes).toContain('GET /tasks/:taskId/progress');
  });

  describe('GET /tasks', () => {
    it('should list all tasks', async () => {
      const app = buildApp();
      await taskRoutes(app, { taskService: mockService as unknown as TaskService });

      mockService.listTasks.mockResolvedValue([mockTask]);

      const route = app._routes.find((r) => r.method === 'GET' && r.url === '/tasks');
      const result = await route!.handler(
        { query: {} },
        { code: vi.fn().mockReturnThis() }
      );

      expect(result.items).toHaveLength(1);
      expect(mockService.listTasks).toHaveBeenCalledWith(undefined);
    });

    it('should filter tasks by status', async () => {
      const app = buildApp();
      await taskRoutes(app, { taskService: mockService as unknown as TaskService });

      mockService.listTasks.mockResolvedValue([mockTask]);

      const route = app._routes.find((r) => r.method === 'GET' && r.url === '/tasks');
      const result = await route!.handler(
        { query: { status: 'backlog' } },
        { code: vi.fn().mockReturnThis() }
      );

      expect(mockService.listTasks).toHaveBeenCalledWith('backlog');
    });
  });

  describe('GET /tasks/kanban', () => {
    it('should return tasks grouped by status', async () => {
      const app = buildApp();
      await taskRoutes(app, { taskService: mockService as unknown as TaskService });

      const kanbanBoard: KanbanBoard = {
        backlog: [mockTask],
        todo: [],
        in_progress: [],
        review: [],
        done: [],
        cancelled: [],
      };
      mockService.listTasksForKanban.mockResolvedValue(kanbanBoard);

      const route = app._routes.find((r) => r.method === 'GET' && r.url === '/tasks/kanban');
      const result = await route!.handler({}, { code: vi.fn().mockReturnThis() });

      expect(result.backlog).toHaveLength(1);
    });
  });

  describe('POST /tasks', () => {
    it('should create a task', async () => {
      const app = buildApp();
      await taskRoutes(app, { taskService: mockService as unknown as TaskService });

      mockService.createTask.mockResolvedValue({ ok: true, data: mockTask });

      const route = app._routes.find((r) => r.method === 'POST' && r.url === '/tasks');
      const reply = { code: vi.fn().mockReturnThis() };
      const result = await route!.handler(
        { body: { title: 'Test', description: 'Test desc' } },
        reply
      );

      expect(result.ok).toBe(true);
      expect(result.data.title).toBe('Test Task');
      expect(reply.code).toHaveBeenCalledWith(201);
    });

    it('should return 400 for invalid input', async () => {
      const app = buildApp();
      await taskRoutes(app, { taskService: mockService as unknown as TaskService });

      const route = app._routes.find((r) => r.method === 'POST' && r.url === '/tasks');
      const reply = { code: vi.fn().mockReturnThis() };
      const result = await route!.handler(
        { body: { title: '' } }, // Missing required fields
        reply
      );

      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('validation.invalid_request');
      expect(reply.code).toHaveBeenCalledWith(400);
    });
  });

  describe('GET /tasks/:id', () => {
    it('should return task with details', async () => {
      const app = buildApp();
      await taskRoutes(app, { taskService: mockService as unknown as TaskService });

      mockService.getTaskWithDetails.mockResolvedValue(mockTaskWithDetails);

      const route = app._routes.find((r) => r.method === 'GET' && r.url === '/tasks/:id');
      const result = await route!.handler(
        { params: { id: 'task1' } },
        { code: vi.fn().mockReturnThis() }
      );

      expect(result.ok).toBe(true);
      expect(result.data.id).toBe('task1');
    });

    it('should return 404 for non-existent task', async () => {
      const app = buildApp();
      await taskRoutes(app, { taskService: mockService as unknown as TaskService });

      mockService.getTaskWithDetails.mockResolvedValue(null);

      const route = app._routes.find((r) => r.method === 'GET' && r.url === '/tasks/:id');
      const reply = { code: vi.fn().mockReturnThis() };
      const result = await route!.handler(
        { params: { id: 'nonexistent' } },
        reply
      );

      expect(result.ok).toBe(false);
      expect(reply.code).toHaveBeenCalledWith(404);
    });
  });

  describe('PATCH /tasks/:id/status', () => {
    it('should update task status', async () => {
      const app = buildApp();
      await taskRoutes(app, { taskService: mockService as unknown as TaskService });

      mockService.updateTaskStatus.mockResolvedValue({
        ok: true,
        data: { ...mockTask, status: 'in_progress' },
      });

      const route = app._routes.find((r) => r.method === 'PATCH' && r.url === '/tasks/:id/status');
      const result = await route!.handler(
        { params: { id: 'task1' }, body: { status: 'in_progress' } },
        { code: vi.fn().mockReturnThis() }
      );

      expect(result.ok).toBe(true);
      expect(result.data.status).toBe('in_progress');
    });
  });

  describe('DELETE /tasks/:id', () => {
    it('should delete a task', async () => {
      const app = buildApp();
      await taskRoutes(app, { taskService: mockService as unknown as TaskService });

      mockService.deleteTask.mockResolvedValue({ ok: true, data: true });

      const route = app._routes.find((r) => r.method === 'DELETE' && r.url === '/tasks/:id');
      const result = await route!.handler(
        { params: { id: 'task1' } },
        { code: vi.fn().mockReturnThis() }
      );

      expect(result.ok).toBe(true);
    });
  });

  describe('POST /tasks/:taskId/agents', () => {
    it('should assign agents to a task', async () => {
      const app = buildApp();
      await taskRoutes(app, { taskService: mockService as unknown as TaskService });

      mockService.assignAgents.mockResolvedValue({
        ok: true,
        data: [{ taskId: 'task1', agentId: 'agent1', role: 'primary', assignedAt: new Date() }],
      });

      const route = app._routes.find((r) => r.method === 'POST' && r.url === '/tasks/:taskId/agents');
      const result = await route!.handler(
        { params: { taskId: 'task1' }, body: { agents: [{ agentId: 'agent1' }] } },
        { code: vi.fn().mockReturnThis() }
      );

      expect(result.ok).toBe(true);
      expect(result.data).toHaveLength(1);
    });
  });
});
