import { describe, it, expect } from 'vitest';
import { createPulseTools, type PulseToolDeps } from './index.js';
import type {
  JobsStore,
  SessionsStore,
  JobRunsStore,
  ScheduledJob,
} from '@openaidy/db';
import { PulseService } from '../../pulses/service.js';

function makeMockJob(overrides: Partial<ScheduledJob> = {}): ScheduledJob {
  return {
    id: `job-${Math.random().toString(36).slice(2)}`,
    type: 'cron',
    status: 'active',
    metadata: { kind: 'pulse', name: 'Test Pulse' },
    payload: { message: 'Test prompt' },
    nextRunAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    targetType: 'isolated',
    targetSessionId: null,
    cronExpression: null,
    schedule: null,
    retryCount: 0,
    maxRetries: 3,
    backoffMs: 60000,
    lastRunAt: null,
    ...overrides,
  };
}

function createMockJobsRepo(pulses: ScheduledJob[] = []): JobsStore {
  const list = [...pulses];
  return {
    list: async (filters?: Parameters<JobsStore['list']>[0]) => {
      let result = list;
      if (filters?.status !== undefined) {
        result = result.filter((j) => j.status === filters.status);
      }
      return result;
    },
    findById: async (id: string) => list.find((j) => j.id === id) ?? null,
    create: async (input: Parameters<JobsStore['create']>[0]) => {
      const job = makeMockJob({
        id: `job-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        type: input.type ?? 'cron',
        status: input.status ?? 'active',
        metadata: input.metadata ?? { kind: 'pulse' },
        payload: input.payload ?? {},
        nextRunAt: input.nextRunAt ?? new Date(),
        targetType: input.targetType ?? 'isolated',
        targetSessionId: input.targetSessionId ?? null,
        cronExpression: input.cronExpression ?? null,
        schedule: input.schedule ?? null,
      });
      list.push(job);
      return job;
    },
    update: async (id: string, updates: Parameters<JobsStore['update']>[1]) => {
      const job = list.find((j) => j.id === id);
      if (!job) throw new Error('Not found');
      Object.assign(job, updates, { updatedAt: new Date() });
      return job;
    },
    delete: async (id: string) => {
      const idx = list.findIndex((j) => j.id === id);
      if (idx !== -1) list.splice(idx, 1);
    },
  } as unknown as JobsStore;
}

function createMockJobRunsRepo(): JobRunsStore {
  return {
    listByJob: async () => [],
  } as unknown as JobRunsStore;
}

function createMockSessionsRepo(): SessionsStore {
  return { findById: async () => null } as unknown as SessionsStore;
}

const CTX = { agentId: 'test-agent', sessionId: 'test-session' };

function makeDeps(service: PulseService): PulseToolDeps {
  return {
    getPulseService: () => service,
  };
}

/** Creates a real PulseService backed by mock stores */
function createService(
  jobsRepo: JobsStore,
  sessionsRepo?: SessionsStore,
): PulseService {
  return new PulseService(
    jobsRepo,
    createMockJobRunsRepo(),
    sessionsRepo ?? createMockSessionsRepo(),
  );
}

describe('pulses tools', () => {
  // ─── pulses_list ─────────────────────────────────────────────────────────

  describe('pulses_list', () => {
    it('has correct name', () => {
      const tools = createPulseTools(
        makeDeps(createService(createMockJobsRepo())),
      );
      const tool = tools.find((t) => t.name === 'pulses_list')!;
      expect(tool).toBeDefined();
    });

    it('returns error when database is not available', async () => {
      const tools = createPulseTools({
        getPulseService: () => undefined as unknown as PulseService,
      });
      const tool = tools.find((t) => t.name === 'pulses_list')!;
      const result = await tool.execute({}, CTX);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain('Database is not available');
    });

    it('returns empty message when no pulses exist', async () => {
      const jobsRepo = createMockJobsRepo([]);
      const tools = createPulseTools(makeDeps(createService(jobsRepo)));
      const tool = tools.find((t) => t.name === 'pulses_list')!;
      const result = await tool.execute({}, CTX);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.content).toContain('No pulses found');
    });

    it('filters by status when provided', async () => {
      const jobsRepo = createMockJobsRepo([
        makeMockJob({
          id: 'pulse-active',
          status: 'active',
          metadata: { kind: 'pulse', name: 'Active Pulse' },
        }),
        makeMockJob({
          id: 'pulse-paused',
          status: 'paused',
          metadata: { kind: 'pulse', name: 'Paused Pulse' },
        }),
      ]);
      const tools = createPulseTools(makeDeps(createService(jobsRepo)));
      const tool = tools.find((t) => t.name === 'pulses_list')!;
      const result = await tool.execute({ status: 'active' }, CTX);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.content).toContain('Active Pulse');
      expect(result.content).not.toContain('Paused Pulse');
    });

    it('returns ok=true for invalid status (model handles enum)', async () => {
      const jobsRepo = createMockJobsRepo([]);
      const tools = createPulseTools(makeDeps(createService(jobsRepo)));
      const tool = tools.find((t) => t.name === 'pulses_list')!;
      const result = await tool.execute(
        { status: 'invalid' } as Record<string, unknown>,
        CTX,
      );
      expect(result.ok).toBe(true);
    });
  });

  // ─── pulses_create ──────────────────────────────────────────────────────

  describe('pulses_create', () => {
    it('has correct name', () => {
      const tools = createPulseTools(
        makeDeps(createService(createMockJobsRepo())),
      );
      const tool = tools.find((t) => t.name === 'pulses_create')!;
      expect(tool).toBeDefined();
    });

    it('returns error when database is not available', async () => {
      const tools = createPulseTools({
        getPulseService: () => undefined as unknown as PulseService,
      });
      const tool = tools.find((t) => t.name === 'pulses_create')!;
      const result = await tool.execute(
        { name: 'Test', prompt: 'Hello', schedule: { every: '1h' } },
        CTX,
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain('Database is not available');
    });

    it('rejects missing name', async () => {
      const jobsRepo = createMockJobsRepo();
      const tools = createPulseTools(makeDeps(createService(jobsRepo)));
      const tool = tools.find((t) => t.name === 'pulses_create')!;
      const result = await tool.execute(
        { prompt: 'Hello', schedule: { every: '1h' } },
        CTX,
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain('name');
    });

    it('rejects missing prompt', async () => {
      const jobsRepo = createMockJobsRepo();
      const tools = createPulseTools(makeDeps(createService(jobsRepo)));
      const tool = tools.find((t) => t.name === 'pulses_create')!;
      const result = await tool.execute(
        { name: 'Test', schedule: { every: '1h' } },
        CTX,
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain('prompt');
    });

    it('rejects invalid schedule format', async () => {
      const jobsRepo = createMockJobsRepo();
      const tools = createPulseTools(makeDeps(createService(jobsRepo)));
      const tool = tools.find((t) => t.name === 'pulses_create')!;
      const result = await tool.execute(
        { name: 'Test', prompt: 'Hello', schedule: {} },
        CTX,
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain('Invalid schedule');
    });

    it('creates a pulse with every schedule', async () => {
      const jobsRepo = createMockJobsRepo();
      const tools = createPulseTools(makeDeps(createService(jobsRepo)));
      const tool = tools.find((t) => t.name === 'pulses_create')!;
      const result = await tool.execute(
        {
          name: 'Daily Check',
          prompt: 'Check something',
          schedule: { every: '1h' },
        },
        CTX,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.content).toContain('Daily Check');
      expect(result.content).toContain('Successfully created');
    });

    it('creates a pulse with daily schedule', async () => {
      const jobsRepo = createMockJobsRepo();
      const tools = createPulseTools(makeDeps(createService(jobsRepo)));
      const tool = tools.find((t) => t.name === 'pulses_create')!;
      const result = await tool.execute(
        {
          name: 'Morning Report',
          prompt: 'Send report',
          schedule: { daily: { hour: 9, minute: 0 } },
        },
        CTX,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.content).toContain('Morning Report');
    });

    it('creates a pulse with cron schedule', async () => {
      const jobsRepo = createMockJobsRepo();
      const tools = createPulseTools(makeDeps(createService(jobsRepo)));
      const tool = tools.find((t) => t.name === 'pulses_create')!;
      const result = await tool.execute(
        {
          name: 'Cron Job',
          prompt: 'Run task',
          schedule: { cron: '0 9 * * *' },
        },
        CTX,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.content).toContain('Cron Job');
    });
  });

  // ─── pulses_update ──────────────────────────────────────────────────────

  describe('pulses_update', () => {
    it('has correct name', () => {
      const tools = createPulseTools(
        makeDeps(createService(createMockJobsRepo())),
      );
      const tool = tools.find((t) => t.name === 'pulses_update')!;
      expect(tool).toBeDefined();
    });

    it('returns error when database is not available', async () => {
      const tools = createPulseTools({
        getPulseService: () => undefined as unknown as PulseService,
      });
      const tool = tools.find((t) => t.name === 'pulses_update')!;
      const result = await tool.execute(
        { id: 'some-id', name: 'New Name' },
        CTX,
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain('Database is not available');
    });

    it('rejects missing id', async () => {
      const jobsRepo = createMockJobsRepo();
      const tools = createPulseTools(makeDeps(createService(jobsRepo)));
      const tool = tools.find((t) => t.name === 'pulses_update')!;
      const result = await tool.execute({ name: 'New Name' }, CTX);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain('ID is required');
    });

    it('returns error when pulse does not exist', async () => {
      const jobsRepo = createMockJobsRepo([]);
      const tools = createPulseTools(makeDeps(createService(jobsRepo)));
      const tool = tools.find((t) => t.name === 'pulses_update')!;
      const result = await tool.execute(
        { id: 'non-existent-id', name: 'New Name' },
        CTX,
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain('not found');
    });

    it('returns error when job is not a pulse', async () => {
      const jobsRepo = createMockJobsRepo([
        makeMockJob({ id: 'regular-job', metadata: { kind: 'other' } }),
      ]);
      const tools = createPulseTools(makeDeps(createService(jobsRepo)));
      const tool = tools.find((t) => t.name === 'pulses_update')!;
      const result = await tool.execute(
        { id: 'regular-job', name: 'New Name' },
        CTX,
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain('not found');
    });

    it('updates pulse name', async () => {
      const jobsRepo = createMockJobsRepo([
        makeMockJob({
          id: 'pulse-1',
          metadata: { kind: 'pulse', name: 'Old Name' },
        }),
      ]);
      const tools = createPulseTools(makeDeps(createService(jobsRepo)));
      const tool = tools.find((t) => t.name === 'pulses_update')!;
      const result = await tool.execute(
        { id: 'pulse-1', name: 'New Name' },
        CTX,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.content).toContain('New Name');
    });

    it('updates pulse status to paused', async () => {
      const jobsRepo = createMockJobsRepo([
        makeMockJob({
          id: 'pulse-1',
          metadata: { kind: 'pulse', name: 'My Pulse' },
        }),
      ]);
      const tools = createPulseTools(makeDeps(createService(jobsRepo)));
      const tool = tools.find((t) => t.name === 'pulses_update')!;
      const result = await tool.execute(
        { id: 'pulse-1', status: 'paused' },
        CTX,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.content).toContain('paused');
    });

    it('returns ok=true for invalid status (model handles enum)', async () => {
      const jobsRepo = createMockJobsRepo([
        makeMockJob({
          id: 'pulse-1',
          metadata: { kind: 'pulse', name: 'My Pulse' },
        }),
      ]);
      const tools = createPulseTools(makeDeps(createService(jobsRepo)));
      const tool = tools.find((t) => t.name === 'pulses_update')!;
      const result = await tool.execute(
        { id: 'pulse-1', status: 'invalid' } as Record<string, unknown>,
        CTX,
      );
      expect(result.ok).toBe(true);
    });
  });

  // ─── pulses_delete ──────────────────────────────────────────────────────

  describe('pulses_delete', () => {
    it('has correct name', () => {
      const tools = createPulseTools(
        makeDeps(createService(createMockJobsRepo())),
      );
      const tool = tools.find((t) => t.name === 'pulses_delete')!;
      expect(tool).toBeDefined();
    });

    it('returns error when database is not available', async () => {
      const tools = createPulseTools({
        getPulseService: () => undefined as unknown as PulseService,
      });
      const tool = tools.find((t) => t.name === 'pulses_delete')!;
      const result = await tool.execute({ id: 'some-id', confirm: true }, CTX);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain('Database is not available');
    });

    it('rejects missing id', async () => {
      const jobsRepo = createMockJobsRepo();
      const tools = createPulseTools(makeDeps(createService(jobsRepo)));
      const tool = tools.find((t) => t.name === 'pulses_delete')!;
      const result = await tool.execute({ confirm: true }, CTX);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain('ID is required');
    });

    it('rejects deletion without confirm=true', async () => {
      const jobsRepo = createMockJobsRepo([
        makeMockJob({
          id: 'pulse-1',
          metadata: { kind: 'pulse', name: 'My Pulse' },
        }),
      ]);
      const tools = createPulseTools(makeDeps(createService(jobsRepo)));
      const tool = tools.find((t) => t.name === 'pulses_delete')!;
      const result = await tool.execute({ id: 'pulse-1' }, CTX);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain('confirm');
    });

    it('returns error when pulse does not exist', async () => {
      const jobsRepo = createMockJobsRepo([]);
      const tools = createPulseTools(makeDeps(createService(jobsRepo)));
      const tool = tools.find((t) => t.name === 'pulses_delete')!;
      const result = await tool.execute(
        { id: 'non-existent-id', confirm: true },
        CTX,
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain('not found');
    });

    it('returns error when job is not a pulse', async () => {
      const jobsRepo = createMockJobsRepo([
        makeMockJob({ id: 'regular-job', metadata: { kind: 'other' } }),
      ]);
      const tools = createPulseTools(makeDeps(createService(jobsRepo)));
      const tool = tools.find((t) => t.name === 'pulses_delete')!;
      const result = await tool.execute(
        { id: 'regular-job', confirm: true },
        CTX,
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain('not found');
    });

    it('successfully deletes a pulse', async () => {
      const jobsRepo = createMockJobsRepo([
        makeMockJob({
          id: 'pulse-1',
          metadata: { kind: 'pulse', name: 'To Delete' },
        }),
      ]);
      const tools = createPulseTools(makeDeps(createService(jobsRepo)));
      const tool = tools.find((t) => t.name === 'pulses_delete')!;
      const result = await tool.execute({ id: 'pulse-1', confirm: true }, CTX);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.content).toContain('Successfully deleted');
    });
  });

  // ─── createPulseTools factory ────────────────────────────────────────────

  describe('createPulseTools', () => {
    it('returns all four pulse tools', () => {
      const tools = createPulseTools(
        makeDeps(createService(createMockJobsRepo())),
      );
      const names = tools.map((t) => t.name);
      expect(names).toContain('pulses_list');
      expect(names).toContain('pulses_create');
      expect(names).toContain('pulses_update');
      expect(names).toContain('pulses_delete');
      expect(tools).toHaveLength(4);
    });
  });
});
