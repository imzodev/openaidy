import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { taskRoutes } from './tasks';
import type {
  TaskService,
  TaskWithDetails,
  KanbanBoard,
} from '../tasks/service';
import type { Task } from '@openaidy/db';
import type { AuthMiddleware } from '../websocket/middleware/auth';

const mockAuthMiddleware = {
  validateToken: async () => ({
    sub: 'test',
    scopes: ['*'],
    type: 'access' as const,
    iat: 0,
    exp: 9999999999,
  }),
  extractFromHeader: (_h: string) => 'test-token',
  hasCapability: () => true,
} as unknown as AuthMiddleware;

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
  updateSubtask: vi.fn(),
  updateSubtaskStatus: vi.fn(),
  assignSubtaskAgent: vi.fn(),
  setSubtaskResult: vi.fn(),
  getTaskProgress: vi.fn(),
  updatePlanningStatus: vi.fn(),
  createSubtasks: vi.fn(),
});

type MockTaskService = ReturnType<typeof createMockTaskService>;

// Route handler type
type RouteHandler = (
  request: {
    params?: Record<string, string>;
    query?: Record<string, unknown>;
    body?: unknown;
  },
  reply: { code?: () => { mockReturnThis: () => unknown } },
) => Promise<unknown>;

// Helper to build a fastify-like app mock
const buildApp = () => {
  const routes: Array<{
    method: string;
    url: string;
    handler: RouteHandler;
  }> = [];

  const app = {
    get: vi.fn((url: string, handler: RouteHandler) => {
      routes.push({ method: 'GET', url, handler });
    }),
    post: vi.fn((url: string, handler: RouteHandler) => {
      routes.push({ method: 'POST', url, handler });
    }),
    patch: vi.fn((url: string, handler: RouteHandler) => {
      routes.push({ method: 'PATCH', url, handler });
    }),
    delete: vi.fn((url: string, handler: RouteHandler) => {
      routes.push({ method: 'DELETE', url, handler });
    }),
    addHook: vi.fn(),
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
    await taskRoutes(app, {
      taskService: mockService as unknown as TaskService,
      authMiddleware: mockAuthMiddleware,
    });

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
    expect(registeredRoutes).toContain('GET /tasks/:id/subtasks');
    expect(registeredRoutes).toContain('POST /tasks/:id/plan');
    expect(registeredRoutes).toContain('PATCH /subtasks/:id');
    expect(registeredRoutes).toContain('POST /subtasks/:id/assign');
  });

  describe('GET /tasks', () => {
    it('should list all tasks', async () => {
      const app = buildApp();
      await taskRoutes(app, {
        taskService: mockService as unknown as TaskService,
        authMiddleware: mockAuthMiddleware,
      });

      mockService.listTasks.mockResolvedValue([mockTask]);

      const route = app._routes.find(
        (r) => r.method === 'GET' && r.url === '/tasks',
      );
      const result = await route!.handler(
        { query: {} },
        { code: vi.fn().mockReturnThis() },
      );

      expect((result as { items: unknown[] }).items).toHaveLength(1);
      expect(mockService.listTasks).toHaveBeenCalledWith(undefined);
    });

    it('should filter tasks by status', async () => {
      const app = buildApp();
      await taskRoutes(app, {
        taskService: mockService as unknown as TaskService,
        authMiddleware: mockAuthMiddleware,
      });

      mockService.listTasks.mockResolvedValue([mockTask]);

      const route = app._routes.find(
        (r) => r.method === 'GET' && r.url === '/tasks',
      );
      await route!.handler(
        { query: { status: 'backlog' } },
        { code: vi.fn().mockReturnThis() },
      );

      expect(mockService.listTasks).toHaveBeenCalledWith('backlog');
    });
  });

  describe('GET /tasks/kanban', () => {
    it('should return tasks grouped by status', async () => {
      const app = buildApp();
      await taskRoutes(app, {
        taskService: mockService as unknown as TaskService,
        authMiddleware: mockAuthMiddleware,
      });

      const kanbanBoard: KanbanBoard = {
        backlog: [mockTask],
        todo: [],
        in_progress: [],
        review: [],
        done: [],
        cancelled: [],
      };
      mockService.listTasksForKanban.mockResolvedValue(kanbanBoard);

      const route = app._routes.find(
        (r) => r.method === 'GET' && r.url === '/tasks/kanban',
      );
      const result = await route!.handler(
        {},
        { code: vi.fn().mockReturnThis() },
      );

      expect((result as { backlog: unknown[] }).backlog).toHaveLength(1);
    });
  });

  describe('POST /tasks', () => {
    it('should create a task', async () => {
      const app = buildApp();
      await taskRoutes(app, {
        taskService: mockService as unknown as TaskService,
        authMiddleware: mockAuthMiddleware,
      });

      mockService.createTask.mockResolvedValue({ ok: true, data: mockTask });

      const route = app._routes.find(
        (r) => r.method === 'POST' && r.url === '/tasks',
      );
      const reply = { code: vi.fn().mockReturnThis() };
      const result = await route!.handler(
        { body: { title: 'Test', description: 'Test desc' } },
        reply,
      );

      expect((result as { ok: boolean; data: { title: string } }).ok).toBe(
        true,
      );
      expect(
        (result as { ok: boolean; data: { title: string } }).data.title,
      ).toBe('Test Task');
      expect(reply.code).toHaveBeenCalledWith(201);
    });

    it('accepts a schedule field in the CreateTaskScheduleInput shape (wrapped)', async () => {
      // The frontend sends `{ schedule: { schedule: { every: '1h' } } }`
      // (outer = CreateTaskScheduleInput, inner = ScheduleInput discriminated
      // union). The server must accept this so the kanban "enable recurring
      // schedule" checkbox can attach a schedule on task creation.
      const app = buildApp();
      await taskRoutes(app, {
        taskService: mockService as unknown as TaskService,
        authMiddleware: mockAuthMiddleware,
      });
      mockService.createTask.mockResolvedValue({ ok: true, data: mockTask });

      const route = app._routes.find(
        (r) => r.method === 'POST' && r.url === '/tasks',
      );
      const reply = { code: vi.fn().mockReturnThis() };
      const result = await route!.handler(
        {
          body: {
            description: 'Recurring test',
            schedule: { schedule: { every: '1h' } },
          },
        },
        reply,
      );

      expect((result as { ok: boolean }).ok).toBe(true);
      // The service expects `CreateTaskScheduleInput` shape (envelope),
      // not the bare `ScheduleInput` discriminated union.
      expect(mockService.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          schedule: { schedule: { every: '1h' } },
        }),
      );
    });

    it('accepts the bare ScheduleInput as the cron variant (string form)', async () => {
      // Regression: a previous version of the schema only accepted
      // `cron: { expression, tz? }` and rejected the canonical
      // `ScheduleInput` shape `cron: string` (which is what the
      // web client sends). The schema now accepts both.
      const app = buildApp();
      await taskRoutes(app, {
        taskService: mockService as unknown as TaskService,
        authMiddleware: mockAuthMiddleware,
      });
      mockService.createTask.mockResolvedValue({ ok: true, data: mockTask });

      const route = app._routes.find(
        (r) => r.method === 'POST' && r.url === '/tasks',
      );
      const reply = { code: vi.fn().mockReturnThis() };
      const result = await route!.handler(
        {
          body: {
            description: 'Cron test',
            schedule: { schedule: { cron: '0 9 * * 1-5' } },
          },
        },
        reply,
      );
      expect((result as { ok: boolean }).ok).toBe(true);
      // Cron is normalised to the canonical string form.
      expect(mockService.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          schedule: { schedule: { cron: '0 9 * * 1-5' } },
        }),
      );
    });

    it('returns 400 for a schedule that matches none of the variants', async () => {
      const app = buildApp();
      await taskRoutes(app, {
        taskService: mockService as unknown as TaskService,
        authMiddleware: mockAuthMiddleware,
      });
      mockService.createTask.mockResolvedValue({ ok: true, data: mockTask });

      const route = app._routes.find(
        (r) => r.method === 'POST' && r.url === '/tasks',
      );
      const reply = { code: vi.fn().mockReturnThis() };
      await route!.handler(
        {
          body: {
            description: 'Garbage',
            // Empty schedule object: matches none of the variants.
            schedule: { schedule: {} },
          },
        },
        reply,
      );
      expect(reply.code).toHaveBeenCalledWith(400);
    });

    it('should return 400 for invalid input', async () => {
      const app = buildApp();
      await taskRoutes(app, {
        taskService: mockService as unknown as TaskService,
        authMiddleware: mockAuthMiddleware,
      });

      const route = app._routes.find(
        (r) => r.method === 'POST' && r.url === '/tasks',
      );
      const reply = { code: vi.fn().mockReturnThis() };
      const result = await route!.handler(
        { body: { title: '' } }, // Missing required fields
        reply,
      );

      expect((result as { ok: boolean; error: { code: string } }).ok).toBe(
        false,
      );
      expect(
        (result as { ok: boolean; error: { code: string } }).error.code,
      ).toBe('validation.invalid_request');
      expect(reply.code).toHaveBeenCalledWith(400);
    });
  });

  describe('GET /tasks/:id', () => {
    it('should return task with details', async () => {
      const app = buildApp();
      await taskRoutes(app, {
        taskService: mockService as unknown as TaskService,
        authMiddleware: mockAuthMiddleware,
      });

      mockService.getTaskWithDetails.mockResolvedValue(mockTaskWithDetails);

      const route = app._routes.find(
        (r) => r.method === 'GET' && r.url === '/tasks/:id',
      );
      const result = await route!.handler(
        { params: { id: 'task1' } },
        { code: vi.fn().mockReturnThis() },
      );

      expect((result as { ok: boolean; data: { id: string } }).ok).toBe(true);
      expect((result as { ok: boolean; data: { id: string } }).data.id).toBe(
        'task1',
      );
    });

    it('should return 404 for non-existent task', async () => {
      const app = buildApp();
      await taskRoutes(app, {
        taskService: mockService as unknown as TaskService,
        authMiddleware: mockAuthMiddleware,
      });

      mockService.getTaskWithDetails.mockResolvedValue(null);

      const route = app._routes.find(
        (r) => r.method === 'GET' && r.url === '/tasks/:id',
      );
      const reply = { code: vi.fn().mockReturnThis() };
      const result = await route!.handler(
        { params: { id: 'nonexistent' } },
        reply,
      );

      expect((result as { ok: boolean }).ok).toBe(false);
      expect(reply.code).toHaveBeenCalledWith(404);
    });
  });

  describe('PATCH /tasks/:id/status', () => {
    it('should update task status', async () => {
      const app = buildApp();
      await taskRoutes(app, {
        taskService: mockService as unknown as TaskService,
        authMiddleware: mockAuthMiddleware,
      });

      mockService.updateTaskStatus.mockResolvedValue({
        ok: true,
        data: { ...mockTask, status: 'in_progress' },
      });

      const route = app._routes.find(
        (r) => r.method === 'PATCH' && r.url === '/tasks/:id/status',
      );
      const result = await route!.handler(
        { params: { id: 'task1' }, body: { status: 'in_progress' } },
        { code: vi.fn().mockReturnThis() },
      );

      expect((result as { ok: boolean; data: { status: string } }).ok).toBe(
        true,
      );
      expect(
        (result as { ok: boolean; data: { status: string } }).data.status,
      ).toBe('in_progress');
    });
  });

  describe('DELETE /tasks/:id', () => {
    it('should delete a task', async () => {
      const app = buildApp();
      await taskRoutes(app, {
        taskService: mockService as unknown as TaskService,
        authMiddleware: mockAuthMiddleware,
      });

      mockService.deleteTask.mockResolvedValue({ ok: true, data: true });

      const route = app._routes.find(
        (r) => r.method === 'DELETE' && r.url === '/tasks/:id',
      );
      const result = await route!.handler(
        { params: { id: 'task1' } },
        { code: vi.fn().mockReturnThis() },
      );

      expect((result as { ok: boolean }).ok).toBe(true);
    });
  });

  describe('GET /tasks/:id/subtasks', () => {
    const mockSubtask = {
      id: 'sub1',
      taskId: 'task1',
      title: 'Subtask 1',
      description: 'First subtask',
      status: 'pending',
      orderIndex: 0,
      assignedAgentId: null,
      sessionId: null,
      parentSubtaskId: null,
      result: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('returns subtasks for an existing task', async () => {
      const app = buildApp();
      await taskRoutes(app, {
        taskService: mockService as unknown as TaskService,
        authMiddleware: mockAuthMiddleware,
      });

      mockService.getTaskWithDetails.mockResolvedValue(mockTaskWithDetails);
      mockService.getSubtasks.mockResolvedValue([mockSubtask]);

      const route = app._routes.find(
        (r) => r.method === 'GET' && r.url === '/tasks/:id/subtasks',
      );
      const result = await route!.handler(
        { params: { id: 'task1' } },
        { code: vi.fn().mockReturnThis() },
      );

      expect((result as { ok: boolean }).ok).toBe(true);
      expect(
        (result as { ok: boolean; data: { items: unknown[] } }).data.items,
      ).toHaveLength(1);
      expect(mockService.getSubtasks).toHaveBeenCalledWith('task1');
    });

    it('returns empty items array when task has no subtasks', async () => {
      const app = buildApp();
      await taskRoutes(app, {
        taskService: mockService as unknown as TaskService,
        authMiddleware: mockAuthMiddleware,
      });

      mockService.getTaskWithDetails.mockResolvedValue(mockTaskWithDetails);
      mockService.getSubtasks.mockResolvedValue([]);

      const route = app._routes.find(
        (r) => r.method === 'GET' && r.url === '/tasks/:id/subtasks',
      );
      const result = await route!.handler(
        { params: { id: 'task1' } },
        { code: vi.fn().mockReturnThis() },
      );

      expect(
        (result as { ok: boolean; data: { items: unknown[] } }).data.items,
      ).toHaveLength(0);
    });

    it('returns 404 for non-existent task', async () => {
      const app = buildApp();
      await taskRoutes(app, {
        taskService: mockService as unknown as TaskService,
        authMiddleware: mockAuthMiddleware,
      });

      mockService.getTaskWithDetails.mockResolvedValue(null);

      const route = app._routes.find(
        (r) => r.method === 'GET' && r.url === '/tasks/:id/subtasks',
      );
      const reply = { code: vi.fn().mockReturnThis() };
      const result = await route!.handler(
        { params: { id: 'nonexistent' } },
        reply,
      );

      expect((result as { ok: boolean }).ok).toBe(false);
      expect(reply.code).toHaveBeenCalledWith(404);
    });
  });

  describe('POST /tasks/:taskId/agents', () => {
    it('should assign agents to a task', async () => {
      const app = buildApp();
      await taskRoutes(app, {
        taskService: mockService as unknown as TaskService,
        authMiddleware: mockAuthMiddleware,
      });

      mockService.assignAgents.mockResolvedValue({
        ok: true,
        data: [
          {
            taskId: 'task1',
            agentId: 'agent1',
            role: 'primary',
            assignedAt: new Date(),
          },
        ],
      });

      const route = app._routes.find(
        (r) => r.method === 'POST' && r.url === '/tasks/:taskId/agents',
      );
      const result = await route!.handler(
        {
          params: { taskId: 'task1' },
          body: { agents: [{ agentId: 'agent1' }] },
        },
        { code: vi.fn().mockReturnThis() },
      );

      expect((result as { ok: boolean; data: unknown[] }).ok).toBe(true);
      expect((result as { ok: boolean; data: unknown[] }).data).toHaveLength(1);
    });
  });

  describe('PATCH /subtasks/:id', () => {
    async function setupWithMock() {
      const app = buildApp();
      await taskRoutes(app, {
        taskService: mockService as unknown as TaskService,
        authMiddleware: mockAuthMiddleware,
      });
      const route = app._routes.find(
        (r) => r.method === 'PATCH' && r.url === '/subtasks/:id',
      );
      return route!;
    }

    it('updates a subtask and returns the updated record', async () => {
      const route = await setupWithMock();
      mockService.updateSubtask.mockResolvedValue({
        ok: true,
        data: {
          id: 'sub1',
          taskId: 'task1',
          parentSubtaskId: '',
          title: 'updated title',
          description: 'updated description',
          status: 'pending',
          assignedAgentId: null,
          sessionId: null,
          orderIndex: 0,
          result: null,
          retryCount: 0,
          pendingVerificationResult: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      const reply = { code: vi.fn().mockReturnThis() };
      const result = await route.handler(
        {
          params: { id: 'sub1' },
          body: { description: 'updated description' },
        },
        reply,
      );

      expect((result as { ok: boolean }).ok).toBe(true);
      expect(mockService.updateSubtask).toHaveBeenCalledWith('sub1', {
        description: 'updated description',
      });
      expect(reply.code).not.toHaveBeenCalled();
    });

    it('returns 404 when the subtask does not exist', async () => {
      const route = await setupWithMock();
      mockService.updateSubtask.mockResolvedValue({
        ok: false,
        error: {
          code: 'subtask.not_found',
          message: 'Subtask "missing" not found',
        },
      });

      const reply = { code: vi.fn().mockReturnThis() };
      const result = await route.handler(
        { params: { id: 'missing' }, body: { description: 'whatever' } },
        reply,
      );

      expect((result as { ok: boolean }).ok).toBe(false);
      expect(reply.code).toHaveBeenCalledWith(404);
    });

    it('returns 400 when no editable field is supplied', async () => {
      const route = await setupWithMock();
      const reply = { code: vi.fn().mockReturnThis() };
      const result = await route.handler(
        { params: { id: 'sub1' }, body: {} },
        reply,
      );

      expect((result as { ok: boolean }).ok).toBe(false);
      expect(reply.code).toHaveBeenCalledWith(400);
      expect(mockService.updateSubtask).not.toHaveBeenCalled();
    });

    it('returns 400 when description is an empty string', async () => {
      const route = await setupWithMock();
      const reply = { code: vi.fn().mockReturnThis() };
      const result = await route.handler(
        { params: { id: 'sub1' }, body: { description: '   ' } },
        reply,
      );

      expect((result as { ok: boolean }).ok).toBe(false);
      expect(reply.code).toHaveBeenCalledWith(400);
      expect(mockService.updateSubtask).not.toHaveBeenCalled();
    });
  });

  describe('POST /subtasks/:id/assign', () => {
    async function setupWithMock() {
      const app = buildApp();
      await taskRoutes(app, {
        taskService: mockService as unknown as TaskService,
        authMiddleware: mockAuthMiddleware,
      });
      const route = app._routes.find(
        (r) => r.method === 'POST' && r.url === '/subtasks/:id/assign',
      );
      return route!;
    }

    it('reassigns the agent and returns the updated subtask', async () => {
      const route = await setupWithMock();
      mockService.assignSubtaskAgent.mockResolvedValue({
        ok: true,
        data: {
          id: 'sub1',
          taskId: 'task1',
          parentSubtaskId: '',
          title: 'sub',
          description: 'desc',
          status: 'pending',
          assignedAgentId: 'agent2',
          sessionId: null,
          orderIndex: 0,
          result: null,
          retryCount: 0,
          pendingVerificationResult: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      const reply = { code: vi.fn().mockReturnThis() };
      const result = await route.handler(
        { params: { id: 'sub1' }, body: { agentId: 'agent2' } },
        reply,
      );

      expect((result as { ok: boolean }).ok).toBe(true);
      expect(mockService.assignSubtaskAgent).toHaveBeenCalledWith(
        'sub1',
        'agent2',
      );
      expect(reply.code).not.toHaveBeenCalled();
    });

    it('returns 404 when the subtask does not exist', async () => {
      const route = await setupWithMock();
      mockService.assignSubtaskAgent.mockResolvedValue({
        ok: false,
        error: {
          code: 'subtask.not_found',
          message: 'Subtask "missing" not found',
        },
      });

      const reply = { code: vi.fn().mockReturnThis() };
      const result = await route.handler(
        { params: { id: 'missing' }, body: { agentId: 'agent1' } },
        reply,
      );

      expect((result as { ok: boolean }).ok).toBe(false);
      expect(reply.code).toHaveBeenCalledWith(404);
    });

    it('returns 400 when the agent does not exist', async () => {
      const route = await setupWithMock();
      mockService.assignSubtaskAgent.mockResolvedValue({
        ok: false,
        error: {
          code: 'agent.not_found',
          message: 'Agent "ghost" not found',
        },
      });

      const reply = { code: vi.fn().mockReturnThis() };
      const result = await route.handler(
        { params: { id: 'sub1' }, body: { agentId: 'ghost' } },
        reply,
      );

      expect((result as { ok: boolean }).ok).toBe(false);
      expect(reply.code).toHaveBeenCalledWith(400);
    });

    it('returns 400 when agentId is missing from the body', async () => {
      const route = await setupWithMock();
      const reply = { code: vi.fn().mockReturnThis() };
      const result = await route.handler(
        { params: { id: 'sub1' }, body: {} },
        reply,
      );

      expect((result as { ok: boolean }).ok).toBe(false);
      expect(reply.code).toHaveBeenCalledWith(400);
      expect(mockService.assignSubtaskAgent).not.toHaveBeenCalled();
    });
  });
});
