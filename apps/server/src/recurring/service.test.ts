import { describe, it, expect, vi } from 'vitest';
import {
  RecurringTasksService,
  type RecurringTasksServiceOptions,
} from './service';
import type { TaskSchedule } from '@openaidy/db';
import type { TaskScheduleExecutor } from '../tasks/execution/task-schedule-executor';

// ============================================================================
// Fakes
// ============================================================================

const makeSchedule = (overrides: Partial<TaskSchedule> = {}): TaskSchedule => ({
  id: 'sched-1',
  taskId: 'task-1',
  cronExpression: '0 9 * * *',
  preset: '1d',
  scheduleDate: null,
  nextRunAt: new Date('2026-06-05T08:59:00Z'),
  lastRunAt: null,
  status: 'active',
  replanPolicy: 'never',
  maxExecutions: 9999,
  executionCount: 0,
  descriptionHash: null,
  createdAt: new Date('2026-06-01T00:00:00Z'),
  updatedAt: new Date('2026-06-01T00:00:00Z'),
  ...overrides,
});

// ============================================================================
// Harness
// ============================================================================

type Harness = {
  service: RecurringTasksService;
  executor: {
    claimNextDue: ReturnType<typeof vi.fn>;
    execute: ReturnType<typeof vi.fn>;
    reschedule: ReturnType<typeof vi.fn>;
    triggerNow: ReturnType<typeof vi.fn>;
  };
  taskSchedulesRepo: {
    claimNextDue: ReturnType<typeof vi.fn>;
    recoverStuckSchedules: ReturnType<typeof vi.fn>;
  };
  taskExecutionHistoryRepo: {
    findBySessionId: ReturnType<typeof vi.fn>;
    markCompleted: ReturnType<typeof vi.fn>;
    markFailed: ReturnType<typeof vi.fn>;
  };
  spies: {
    findBySessionId: ReturnType<typeof vi.fn>;
    markCompleted: ReturnType<typeof vi.fn>;
    markFailed: ReturnType<typeof vi.fn>;
  };
  runEvents: {
    subscribeAll: ReturnType<typeof vi.fn>;
  };
  getSessionType: ReturnType<typeof vi.fn>;
  unsubscribe: ReturnType<typeof vi.fn>;
  log: {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    debug: ReturnType<typeof vi.fn>;
  };
};

function makeHarness(
  options: {
    schedule?: TaskSchedule | null;
    executorResult?:
      | { ok: true; durationMs: number }
      | { ok: false; error: Error; durationMs: number };
    executorError?: Error;
  } = {},
): Harness {
  const schedule =
    options.schedule === undefined ? makeSchedule() : options.schedule;
  const executorResult = options.executorResult ?? {
    ok: true as const,
    durationMs: 50,
  };

  const unsubscribe = vi.fn();
  const runEvents = {
    subscribeAll: vi.fn().mockReturnValue(unsubscribe),
  };
  const getSessionType = vi.fn().mockResolvedValue('task');
  const taskSchedulesRepo = {
    claimNextDue: vi
      .fn()
      .mockResolvedValue(
        schedule ? { id: schedule.id, payload: { schedule } } : null,
      ),
    recoverStuckSchedules: vi.fn().mockResolvedValue([]),
  };
  const taskExecutionHistoryRepo = {
    findBySessionId: vi.fn(),
    markCompleted: vi.fn().mockResolvedValue({ id: 'hist-1' }),
    markFailed: vi.fn().mockResolvedValue({ id: 'hist-1' }),
  };
  // Identity helpers for the recurring service's reference identity
  // tests — these are passed through to the service so the test
  // harness can verify that the same mock object is being used.
  const findBySessionIdSpy = taskExecutionHistoryRepo.findBySessionId;
  const markCompletedSpy = taskExecutionHistoryRepo.markCompleted;
  const markFailedSpy = taskExecutionHistoryRepo.markFailed;
  const executor = {
    claimNextDue: vi.fn().mockResolvedValue(
      schedule
        ? {
            id: schedule.id,
            payload: {
              schedule,
              taskTitle: 'T',
              taskDescription: 'D',
              taskAssignedAgents: [],
              currentDescriptionHash: 'h',
            },
          }
        : null,
    ),
    execute: options.executorError
      ? vi.fn().mockRejectedValue(options.executorError)
      : vi.fn().mockResolvedValue(executorResult),
    reschedule: vi.fn().mockResolvedValue(new Date('2026-06-06T09:00:00Z')),
    triggerNow: vi.fn(),
  };
  const log = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const opts = {
    taskSchedulesRepo,
    taskExecutionHistoryRepo,
    executor: executor as unknown as TaskScheduleExecutor,
    runEvents,
    getSessionType,
    logger: log,
    // High poll interval so it doesn't fire during tests; we drive ticks manually.
    pollIntervalMs: 60_000,
  } as unknown as RecurringTasksServiceOptions;
  return {
    service: new RecurringTasksService(opts),
    executor,
    taskSchedulesRepo,
    taskExecutionHistoryRepo,
    // Expose the spy references for identity checks in tests.
    spies: {
      findBySessionId: findBySessionIdSpy,
      markCompleted: markCompletedSpy,
      markFailed: markFailedSpy,
    },
    runEvents,
    getSessionType,
    unsubscribe,
    log,
  };
}

// ============================================================================
// Lifecycle
// ============================================================================

describe('RecurringTasksService', () => {
  describe('start/stop', () => {
    it('start is idempotent', async () => {
      const h = makeHarness();
      h.service.start();
      h.service.start();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(h.taskSchedulesRepo.recoverStuckSchedules).toHaveBeenCalledOnce();
    });

    it('recovers stuck schedules on start', async () => {
      const h = makeHarness();
      h.service.start();
      // Wait for the fire-and-forget recovery promise.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(h.taskSchedulesRepo.recoverStuckSchedules).toHaveBeenCalledOnce();
    });

    it('logs recovery errors without throwing', async () => {
      const h = makeHarness();
      h.taskSchedulesRepo.recoverStuckSchedules.mockRejectedValue(
        new Error('db down'),
      );
      expect(() => h.service.start()).not.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(h.log.error).toHaveBeenCalled();
    });

    it('stop is idempotent', async () => {
      const h = makeHarness();
      h.service.start();
      await h.service.stop();
      await h.service.stop();
      // No throw, no double unsubscribe.
    });
  });

  // --------------------------------------------------------------------------
  // tick
  // --------------------------------------------------------------------------
  describe('tick', () => {
    it('returns false when no schedule is due', async () => {
      const h = makeHarness({ schedule: null });
      h.service.start();
      const did = await h.service.tick();
      expect(did).toBe(false);
      expect(h.executor.execute).not.toHaveBeenCalled();
    });

    it('claims, executes, and reschedules when a schedule is due', async () => {
      const h = makeHarness();
      h.service.start();
      const did = await h.service.tick();
      expect(did).toBe(true);
      expect(h.executor.execute).toHaveBeenCalled();
      expect(h.executor.reschedule).toHaveBeenCalled();
    });

    it('tick rejects when execute throws (setInterval callback catches it)', async () => {
      const h = makeHarness({ executorError: new Error('explode') });
      h.service.start();
      // tick() itself surfaces the error to the caller. The setInterval
      // callback inside start() wraps it in .catch() so the loop keeps
      // running. We assert the contract here: tick rejects with the
      // executor's error.
      await expect(h.service.tick()).rejects.toThrow('explode');
    });
  });
});
