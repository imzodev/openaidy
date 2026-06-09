import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { JobsRepository, JobRunsRepository } from '@openaidy/db';
import type { JobRun } from '@openaidy/db';
import {
  SchedulerService,
  createSchedulerService,
  type GenericLogger,
} from './service';
import type { SessionMessageService } from '../sessions/service';

// Create mock functions
const createMockLogger = (): GenericLogger => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
});

// Helper to create mock repositories with all methods
function createMockJobsRepo() {
  return {
    claimNextDueJob: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
    listActive: vi.fn(),
    countByStatus: vi.fn(),
  };
}

function createMockJobRunsRepo() {
  return {
    create: vi.fn(),
    findById: vi.fn(),
    updateStatus: vi.fn(),
    listByJob: vi.fn(),
    listByStatus: vi.fn(),
    getLatestByJob: vi.fn(),
    countByJobAndStatus: vi.fn(),
    deleteByJob: vi.fn(),
  };
}

function createMockSessionService() {
  return {
    submitMessageStreaming: vi.fn(),
    getSession: vi.fn(),
    createSession: vi.fn(),
    listSessions: vi.fn(),
    listMessages: vi.fn(),
    listRuns: vi.fn(),
  };
}

function createMockSessionsStore() {
  return {
    create: vi.fn(),
    findById: vi.fn(),
    list: vi.fn(),
    updateTitle: vi.fn(),
    updateStatus: vi.fn(),
    delete: vi.fn(),
  };
}

// Helper to create a mock run
function createMockRun(overrides: Partial<JobRun> = {}): JobRun {
  return {
    id: 'run-1',
    jobId: 'job-1',
    status: 'queued',
    attemptNumber: 1,
    startedAt: null,
    finishedAt: null,
    errorCode: null,
    errorMessage: null,
    resultData: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe('SchedulerService', () => {
  let scheduler: SchedulerService;
  let mockJobsRepo: ReturnType<typeof createMockJobsRepo>;
  let mockJobRunsRepo: ReturnType<typeof createMockJobRunsRepo>;
  let mockSessionService: ReturnType<typeof createMockSessionService>;
  let mockSessionsStore: ReturnType<typeof createMockSessionsStore>;
  let mockLogger: GenericLogger;

  beforeEach(() => {
    vi.useFakeTimers();
    mockJobsRepo = createMockJobsRepo();
    mockJobRunsRepo = createMockJobRunsRepo();
    mockSessionService = createMockSessionService();
    mockSessionsStore = createMockSessionsStore();
    mockLogger = createMockLogger();

    // Cast to any to avoid complex type issues with mocks
    scheduler = new SchedulerService(
      mockJobsRepo as unknown as JobsRepository,
      mockJobRunsRepo as unknown as JobRunsRepository,
      mockSessionService as unknown as SessionMessageService,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockSessionsStore as any,
      mockLogger,
      { pollIntervalMs: 5000 },
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    if (scheduler.isActive()) {
      scheduler.stop();
    }
  });

  describe('start()', () => {
    it('starts scheduler successfully', () => {
      scheduler.start();
      expect(scheduler.isActive()).toBe(true);
    });

    it('throws error if already running', () => {
      scheduler.start();
      expect(() => scheduler.start()).toThrow('Scheduler is already running');
    });

    it('logs scheduler started', () => {
      scheduler.start();
      expect(mockLogger.info).toHaveBeenCalledWith(
        { pollIntervalMs: 5000 },
        'Scheduler started',
      );
    });
  });

  describe('stop()', () => {
    it('stops scheduler successfully', async () => {
      scheduler.start();
      await scheduler.stop();
      expect(scheduler.isActive()).toBe(false);
    });

    it('is idempotent', async () => {
      await scheduler.stop();
      expect(scheduler.isActive()).toBe(false);
    });

    it('logs scheduler stopped', async () => {
      scheduler.start();
      await scheduler.stop();
      expect(mockLogger.info).toHaveBeenCalledWith('Scheduler stopped');
    });
  });

  describe('isActive()', () => {
    it('returns false when not started', () => {
      expect(scheduler.isActive()).toBe(false);
    });

    it('returns true when started', () => {
      scheduler.start();
      expect(scheduler.isActive()).toBe(true);
    });

    it('returns false after stop', async () => {
      scheduler.start();
      await scheduler.stop();
      expect(scheduler.isActive()).toBe(false);
    });
  });

  describe('tick()', () => {
    it('returns false when no due jobs', async () => {
      mockJobsRepo.claimNextDueJob.mockResolvedValue(null);
      const result = await scheduler.tick();
      expect(result).toBe(false);
    });

    it('returns false when scheduler not running', async () => {
      const result = await scheduler.tick();
      expect(result).toBe(false);
    });
  });

  describe('recoverStuckJobs()', () => {
    it('recovers stuck runs on startup', async () => {
      const mockRun = createMockRun({
        status: 'running',
        startedAt: new Date(),
      });

      mockJobRunsRepo.listByStatus.mockResolvedValue([mockRun]);
      mockJobRunsRepo.updateStatus.mockResolvedValue({
        ...mockRun,
        status: 'failed',
      });

      await scheduler.recoverStuckJobs();

      expect(mockJobRunsRepo.updateStatus).toHaveBeenCalledWith('run-1', {
        status: 'failed',
        finishedAt: expect.any(Date),
        errorCode: 'SCHEDULER_CRASH',
        errorMessage: 'Run was in progress when scheduler stopped',
      });
      // The job itself is NOT touched — the runnable will re-claim
      // it on the next tick if it's still pending.
      expect(mockJobsRepo.findById).not.toHaveBeenCalled();
    });

    it('handles no stuck runs', async () => {
      mockJobRunsRepo.listByStatus.mockResolvedValue([]);

      await scheduler.recoverStuckJobs();

      expect(mockJobRunsRepo.updateStatus).not.toHaveBeenCalled();
    });
  });
});

describe('createSchedulerService', () => {
  it('creates scheduler service instance', () => {
    const mockJobsRepo = createMockJobsRepo();
    const mockJobRunsRepo = createMockJobRunsRepo();
    const mockSessionService = createMockSessionService();
    const mockSessionsStore = createMockSessionsStore();
    const mockLogger = createMockLogger();

    const scheduler = createSchedulerService(
      mockJobsRepo as unknown as JobsRepository,
      mockJobRunsRepo as unknown as JobRunsRepository,
      mockSessionService as unknown as SessionMessageService,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockSessionsStore as any,
      mockLogger,
    );

    expect(scheduler).toBeInstanceOf(SchedulerService);
    expect(scheduler.isActive()).toBe(false);
  });
});

// ============================================================================
// Phase 0 scheduling refactor: ScheduledRunnable registry + dispatch
// ============================================================================

import type { ScheduledRunnable, ExecutionResult } from '@openaidy/runtime';

/**
 * Build a minimal `ScheduledRunnable` with vi.fn()s for the three
 * lifecycle hooks. The optional `_payload` arg is whatever the
 * caller wants — the scheduler doesn't introspect it.
 */
function makeRunnable(
  kind: string,
  options: {
    claim?: () => Promise<{ id: string; payload: unknown } | null>;
    execute?: (id: string, payload: unknown) => Promise<ExecutionResult>;
    reschedule?: (
      id: string,
      payload: unknown,
      result: ExecutionResult,
    ) => Promise<Date | null>;
  } = {},
): ScheduledRunnable & {
  claimNextDue: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
  reschedule: ReturnType<typeof vi.fn>;
} {
  return {
    kind,
    claimNextDue: vi.fn(
      options.claim ??
        (async () => ({ id: 'item-1', payload: { foo: 'bar' } })),
    ),
    execute: vi.fn(
      (options.execute ??
        (async () => ({ ok: true as const, durationMs: 5 }))) as (
        id: string,
        payload: unknown,
      ) => Promise<import('@openaidy/runtime').ExecutionResult>,
    ),
    reschedule: vi.fn(options.reschedule ?? (async () => null)),
  };
}

/**
 * Build a SchedulerService wired to mocks that never claim/run a
 * job (so the legacy `executeJob` path is dormant). We then
 * register one or more runnables and exercise the Phase 0 dispatch.
 */
function makeScheduler() {
  const mockLogger = createMockLogger();
  const mockJobsRepo = createMockJobsRepo();
  // The legacy path returns null = no due jobs.
  mockJobsRepo.claimNextDueJob.mockResolvedValue(null);
  const mockJobRunsRepo = createMockJobRunsRepo();
  const mockSessionService = createMockSessionService();
  const mockSessionsStore = {
    findById: vi.fn().mockResolvedValue(null),
    create: vi.fn(),
    list: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
  const scheduler = new SchedulerService(
    mockJobsRepo as unknown as Parameters<typeof createSchedulerService>[0],
    mockJobRunsRepo as unknown as Parameters<typeof createSchedulerService>[1],
    mockSessionService as unknown as Parameters<
      typeof createSchedulerService
    >[2],
    mockSessionsStore as unknown as Parameters<
      typeof createSchedulerService
    >[3],
    mockLogger,
  );
  return { scheduler, mockLogger, mockJobsRepo, mockJobRunsRepo };
}

describe('Phase 0 dispatch — ScheduledRunnable registry', () => {
  it('registers a runnable and lists its kind', () => {
    const { scheduler } = makeScheduler();
    const runnable = makeRunnable('test-1');

    expect(scheduler.getRunnableKinds()).toEqual([]);
    scheduler.registerRunnable(runnable);
    expect(scheduler.getRunnableKinds()).toEqual(['test-1']);
  });

  it('rejects duplicate registrations with the same kind', () => {
    const { scheduler } = makeScheduler();
    scheduler.registerRunnable(makeRunnable('dup'));
    expect(() => scheduler.registerRunnable(makeRunnable('dup'))).toThrow(
      /already registered/,
    );
    // Only the first one is registered.
    expect(scheduler.getRunnableKinds()).toEqual(['dup']);
  });

  it('dispatches to the first runnable that claims an item', async () => {
    const { scheduler } = makeScheduler();
    scheduler.start(); // tick is a no-op without due jobs / claims

    const r1 = makeRunnable('r1', {
      claim: async () => null, // doesn't claim
    });
    const r2 = makeRunnable('r2', {
      claim: async () => ({ id: 'sched-7', payload: { taskId: 't' } }),
    });
    const r3 = makeRunnable('r3', {
      claim: async () => null, // never reached
    });
    scheduler.registerRunnable(r1);
    scheduler.registerRunnable(r2);
    scheduler.registerRunnable(r3);

    const did = await scheduler.tick();
    expect(did).toBe(true);
    expect(r1.claimNextDue).toHaveBeenCalled();
    expect(r2.claimNextDue).toHaveBeenCalled();
    expect(r2.execute).toHaveBeenCalledWith('sched-7', { taskId: 't' });
    expect(r2.reschedule).toHaveBeenCalled();
    // r3 should NOT have been polled — the first claimer wins.
    expect(r3.claimNextDue).not.toHaveBeenCalled();

    await scheduler.stop();
  });

  it('returns false when no runnable claims', async () => {
    const { scheduler } = makeScheduler();
    scheduler.start();
    scheduler.registerRunnable(
      makeRunnable('empty', { claim: async () => null }),
    );

    const did = await scheduler.tick();
    expect(did).toBe(false);
    await scheduler.stop();
  });

  it('skips the legacy path when a runnable claims', async () => {
    const { scheduler, mockJobsRepo } = makeScheduler();
    scheduler.start();
    scheduler.registerRunnable(
      makeRunnable('claims', {
        claim: async () => ({ id: 'x', payload: null }),
      }),
    );

    await scheduler.tick();
    // The legacy job claimer is never reached.
    expect(mockJobsRepo.claimNextDueJob).not.toHaveBeenCalled();
    await scheduler.stop();
  });

  it('calls reschedule with the execution result', async () => {
    const { scheduler } = makeScheduler();
    scheduler.start();

    const result: ExecutionResult = { ok: true, durationMs: 42 };
    const r = makeRunnable('r', {
      claim: async () => ({ id: 'id-1', payload: { x: 1 } }),
      execute: async () => result,
      reschedule: async () => new Date('2026-06-05T10:00:00.000Z'),
    });
    scheduler.registerRunnable(r);

    await scheduler.tick();
    expect(r.reschedule).toHaveBeenCalledWith('id-1', { x: 1 }, result);
    await scheduler.stop();
  });

  it('records a thrown execute as a failure result and still reschedules', async () => {
    const { scheduler } = makeScheduler();
    scheduler.start();

    const r = makeRunnable('r', {
      claim: async () => ({ id: 'id-1', payload: null }),
      execute: async () => {
        // A runnable that throws is treated as a failure —
        // the scheduler doesn't crash.
        throw new Error('boom');
      },
      reschedule: async (_id, _payload, result) => {
        // Verify the scheduler handed us a failure result.
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.message).toBe('boom');
        }
        return null;
      },
    });
    scheduler.registerRunnable(r);

    const did = await scheduler.tick();
    expect(did).toBe(true);
    expect(r.reschedule).toHaveBeenCalled();
    await scheduler.stop();
  });

  it('logs when reschedule throws but does not crash the tick', async () => {
    const { scheduler, mockLogger } = makeScheduler();
    scheduler.start();

    const r = makeRunnable('r', {
      claim: async () => ({ id: 'id-1', payload: null }),
      reschedule: async () => {
        throw new Error('reschedule failed');
      },
    });
    scheduler.registerRunnable(r);

    // tick resolves normally even though reschedule threw.
    const did = await scheduler.tick();
    expect(did).toBe(true);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'r', err: expect.any(String) }),
      expect.stringMatching(/reschedule/),
    );
    await scheduler.stop();
  });
});
