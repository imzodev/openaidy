/**
 * Addon proxy routes — task endpoints
 *
 * Tests the HTTP layer for:
 *   GET   /api/addon-proxy/tasks
 *   GET   /api/addon-proxy/tasks/:id
 *   POST  /api/addon-proxy/tasks
 *   PATCH /api/addon-proxy/tasks/:id/status
 *   GET   /api/addon-proxy/tasks/:id/subtasks
 *   POST  /api/addon-proxy/tasks/:id/execute
 *
 * Uses a minimal Fastify instance with the addonProxyRoutes plugin so we
 * exercise the full request → auth → permission → service path without
 * spinning up the entire application.
 */

import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { addonProxyRoutes } from './proxy-routes';
import { AddonService } from './service';
import type { TaskService } from '../tasks/service';
import type { Addon } from '@openaidy/db';

const JWT_SECRET = 'test-secret-at-least-32-chars-long!!';

function makeAddonService() {
  return new AddonService({
    repository: null as never,
    validator: null as never,
    jwtSecret: JWT_SECRET,
    openAidyVersion: '0.0.0',
  });
}

function makeEnabledAddon(addonId: string, permissions: string[]): Addon {
  return {
    id: 'db-row-id',
    addonId,
    name: 'Test Addon',
    version: '1.0.0',
    status: 'enabled',
    permissions,
    manifest: { permissions },
    config: {},
    installedAt: new Date(),
    updatedAt: new Date(),
    installedBy: 'admin',
  } as unknown as Addon;
}

function makeTaskService(): TaskService {
  return {
    listTasks: vi.fn().mockResolvedValue([{ id: 't1', title: 'Task One' }]),
    getTaskWithDetails: vi.fn().mockResolvedValue({
      id: 't1',
      title: 'Task One',
      subtasks: [],
      progress: { total: 0, completed: 0, inProgress: 0, failed: 0 },
    }),
    createTask: vi.fn().mockResolvedValue({
      ok: true,
      data: { id: 't1', title: 'New Task', description: 'A new task' },
    }),
    updateTaskStatus: vi.fn().mockResolvedValue({
      ok: true,
      data: { id: 't1', status: 'in_progress' },
    }),
    getSubtasks: vi
      .fn()
      .mockResolvedValue([{ id: 's1', title: 'Subtask One' }]),
    executeTask: vi
      .fn()
      .mockResolvedValue({ ok: true, data: { sessionId: 'sess-1' } }),
  } as unknown as TaskService;
}

async function buildProxyApp(opts: {
  addon: Addon | null;
  taskService?: TaskService;
}): Promise<{ app: FastifyInstance; token: string }> {
  const addonSvc = makeAddonService();

  const permissions = (opts.addon?.permissions as string[]) ?? [];
  const addonId = opts.addon?.addonId ?? 'test-addon';
  const token = (
    addonSvc as unknown as {
      generateAccessToken: (id: string, perms: string[]) => string;
    }
  ).generateAccessToken(addonId, permissions);

  vi.spyOn(addonSvc as never, 'getAddon' as never).mockResolvedValue(
    opts.addon as never,
  );
  vi.spyOn(addonSvc as never, 'recordUsage' as never).mockResolvedValue(
    undefined as never,
  );

  const app = Fastify({ logger: false });
  await app.register(
    async (api: FastifyInstance) => {
      await api.register(addonProxyRoutes, {
        addonService: addonSvc,
        authMiddleware: null as never,
        internalApiBaseUrl: '',
        ...(opts.taskService ? { taskService: opts.taskService } : {}),
      });
    },
    { prefix: '/api' },
  );

  return { app, token };
}

describe('GET /api/addon-proxy/tasks', () => {
  it('returns 403 when addon lacks tasks.list permission', async () => {
    const { app, token } = await buildProxyApp({
      addon: makeEnabledAddon('test-addon', ['tasks.read']),
      taskService: makeTaskService(),
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/addon-proxy/tasks',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('PERMISSION_DENIED');
  });

  it('returns empty items when no taskService is wired', async () => {
    const { app, token } = await buildProxyApp({
      addon: makeEnabledAddon('test-addon', ['tasks.list']),
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/addon-proxy/tasks',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [] });
  });

  it('lists tasks from the taskService', async () => {
    const taskService = makeTaskService();
    const { app, token } = await buildProxyApp({
      addon: makeEnabledAddon('test-addon', ['tasks.list']),
      taskService,
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/addon-proxy/tasks?status=todo',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toHaveLength(1);
    expect(taskService.listTasks).toHaveBeenCalledWith('todo');
  });
});

describe('GET /api/addon-proxy/tasks/:id', () => {
  it('returns 404 when the task is not found', async () => {
    const taskService = makeTaskService();
    (
      taskService.getTaskWithDetails as ReturnType<typeof vi.fn>
    ).mockResolvedValue(null);
    const { app, token } = await buildProxyApp({
      addon: makeEnabledAddon('test-addon', ['tasks.read']),
      taskService,
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/addon-proxy/tasks/missing',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('TASK_NOT_FOUND');
  });

  it('returns the task with details', async () => {
    const { app, token } = await buildProxyApp({
      addon: makeEnabledAddon('test-addon', ['tasks.read']),
      taskService: makeTaskService(),
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/addon-proxy/tasks/t1',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().task.id).toBe('t1');
  });
});

describe('POST /api/addon-proxy/tasks', () => {
  it('returns 400 when description is missing', async () => {
    const { app, token } = await buildProxyApp({
      addon: makeEnabledAddon('test-addon', ['tasks.write']),
      taskService: makeTaskService(),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/addon-proxy/tasks',
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('INVALID_REQUEST');
  });

  it('derives a title from the description when none is given', async () => {
    const taskService = makeTaskService();
    const { app, token } = await buildProxyApp({
      addon: makeEnabledAddon('test-addon', ['tasks.write']),
      taskService,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/addon-proxy/tasks',
      headers: { authorization: `Bearer ${token}` },
      payload: { description: 'Do the thing' },
    });
    expect(res.statusCode).toBe(201);
    expect(taskService.createTask).toHaveBeenCalledWith({
      title: 'Do the thing',
      description: 'Do the thing',
    });
  });

  it('creates a task with an explicit title and priority', async () => {
    const taskService = makeTaskService();
    const { app, token } = await buildProxyApp({
      addon: makeEnabledAddon('test-addon', ['tasks.write']),
      taskService,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/addon-proxy/tasks',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        title: 'My Task',
        description: 'Do the thing',
        priority: 'urgent',
      },
    });
    expect(res.statusCode).toBe(201);
    expect(taskService.createTask).toHaveBeenCalledWith({
      title: 'My Task',
      description: 'Do the thing',
      priority: 'urgent',
    });
  });
});

describe('PATCH /api/addon-proxy/tasks/:id/status', () => {
  it('returns 404 when the task is not found', async () => {
    const taskService = makeTaskService();
    (
      taskService.updateTaskStatus as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      ok: false,
      error: { code: 'task.not_found', message: 'Task not found' },
    });
    const { app, token } = await buildProxyApp({
      addon: makeEnabledAddon('test-addon', ['tasks.write']),
      taskService,
    });
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/addon-proxy/tasks/missing/status',
      headers: { authorization: `Bearer ${token}` },
      payload: { status: 'done' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('updates the task status', async () => {
    const { app, token } = await buildProxyApp({
      addon: makeEnabledAddon('test-addon', ['tasks.write']),
      taskService: makeTaskService(),
    });
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/addon-proxy/tasks/t1/status',
      headers: { authorization: `Bearer ${token}` },
      payload: { status: 'in_progress' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().task.status).toBe('in_progress');
  });
});

describe('GET /api/addon-proxy/tasks/:id/subtasks', () => {
  it('returns 403 when addon lacks tasks.read permission', async () => {
    const { app, token } = await buildProxyApp({
      addon: makeEnabledAddon('test-addon', ['tasks.write']),
      taskService: makeTaskService(),
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/addon-proxy/tasks/t1/subtasks',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('lists subtasks', async () => {
    const { app, token } = await buildProxyApp({
      addon: makeEnabledAddon('test-addon', ['tasks.read']),
      taskService: makeTaskService(),
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/addon-proxy/tasks/t1/subtasks',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toHaveLength(1);
  });
});

describe('POST /api/addon-proxy/tasks/:id/execute', () => {
  it('returns 503 when session service is not configured', async () => {
    const taskService = makeTaskService();
    (taskService.executeTask as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: {
        code: 'session.not_configured',
        message: 'Session service is not configured',
      },
    });
    const { app, token } = await buildProxyApp({
      addon: makeEnabledAddon('test-addon', ['tasks.invoke']),
      taskService,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/addon-proxy/tasks/t1/execute',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(503);
  });

  it('executes the task and returns a sessionId', async () => {
    const { app, token } = await buildProxyApp({
      addon: makeEnabledAddon('test-addon', ['tasks.invoke']),
      taskService: makeTaskService(),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/addon-proxy/tasks/t1/execute',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().sessionId).toBe('sess-1');
  });
});
