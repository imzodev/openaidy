import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { taskScheduleRoutes } from './task-schedules';
import type { TaskScheduleService } from '../tasks/schedule-service';
import type { AuthMiddleware } from '../websocket/middleware/auth';
import type {
  TaskScheduleDto,
  TaskExecutionHistoryDto,
  TaskExecutionHistoryStatus,
} from '@openaidy/shared-types';

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

// ---------------------------------------------------------------------------
// Mock TaskScheduleService
// ---------------------------------------------------------------------------

const createMockScheduleService = () => ({
  getScheduleForTask: vi.fn(),
  getScheduleById: vi.fn(),
  createSchedule: vi.fn(),
  updateSchedule: vi.fn(),
  removeSchedule: vi.fn(),
  pauseSchedule: vi.fn(),
  resumeSchedule: vi.fn(),
  triggerNow: vi.fn(),
  listExecutions: vi.fn(),
});

type MockScheduleService = ReturnType<typeof createMockScheduleService>;

// ---------------------------------------------------------------------------
// Route handler type (mirrors tasks.test.ts)
// ---------------------------------------------------------------------------

type RouteHandler = (
  request: {
    params?: Record<string, string>;
    query?: Record<string, unknown>;
    body?: unknown;
  },
  reply: { code?: () => { mockReturnThis: () => unknown } },
) => Promise<unknown>;

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

const findRoute = (
  app: ReturnType<typeof buildApp>,
  method: string,
  url: string,
): RouteHandler => {
  const route = app._routes.find((r) => r.method === method && r.url === url);
  if (!route) {
    throw new Error(
      `No route registered for ${method} ${url}. Registered: ${app._routes
        .map((r) => `${r.method} ${r.url}`)
        .join(', ')}`,
    );
  }
  return route.handler;
};

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const mockSchedule: TaskScheduleDto = {
  id: 'sched-1',
  taskId: 'task-1',
  schedule: { cron: '0 9 * * *' },
  cronExpression: '0 9 * * *',
  preset: null,
  scheduleDate: null,
  nextRunAt: '2026-06-05T09:00:00.000Z',
  lastRunAt: null,
  status: 'active',
  replanPolicy: 'never',
  maxExecutions: 9999,
  remainingExecutions: 9999,
  executionCount: 0,
  scheduleHuman: 'Every day at 9:00 AM',
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
};

const mockExecution: TaskExecutionHistoryDto = {
  id: 'exec-1',
  taskId: 'task-1',
  scheduleId: 'sched-1',
  status: 'completed' as TaskExecutionHistoryStatus,
  startedAt: '2026-06-01T09:00:00.000Z',
  finishedAt: '2026-06-01T09:00:30.000Z',
  durationMs: 30000,
  sessionId: 'sess-1',
  attemptNumber: 1,
  didReplan: false,
  taskTitle: 'T',
  taskDescription: 'D',
  errorCode: null,
  errorMessage: null,
  subtaskSummary: null,
  createdAt: '2026-06-01T09:00:00.000Z',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('taskScheduleRoutes', () => {
  let mockService: MockScheduleService;
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    mockService = createMockScheduleService();
    app = buildApp();
    await taskScheduleRoutes(app, {
      taskScheduleService: mockService as unknown as TaskScheduleService,
      authMiddleware: mockAuthMiddleware,
    });
  });

  describe('route registration', () => {
    it('registers the 8 schedule endpoints', () => {
      const urls = app._routes.map((r) => `${r.method} ${r.url}`);
      expect(urls).toContain('POST /tasks/:taskId/schedule');
      expect(urls).toContain('GET /tasks/:taskId/schedule');
      expect(urls).toContain('PATCH /tasks/:taskId/schedule');
      expect(urls).toContain('DELETE /tasks/:taskId/schedule');
      expect(urls).toContain('POST /tasks/:taskId/schedule/pause');
      expect(urls).toContain('POST /tasks/:taskId/schedule/resume');
      expect(urls).toContain('POST /tasks/:taskId/schedule/trigger');
      expect(urls).toContain('GET /tasks/:taskId/schedule/executions');
    });

    it('attaches an auth preHandler hook', () => {
      expect(app.addHook).toHaveBeenCalledWith(
        'preHandler',
        expect.any(Function),
      );
    });
  });

  // -------------------------------------------------------------------
  // POST /api/tasks/:taskId/schedule
  // -------------------------------------------------------------------
  describe('POST /api/tasks/:taskId/schedule', () => {
    it('creates a schedule and returns 201 with the DTO', async () => {
      mockService.createSchedule.mockResolvedValue({
        ok: true,
        data: mockSchedule,
      });
      const handler = findRoute(app, 'POST', '/tasks/:taskId/schedule');
      const reply = { code: vi.fn().mockReturnThis() };
      const result = await handler(
        { params: { taskId: 'task-1' }, body: { schedule: { every: '1d' } } },
        reply as unknown as { code: () => { mockReturnThis: () => unknown } },
      );
      expect(reply.code).toHaveBeenCalledWith(201);
      expect(result).toEqual({ schedule: mockSchedule });
      expect(mockService.createSchedule).toHaveBeenCalledWith('task-1', {
        schedule: { every: '1d' },
      });
    });

    it('passes through replanPolicy and maxExecutions', async () => {
      mockService.createSchedule.mockResolvedValue({
        ok: true,
        data: mockSchedule,
      });
      const handler = findRoute(app, 'POST', '/tasks/:taskId/schedule');
      await handler(
        {
          params: { taskId: 'task-1' },
          body: {
            schedule: { cron: { expression: '0 9 * * *' } },
            replanPolicy: 'on-description-change',
            maxExecutions: 100,
          },
        },
        { code: vi.fn().mockReturnThis() } as unknown as {
          code: () => { mockReturnThis: () => unknown };
        },
      );
      expect(mockService.createSchedule).toHaveBeenCalledWith('task-1', {
        schedule: { cron: '0 9 * * *' },
        replanPolicy: 'on-description-change',
        maxExecutions: 100,
      });
    });

    it('returns 400 on validation error', async () => {
      const handler = findRoute(app, 'POST', '/tasks/:taskId/schedule');
      const reply = { code: vi.fn().mockReturnThis() };
      const result = await handler(
        {
          params: { taskId: 'task-1' },
          body: { schedule: { every: 'bogus' } },
        },
        reply as unknown as { code: () => { mockReturnThis: () => unknown } },
      );
      expect(reply.code).toHaveBeenCalledWith(400);
      expect(result).toMatchObject({ error: 'validation.invalid_request' });
    });

    it('maps schedule.already_exists to 409', async () => {
      mockService.createSchedule.mockResolvedValue({
        ok: false,
        error: { code: 'schedule.already_exists', message: 'already has one' },
      });
      const handler = findRoute(app, 'POST', '/tasks/:taskId/schedule');
      const reply = { code: vi.fn().mockReturnThis() };
      const result = await handler(
        { params: { taskId: 'task-1' }, body: { schedule: { every: '1h' } } },
        reply as unknown as { code: () => { mockReturnThis: () => unknown } },
      );
      expect(reply.code).toHaveBeenCalledWith(409);
      expect(result).toMatchObject({ error: 'schedule.already_exists' });
    });

    it('maps task.not_found to 404', async () => {
      mockService.createSchedule.mockResolvedValue({
        ok: false,
        error: { code: 'task.not_found', message: 'no task' },
      });
      const handler = findRoute(app, 'POST', '/tasks/:taskId/schedule');
      const reply = { code: vi.fn().mockReturnThis() };
      await handler(
        { params: { taskId: 'nope' }, body: { schedule: { every: '1h' } } },
        reply as unknown as { code: () => { mockReturnThis: () => unknown } },
      );
      expect(reply.code).toHaveBeenCalledWith(404);
    });
  });

  // -------------------------------------------------------------------
  // GET /api/tasks/:taskId/schedule
  // -------------------------------------------------------------------
  describe('GET /api/tasks/:taskId/schedule', () => {
    it('returns the schedule DTO on success', async () => {
      mockService.getScheduleForTask.mockResolvedValue({
        ok: true,
        data: mockSchedule,
      });
      const handler = findRoute(app, 'GET', '/tasks/:taskId/schedule');
      const result = await handler({ params: { taskId: 'task-1' } }, {
        code: vi.fn().mockReturnThis(),
      } as unknown as {
        code: () => { mockReturnThis: () => unknown };
      });
      expect(result).toEqual({ schedule: mockSchedule });
    });

    it('returns { schedule: null } when not found (avoids 404 noise in browser console)', async () => {
      mockService.getScheduleForTask.mockResolvedValue({
        ok: false,
        error: { code: 'schedule.not_found', message: 'no schedule' },
      });
      const handler = findRoute(app, 'GET', '/tasks/:taskId/schedule');
      const reply = { code: vi.fn().mockReturnThis() };
      const result = await handler(
        { params: { taskId: 'task-1' } },
        reply as unknown as { code: () => { mockReturnThis: () => unknown } },
      );
      expect(reply.code).not.toHaveBeenCalled();
      expect(result).toEqual({ schedule: null });
    });

    it('still returns an error code for non-not-found failures', async () => {
      mockService.getScheduleForTask.mockResolvedValue({
        ok: false,
        error: { code: 'task.not_found', message: 'task does not exist' },
      });
      const handler = findRoute(app, 'GET', '/tasks/:taskId/schedule');
      const reply = { code: vi.fn().mockReturnThis() };
      await handler(
        { params: { taskId: 'task-1' } },
        reply as unknown as { code: () => { mockReturnThis: () => unknown } },
      );
      expect(reply.code).toHaveBeenCalledWith(404);
    });
  });

  // -------------------------------------------------------------------
  // PATCH /api/tasks/:taskId/schedule
  // -------------------------------------------------------------------
  describe('PATCH /api/tasks/:taskId/schedule', () => {
    it('updates fields and returns the new DTO', async () => {
      const updated = {
        ...mockSchedule,
        replanPolicy: 'always' as const,
        maxExecutions: 50,
      };
      mockService.updateSchedule.mockResolvedValue({ ok: true, data: updated });
      const handler = findRoute(app, 'PATCH', '/tasks/:taskId/schedule');
      const result = await handler(
        {
          params: { taskId: 'task-1' },
          body: { replanPolicy: 'always', maxExecutions: 50 },
        },
        { code: vi.fn().mockReturnThis() } as unknown as {
          code: () => { mockReturnThis: () => unknown };
        },
      );
      expect(result).toEqual({ schedule: updated });
      expect(mockService.updateSchedule).toHaveBeenCalledWith('task-1', {
        replanPolicy: 'always',
        maxExecutions: 50,
      });
    });

    it('rejects an empty body with 400', async () => {
      const handler = findRoute(app, 'PATCH', '/tasks/:taskId/schedule');
      const reply = { code: vi.fn().mockReturnThis() };
      const result = await handler(
        { params: { taskId: 'task-1' }, body: {} },
        reply as unknown as { code: () => { mockReturnThis: () => unknown } },
      );
      expect(reply.code).toHaveBeenCalledWith(400);
      expect(result).toMatchObject({ error: 'validation.invalid_request' });
    });

    it('rejects maxExecutions <= 0 with 400', async () => {
      const handler = findRoute(app, 'PATCH', '/tasks/:taskId/schedule');
      const reply = { code: vi.fn().mockReturnThis() };
      await handler(
        {
          params: { taskId: 'task-1' },
          body: { maxExecutions: 0 },
        },
        reply as unknown as { code: () => { mockReturnThis: () => unknown } },
      );
      expect(reply.code).toHaveBeenCalledWith(400);
      expect(mockService.updateSchedule).not.toHaveBeenCalled();
    });

    it('maps schedule.expired to 409', async () => {
      mockService.updateSchedule.mockResolvedValue({
        ok: false,
        error: { code: 'schedule.expired', message: 'terminal' },
      });
      const handler = findRoute(app, 'PATCH', '/tasks/:taskId/schedule');
      const reply = { code: vi.fn().mockReturnThis() };
      await handler(
        { params: { taskId: 'task-1' }, body: { status: 'active' } },
        reply as unknown as { code: () => { mockReturnThis: () => unknown } },
      );
      expect(reply.code).toHaveBeenCalledWith(409);
    });
  });

  // -------------------------------------------------------------------
  // pause / resume
  // -------------------------------------------------------------------
  describe('POST /api/tasks/:taskId/schedule/pause', () => {
    it('delegates to pauseSchedule', async () => {
      const paused = { ...mockSchedule, status: 'paused' as const };
      mockService.pauseSchedule.mockResolvedValue({ ok: true, data: paused });
      const handler = findRoute(app, 'POST', '/tasks/:taskId/schedule/pause');
      const result = await handler({ params: { taskId: 'task-1' } }, {
        code: vi.fn().mockReturnThis(),
      } as unknown as {
        code: () => { mockReturnThis: () => unknown };
      });
      expect(result).toEqual({ schedule: paused });
      expect(mockService.pauseSchedule).toHaveBeenCalledWith('task-1');
    });
  });

  describe('POST /api/tasks/:taskId/schedule/resume', () => {
    it('delegates to resumeSchedule', async () => {
      const resumed = { ...mockSchedule, status: 'active' as const };
      mockService.resumeSchedule.mockResolvedValue({
        ok: true,
        data: resumed,
      });
      const handler = findRoute(app, 'POST', '/tasks/:taskId/schedule/resume');
      const result = await handler({ params: { taskId: 'task-1' } }, {
        code: vi.fn().mockReturnThis(),
      } as unknown as {
        code: () => { mockReturnThis: () => unknown };
      });
      expect(result).toEqual({ schedule: resumed });
      expect(mockService.resumeSchedule).toHaveBeenCalledWith('task-1');
    });
  });

  // -------------------------------------------------------------------
  // DELETE /api/tasks/:taskId/schedule
  // -------------------------------------------------------------------
  describe('DELETE /api/tasks/:taskId/schedule', () => {
    it('returns 204 on success', async () => {
      mockService.removeSchedule.mockResolvedValue({
        ok: true,
        data: true,
      });
      const handler = findRoute(app, 'DELETE', '/tasks/:taskId/schedule');
      const reply = { code: vi.fn().mockReturnThis() };
      await handler(
        { params: { taskId: 'task-1' } },
        reply as unknown as { code: () => { mockReturnThis: () => unknown } },
      );
      expect(reply.code).toHaveBeenCalledWith(204);
      expect(mockService.removeSchedule).toHaveBeenCalledWith('task-1');
    });

    it('returns 404 when no schedule exists', async () => {
      mockService.removeSchedule.mockResolvedValue({
        ok: false,
        error: { code: 'schedule.not_found', message: 'no' },
      });
      const handler = findRoute(app, 'DELETE', '/tasks/:taskId/schedule');
      const reply = { code: vi.fn().mockReturnThis() };
      await handler(
        { params: { taskId: 'task-1' } },
        reply as unknown as { code: () => { mockReturnThis: () => unknown } },
      );
      expect(reply.code).toHaveBeenCalledWith(404);
    });
  });

  // -------------------------------------------------------------------
  // POST /api/tasks/:taskId/schedule/trigger
  // -------------------------------------------------------------------
  describe('POST /api/tasks/:taskId/schedule/trigger', () => {
    it('returns 202 with the history ID on success', async () => {
      mockService.triggerNow.mockResolvedValue({
        ok: true,
        data: { historyId: 'history-123' },
      });
      const handler = findRoute(app, 'POST', '/tasks/:taskId/schedule/trigger');
      const reply = { code: vi.fn().mockReturnThis() };
      const result = await handler(
        { params: { taskId: 'task-1' } },
        reply as unknown as { code: () => { mockReturnThis: () => unknown } },
      );
      expect(reply.code).toHaveBeenCalledWith(202);
      expect(result).toEqual({ historyId: 'history-123' });
    });

    it('returns 404 when the task has no schedule', async () => {
      mockService.triggerNow.mockResolvedValue({
        ok: false,
        error: { code: 'schedule.not_found', message: 'no' },
      });
      const handler = findRoute(app, 'POST', '/tasks/:taskId/schedule/trigger');
      const reply = { code: vi.fn().mockReturnThis() };
      await handler(
        { params: { taskId: 'task-1' } },
        reply as unknown as { code: () => { mockReturnThis: () => unknown } },
      );
      expect(reply.code).toHaveBeenCalledWith(404);
    });

    it('returns 422 when the trigger itself failed', async () => {
      mockService.triggerNow.mockResolvedValue({
        ok: false,
        error: { code: 'execution.failed', message: 'boom' },
      });
      const handler = findRoute(app, 'POST', '/tasks/:taskId/schedule/trigger');
      const reply = { code: vi.fn().mockReturnThis() };
      await handler(
        { params: { taskId: 'task-1' } },
        reply as unknown as { code: () => { mockReturnThis: () => unknown } },
      );
      expect(reply.code).toHaveBeenCalledWith(422);
    });
  });

  // -------------------------------------------------------------------
  // GET /api/tasks/:taskId/schedule/executions
  // -------------------------------------------------------------------
  describe('GET /api/tasks/:taskId/schedule/executions', () => {
    it('returns paginated executions with default limit/offset', async () => {
      mockService.listExecutions.mockResolvedValue({
        ok: true,
        data: {
          items: [mockExecution],
          total: 1,
          limit: 20,
          offset: 0,
        },
      });
      const handler = findRoute(
        app,
        'GET',
        '/tasks/:taskId/schedule/executions',
      );
      const result = await handler(
        { params: { taskId: 'task-1' }, query: {} },
        { code: vi.fn().mockReturnThis() } as unknown as {
          code: () => { mockReturnThis: () => unknown };
        },
      );
      expect(result).toEqual({
        executions: [mockExecution],
        total: 1,
        limit: 20,
        offset: 0,
      });
      expect(mockService.listExecutions).toHaveBeenCalledWith('task-1', {
        limit: 20,
        offset: 0,
      });
    });

    it('parses status, limit, offset from query', async () => {
      mockService.listExecutions.mockResolvedValue({
        ok: true,
        data: { items: [], total: 0, limit: 5, offset: 10 },
      });
      const handler = findRoute(
        app,
        'GET',
        '/tasks/:taskId/schedule/executions',
      );
      await handler(
        {
          params: { taskId: 'task-1' },
          query: { status: 'failed', limit: '5', offset: '10' },
        },
        { code: vi.fn().mockReturnThis() } as unknown as {
          code: () => { mockReturnThis: () => unknown };
        },
      );
      expect(mockService.listExecutions).toHaveBeenCalledWith('task-1', {
        status: 'failed',
        limit: 5,
        offset: 10,
      });
    });

    it('rejects out-of-range limit with 400', async () => {
      const handler = findRoute(
        app,
        'GET',
        '/tasks/:taskId/schedule/executions',
      );
      const reply = { code: vi.fn().mockReturnThis() };
      await handler(
        { params: { taskId: 'task-1' }, query: { limit: '999' } },
        reply as unknown as { code: () => { mockReturnThis: () => unknown } },
      );
      expect(reply.code).toHaveBeenCalledWith(400);
      expect(mockService.listExecutions).not.toHaveBeenCalled();
    });

    it('rejects invalid status with 400', async () => {
      const handler = findRoute(
        app,
        'GET',
        '/tasks/:taskId/schedule/executions',
      );
      const reply = { code: vi.fn().mockReturnThis() };
      await handler(
        {
          params: { taskId: 'task-1' },
          query: { status: 'bogus-status' },
        },
        reply as unknown as { code: () => { mockReturnThis: () => unknown } },
      );
      expect(reply.code).toHaveBeenCalledWith(400);
    });
  });
});
