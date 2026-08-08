/**
 * Addon proxy routes — pulse endpoints
 *
 * Tests the HTTP layer for:
 *   GET    /api/addon-proxy/pulses
 *   GET    /api/addon-proxy/pulses/:id
 *   POST   /api/addon-proxy/pulses
 *   PATCH  /api/addon-proxy/pulses/:id
 *   DELETE /api/addon-proxy/pulses/:id
 *   POST   /api/addon-proxy/pulses/:id/trigger
 *   GET    /api/addon-proxy/pulses/:id/history
 *
 * Uses a minimal Fastify instance with the addonProxyRoutes plugin, a mocked
 * PulseService is not injected directly — instead we wire in-memory
 * jobsRepo/jobRunsRepo/sessionsRepo stubs, exactly like the real PulseService
 * is constructed inside proxy-routes.ts, so this exercises the same
 * construction path as production.
 */

import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { addonProxyRoutes } from './proxy-routes';
import { AddonService } from './service';
import type {
  Addon,
  JobsStore,
  JobRunsStore,
  SessionsStore,
} from '@openaidy/db';

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

const PULSE_JOB = {
  id: 'pulse-1',
  type: 'cron' as const,
  schedule: null,
  cronExpression: '0 * * * *',
  targetType: 'isolated' as const,
  targetSessionId: null,
  payload: { message: 'Do the thing', agentId: undefined },
  status: 'active' as const,
  nextRunAt: new Date('2026-01-01T00:00:00Z'),
  lastRunAt: null,
  retryCount: 0,
  maxRetries: 3,
  backoffMs: 1000,
  metadata: { kind: 'pulse', name: 'My Pulse', prompt: 'Do the thing' },
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

function makeJobsRepo(job: typeof PULSE_JOB | null = PULSE_JOB): JobsStore {
  return {
    findById: vi.fn().mockResolvedValue(job),
    create: vi.fn().mockResolvedValue(job),
    update: vi.fn().mockResolvedValue(job),
    delete: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue(job ? [job] : []),
    claimNextDueJob: vi.fn(),
    countByStatus: vi.fn(),
    listActive: vi.fn(),
  } as unknown as JobsStore;
}

function makeJobRunsRepo(): JobRunsStore {
  return {
    findById: vi.fn().mockResolvedValue({
      id: 'run-1',
      jobId: 'pulse-1',
      status: 'succeeded',
      attemptNumber: 0,
      startedAt: new Date(),
      finishedAt: new Date(),
      errorCode: null,
      errorMessage: null,
      resultData: null,
      createdAt: new Date(),
    }),
    create: vi.fn().mockResolvedValue({
      id: 'run-1',
      jobId: 'pulse-1',
      status: 'queued',
      attemptNumber: 0,
      startedAt: null,
      finishedAt: null,
      errorCode: null,
      errorMessage: null,
      resultData: null,
      createdAt: new Date(),
    }),
    updateStatus: vi.fn().mockResolvedValue(undefined),
    listByJob: vi.fn().mockResolvedValue([]),
    getLatestByJob: vi.fn(),
    countByJobAndStatus: vi.fn(),
    listByStatus: vi.fn(),
    deleteByJob: vi.fn(),
  } as unknown as JobRunsStore;
}

function makeSessionsRepo(): SessionsStore {
  return {
    findById: vi.fn().mockResolvedValue(null),
  } as unknown as SessionsStore;
}

async function buildProxyApp(opts: {
  addon: Addon | null;
  withPulseDeps?: boolean;
  jobsRepo?: JobsStore;
}): Promise<{ app: FastifyInstance; token: string; jobsRepo: JobsStore }> {
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

  const jobsRepo = opts.jobsRepo ?? makeJobsRepo();
  const jobRunsRepo = makeJobRunsRepo();
  const sessionsRepo = makeSessionsRepo();

  const app = Fastify({ logger: false });
  await app.register(
    async (api: FastifyInstance) => {
      await api.register(addonProxyRoutes, {
        addonService: addonSvc,
        authMiddleware: null as never,
        internalApiBaseUrl: '',
        ...(opts.withPulseDeps !== false
          ? { jobsRepo, jobRunsRepo, sessionsRepo }
          : {}),
      });
    },
    { prefix: '/api' },
  );

  return { app, token, jobsRepo };
}

describe('GET /api/addon-proxy/pulses', () => {
  it('returns 403 when addon lacks pulses.list permission', async () => {
    const { app, token } = await buildProxyApp({
      addon: makeEnabledAddon('test-addon', ['pulses.read']),
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/addon-proxy/pulses',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('PERMISSION_DENIED');
  });

  it('returns an empty page when pulse deps are not wired', async () => {
    const { app, token } = await buildProxyApp({
      addon: makeEnabledAddon('test-addon', ['pulses.list']),
      withPulseDeps: false,
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/addon-proxy/pulses',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ pulses: [], total: 0, limit: 50, offset: 0 });
  });

  it('lists pulses', async () => {
    const { app, token } = await buildProxyApp({
      addon: makeEnabledAddon('test-addon', ['pulses.list']),
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/addon-proxy/pulses',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().pulses).toHaveLength(1);
    expect(res.json().pulses[0].id).toBe('pulse-1');
  });
});

describe('GET /api/addon-proxy/pulses/:id', () => {
  it('returns 404 when the pulse is not found', async () => {
    const { app, token } = await buildProxyApp({
      addon: makeEnabledAddon('test-addon', ['pulses.read']),
      jobsRepo: makeJobsRepo(null),
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/addon-proxy/pulses/missing',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('PULSE_NOT_FOUND');
  });

  it('returns the pulse', async () => {
    const { app, token } = await buildProxyApp({
      addon: makeEnabledAddon('test-addon', ['pulses.read']),
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/addon-proxy/pulses/pulse-1',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().pulse.id).toBe('pulse-1');
  });
});

describe('POST /api/addon-proxy/pulses', () => {
  it('returns 400 for an invalid body', async () => {
    const { app, token } = await buildProxyApp({
      addon: makeEnabledAddon('test-addon', ['pulses.write']),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/addon-proxy/pulses',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'My Pulse' }, // missing prompt/schedule
    });
    expect(res.statusCode).toBe(400);
  });

  it('creates a pulse', async () => {
    const jobsRepo = makeJobsRepo();
    const { app, token } = await buildProxyApp({
      addon: makeEnabledAddon('test-addon', ['pulses.write']),
      jobsRepo,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/addon-proxy/pulses',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: 'My Pulse',
        prompt: 'Do the thing',
        schedule: { every: '1h' },
      },
    });
    expect(res.statusCode).toBe(201);
    expect(jobsRepo.create).toHaveBeenCalled();
  });
});

describe('DELETE /api/addon-proxy/pulses/:id', () => {
  it('deletes a pulse', async () => {
    const jobsRepo = makeJobsRepo();
    const { app, token } = await buildProxyApp({
      addon: makeEnabledAddon('test-addon', ['pulses.delete']),
      jobsRepo,
    });
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/addon-proxy/pulses/pulse-1',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(204);
    expect(jobsRepo.delete).toHaveBeenCalledWith('pulse-1');
  });

  it('returns 404 when the pulse does not exist', async () => {
    const { app, token } = await buildProxyApp({
      addon: makeEnabledAddon('test-addon', ['pulses.delete']),
      jobsRepo: makeJobsRepo(null),
    });
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/addon-proxy/pulses/missing',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/addon-proxy/pulses/:id/trigger', () => {
  it('returns 503 when session service is not wired', async () => {
    const { app, token } = await buildProxyApp({
      addon: makeEnabledAddon('test-addon', ['pulses.invoke']),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/addon-proxy/pulses/pulse-1/trigger',
      headers: { authorization: `Bearer ${token}` },
    });
    // No sessionService was wired in buildProxyApp for this suite.
    expect(res.statusCode).toBe(503);
  });
});

describe('GET /api/addon-proxy/pulses/:id/history', () => {
  it('returns run history', async () => {
    const { app, token } = await buildProxyApp({
      addon: makeEnabledAddon('test-addon', ['pulses.read']),
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/addon-proxy/pulses/pulse-1/history',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ runs: [], total: 0, limit: 50, offset: 0 });
  });
});
