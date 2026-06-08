/**
 * PulseRunnableAdapter unit tests.
 *
 * Tests the contract:
 * - `claimNextDue` returns the next due job from the repo.
 * - `execute` dispatches to the session message service for both
 *   `targetType: 'session'` and `targetType: 'isolated'`.
 * - `execute` converts thrown/errored submissions into a failure
 *   `ExecutionResult` (does not rethrow).
 * - `reschedule` on success advances `nextRunAt` (cron) or marks
 *   the job `completed` (one-shot).
 * - `reschedule` on failure with retries left bumps `retryCount`
 *   and schedules the next run with exponential backoff.
 * - `reschedule` on failure with retries exhausted marks the job
 *   `failed`.
 *
 * All tests use mock repos and a mock session message service —
 * no real DB, no real I/O.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createPulseRunnableAdapter,
  PULSE_RUNNABLE_KIND,
  type PulsePayload,
  type PulseRunnableDeps,
} from './pulse-runnable-adapter';
import type { JobsStore, SessionsStore, ScheduledJob } from '@openaidy/db';
import type { SessionMessageService } from '../sessions/service';

// ============================================================================
// Fakes
// ============================================================================

function makeJob(overrides: Partial<ScheduledJob> = {}): ScheduledJob {
  return {
    id: 'job-1',
    type: 'cron',
    status: 'active',
    targetType: 'isolated',
    targetSessionId: null,
    payload: { message: 'hello' },
    cronExpression: '*/5 * * * *',
    schedule: null,
    nextRunAt: new Date('2026-06-05T10:00:00.000Z'),
    lastRunAt: null,
    retryCount: 0,
    maxRetries: 3,
    backoffMs: 1000,
    metadata: { kind: 'pulse', name: 'test' },
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    ...overrides,
  } as ScheduledJob;
}

function makeJobsRepo(): JobsStore {
  return {
    claimNextDueJob: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn(),
    list: vi.fn(),
    listActive: vi.fn(),
    countByStatus: vi.fn(),
  } as unknown as JobsStore;
}

function makeSessionsStore(): SessionsStore {
  return {
    create: vi.fn().mockResolvedValue({ id: 'session-1', title: 'Pulse' }),
    findById: vi.fn(),
    list: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  } as unknown as SessionsStore;
}

function makeSessionService(
  result:
    | { ok: true }
    | { ok: false; error: { code: string; message: string } } = {
    ok: true,
  },
): {
  service: SessionMessageService;
  submitSpy: ReturnType<typeof vi.fn>;
} {
  const submitSpy = vi.fn().mockResolvedValue(result);
  return {
    service: {
      submitMessageStreaming: submitSpy,
    } as unknown as SessionMessageService,
    submitSpy,
  };
}

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function makeDeps(overrides: Partial<PulseRunnableDeps> = {}): {
  deps: PulseRunnableDeps;
  jobsRepo: JobsStore;
  sessionsStore: SessionsStore;
  submitSpy: ReturnType<typeof vi.fn>;
  log: {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    debug: ReturnType<typeof vi.fn>;
  };
} {
  const jobsRepo = (overrides.jobsRepo ?? makeJobsRepo()) as JobsStore;
  const sessionsStore = (overrides.sessionsStore ??
    makeSessionsStore()) as SessionsStore;
  const { service, submitSpy } =
    overrides.sessionMessageService !== undefined
      ? {
          service: overrides.sessionMessageService as SessionMessageService,
          submitSpy: vi.fn(),
        }
      : makeSessionService();
  const log = overrides.logger ?? makeLogger();
  return {
    deps: {
      jobsRepo,
      sessionsStore,
      sessionMessageService: service,
      logger: log,
      ...overrides,
    } as PulseRunnableDeps,
    jobsRepo,
    sessionsStore,
    submitSpy,
    log: log as {
      info: ReturnType<typeof vi.fn>;
      warn: ReturnType<typeof vi.fn>;
      error: ReturnType<typeof vi.fn>;
      debug: ReturnType<typeof vi.fn>;
    },
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('PulseRunnableAdapter', () => {
  describe('contract', () => {
    it('has the pulse kind', () => {
      const { deps } = makeDeps();
      const runnable = createPulseRunnableAdapter(deps);
      expect(runnable.kind).toBe(PULSE_RUNNABLE_KIND);
      expect(runnable.kind).toBe('pulse');
    });
  });

  describe('claimNextDue', () => {
    it('returns null when no job is due', async () => {
      const { deps, jobsRepo } = makeDeps();
      vi.mocked(jobsRepo.claimNextDueJob).mockResolvedValue(null);
      const runnable = createPulseRunnableAdapter(deps);
      const claimed = await runnable.claimNextDue();
      expect(claimed).toBeNull();
    });

    it('returns the next due job wrapped in a PulsePayload', async () => {
      const { deps, jobsRepo } = makeDeps();
      const job = makeJob({ id: 'job-42' });
      vi.mocked(jobsRepo.claimNextDueJob).mockResolvedValue(job);
      const runnable = createPulseRunnableAdapter(deps);
      const claimed = await runnable.claimNextDue();
      expect(claimed).not.toBeNull();
      expect(claimed!.id).toBe('job-42');
      const payload = claimed!.payload as PulsePayload;
      expect(payload.job).toBe(job);
    });
  });

  describe('execute', () => {
    it('dispatches a session-attached pulse to the existing session', async () => {
      const { deps, submitSpy } = makeDeps();
      const job = makeJob({
        targetType: 'session',
        targetSessionId: 'session-existing',
        payload: { message: 'hello' },
      });
      const runnable = createPulseRunnableAdapter(deps);
      const result = await runnable.execute('job-1', { job });
      expect(result.ok).toBe(true);
      expect(submitSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'session-existing',
          role: 'user',
          content: 'hello',
        }),
      );
    });

    it('creates a new session for an isolated pulse and submits to it', async () => {
      const { deps, sessionsStore, submitSpy } = makeDeps();
      const job = makeJob({
        targetType: 'isolated',
        metadata: { kind: 'pulse', name: 'morning-brief' },
        payload: { message: 'gm' },
      });
      const runnable = createPulseRunnableAdapter(deps);
      const result = await runnable.execute('job-1', { job });
      expect(result.ok).toBe(true);
      expect(sessionsStore.create).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Pulse: morning-brief' }),
      );
      expect(submitSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'session-1',
          content: 'gm',
        }),
      );
    });

    it('converts a failed submission into a failure result (does not throw)', async () => {
      const { deps, submitSpy } = makeDeps();
      submitSpy.mockResolvedValue({
        ok: false,
        error: { code: 'PROVIDER_DOWN', message: 'upstream error' },
      });
      const job = makeJob({ targetType: 'isolated' });
      const runnable = createPulseRunnableAdapter(deps);
      const result = await runnable.execute('job-1', { job });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toMatch(/upstream error/);
      }
    });

    it('surfaces missing targetSessionId as a failure', async () => {
      const { deps } = makeDeps();
      const job = makeJob({ targetType: 'session', targetSessionId: null });
      const runnable = createPulseRunnableAdapter(deps);
      const result = await runnable.execute('job-1', { job });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toMatch(/missing targetSessionId/);
      }
    });
  });

  describe('reschedule (success path)', () => {
    it('advances nextRunAt for a cron job', async () => {
      const { deps, jobsRepo } = makeDeps();
      const job = makeJob({
        cronExpression: '*/5 * * * *',
        nextRunAt: new Date('2026-06-05T10:00:00.000Z'),
      });
      const runnable = createPulseRunnableAdapter(deps);
      const next = await runnable.reschedule(
        'job-1',
        { job },
        {
          ok: true,
          durationMs: 5,
        },
      );
      expect(next).toBeInstanceOf(Date);
      // nextRunAt was updated.
      expect(jobsRepo.update).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({
          nextRunAt: expect.any(Date),
          lastRunAt: expect.any(Date),
        }),
      );
    });

    it('marks a one-shot as completed and returns null (terminal)', async () => {
      const { deps, jobsRepo } = makeDeps();
      const job = makeJob({ type: 'one-shot', cronExpression: null });
      const runnable = createPulseRunnableAdapter(deps);
      const next = await runnable.reschedule(
        'job-1',
        { job },
        {
          ok: true,
          durationMs: 5,
        },
      );
      expect(next).toBeNull();
      expect(jobsRepo.update).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({ status: 'completed' }),
      );
    });
  });

  describe('reschedule (failure path)', () => {
    it('retries with exponential backoff when retries remain', async () => {
      const { deps, jobsRepo, log } = makeDeps();
      const job = makeJob({
        retryCount: 0,
        maxRetries: 3,
        backoffMs: 1000,
      });
      const runnable = createPulseRunnableAdapter(deps);
      const next = await runnable.reschedule(
        'job-1',
        { job },
        {
          ok: false,
          error: new Error('boom'),
          durationMs: 5,
        },
      );
      expect(next).toBeInstanceOf(Date);
      expect(jobsRepo.update).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({
          retryCount: 1,
          nextRunAt: expect.any(Date),
        }),
      );
      expect(log.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          jobId: 'job-1',
          attempt: 1,
          maxRetries: 3,
        }),
        expect.stringMatching(/retry/),
      );
    });

    it('marks the job failed when retries are exhausted', async () => {
      const { deps, jobsRepo, log } = makeDeps();
      const job = makeJob({
        retryCount: 3,
        maxRetries: 3,
      });
      const runnable = createPulseRunnableAdapter(deps);
      const next = await runnable.reschedule(
        'job-1',
        { job },
        {
          ok: false,
          error: new Error('persistent'),
          durationMs: 5,
        },
      );
      expect(next).toBeNull();
      expect(jobsRepo.update).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({ status: 'failed' }),
      );
      expect(log.error).toHaveBeenCalledWith(
        expect.objectContaining({ jobId: 'job-1' }),
        expect.stringMatching(/permanently failed/),
      );
    });

    it('caps the backoff at maxBackoffMs', async () => {
      const { deps, jobsRepo } = makeDeps();
      const job = makeJob({
        retryCount: 0,
        maxRetries: 100,
        backoffMs: 1_000_000, // would be too high without a cap
      });
      // Use a small max so the test runs fast.
      const runnable = createPulseRunnableAdapter({
        ...deps,
        maxBackoffMs: 5_000,
      });
      const before = Date.now();
      const next = await runnable.reschedule(
        'job-1',
        { job },
        {
          ok: false,
          error: new Error('boom'),
          durationMs: 5,
        },
      );
      expect(next).toBeInstanceOf(Date);
      const elapsed = next!.getTime() - before;
      // Capped at 5000ms (plus a few ms of execution). Should be
      // well under the 1M uncapped backoff, so anything < 10000
      // proves the cap kicked in.
      expect(elapsed).toBeLessThan(10_000);
      expect(elapsed).toBeGreaterThanOrEqual(5_000);
      expect(jobsRepo.update).toHaveBeenCalled();
    });
  });
});
