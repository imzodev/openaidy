import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  RecurringTasksService,
  type RecurringTasksServiceOptions,
} from './service';
import type { TaskSchedule, TaskExecutionHistoryRow } from '@openaidy/db';
import type { TaskScheduleExecutor } from '../tasks/execution/task-schedule-executor';
import type { RunEvent } from '../dispatch/events';

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

const makeHistory = (
  overrides: Partial<TaskExecutionHistoryRow> = {},
): TaskExecutionHistoryRow => ({
  id: 'hist-1',
  taskId: 'task-1',
  scheduleId: 'sched-1',
  status: 'verifying',
  startedAt: new Date(Date.now() - 1000), // 1 second ago
  finishedAt: null,
  durationMs: null,
  sessionId: 'session-1',
  taskTitle: 'T',
  taskDescription: 'D',
  didReplan: false,
  errorCode: null,
  errorMessage: null,
  attemptNumber: 1,
  createdAt: new Date(),
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
    it('subscribes to run events on start and unsubscribes on stop', async () => {
      const h = makeHarness();
      h.service.start();
      expect(h.runEvents.subscribeAll).toHaveBeenCalledOnce();
      await h.service.stop();
      expect(h.unsubscribe).toHaveBeenCalled();
    });

    it('start is idempotent', () => {
      const h = makeHarness();
      h.service.start();
      h.service.start();
      expect(h.runEvents.subscribeAll).toHaveBeenCalledOnce();
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

  // --------------------------------------------------------------------------
  // Run-event subscription (history finalisation)
  // --------------------------------------------------------------------------
  describe('run-event subscription', () => {
    let _capturedHandler: (event: RunEvent) => Promise<void>;

    beforeEach(() => {
      _capturedHandler = undefined as unknown as (
        event: RunEvent,
      ) => Promise<void>;
    });

    const startAndCaptureHandler = (
      h: Harness,
    ): ((event: RunEvent) => Promise<void>) => {
      h.service.start();
      // subscribeAll is called with a handler; capture it.
      const handler = h.runEvents.subscribeAll.mock.calls[0]![0] as (
        event: RunEvent,
      ) => Promise<void>;
      _capturedHandler = handler;
      return handler;
    };

    it('marks history completed on run.completed for task sessions', async () => {
      const h = makeHarness();
      const handler = startAndCaptureHandler(h);
      const history = makeHistory();
      h.taskExecutionHistoryRepo.findBySessionId.mockResolvedValue(history);
      h.getSessionType.mockResolvedValue('task');

      await handler({
        type: 'run.completed',
        runId: 'r-1',
        sessionId: 'session-1',
        agentId: 'a-1',
        timestamp: new Date().toISOString(),
        data: {},
      });

      expect(h.spies.findBySessionId).toHaveBeenCalledWith('session-1');
      expect(h.spies.markCompleted).toHaveBeenCalledWith(
        'hist-1',
        expect.any(Number),
      );
      expect(h.spies.markFailed).not.toHaveBeenCalled();
    });

    it('marks history failed on run.failed for task sessions', async () => {
      const h = makeHarness();
      const handler = startAndCaptureHandler(h);
      const history = makeHistory();
      h.taskExecutionHistoryRepo.findBySessionId.mockResolvedValue(history);

      await handler({
        type: 'run.failed',
        runId: 'r-1',
        sessionId: 'session-1',
        agentId: 'a-1',
        timestamp: new Date().toISOString(),
        data: {},
      });

      expect(h.spies.markFailed).toHaveBeenCalledWith(
        'hist-1',
        expect.any(Number),
        expect.objectContaining({ code: 'RUN_FAILED' }),
      );
    });

    it('ignores run events for non-task sessions', async () => {
      const h = makeHarness();
      const handler = startAndCaptureHandler(h);
      h.getSessionType.mockResolvedValue('subtask');

      await handler({
        type: 'run.completed',
        runId: 'r-1',
        sessionId: 'session-1',
        agentId: 'a-1',
        timestamp: new Date().toISOString(),
        data: {},
      });

      expect(h.taskExecutionHistoryRepo.findBySessionId).not.toHaveBeenCalled();
      expect(h.taskExecutionHistoryRepo.markCompleted).not.toHaveBeenCalled();
    });

    it('ignores run events with no matching history row', async () => {
      const h = makeHarness();
      const handler = startAndCaptureHandler(h);
      h.taskExecutionHistoryRepo.findBySessionId.mockResolvedValue(null);

      await handler({
        type: 'run.completed',
        runId: 'r-1',
        sessionId: 'session-1',
        agentId: 'a-1',
        timestamp: new Date().toISOString(),
        data: {},
      });

      expect(h.taskExecutionHistoryRepo.markCompleted).not.toHaveBeenCalled();
    });

    it('is idempotent for terminal history rows', async () => {
      const h = makeHarness();
      const handler = startAndCaptureHandler(h);
      h.taskExecutionHistoryRepo.findBySessionId.mockResolvedValue(
        makeHistory({ status: 'completed' }),
      );

      await handler({
        type: 'run.completed',
        runId: 'r-1',
        sessionId: 'session-1',
        agentId: 'a-1',
        timestamp: new Date().toISOString(),
        data: {},
      });

      expect(h.taskExecutionHistoryRepo.markCompleted).not.toHaveBeenCalled();
    });

    it('ignores non-terminal run events (run.delta, run.started, etc.)', async () => {
      const h = makeHarness();
      const handler = startAndCaptureHandler(h);

      await handler({
        type: 'run.delta',
        runId: 'r-1',
        sessionId: 'session-1',
        agentId: 'a-1',
        timestamp: new Date().toISOString(),
        data: { content: 'a' },
      });

      expect(h.taskExecutionHistoryRepo.findBySessionId).not.toHaveBeenCalled();
    });

    it('survives session-type lookup failures (silent skip)', async () => {
      const h = makeHarness();
      const handler = startAndCaptureHandler(h);
      h.getSessionType.mockRejectedValue(new Error('session lookup boom'));

      // Should not throw.
      await handler({
        type: 'run.completed',
        runId: 'r-1',
        sessionId: 'session-1',
        agentId: 'a-1',
        timestamp: new Date().toISOString(),
        data: {},
      });

      expect(h.taskExecutionHistoryRepo.findBySessionId).not.toHaveBeenCalled();
    });

    it('does not subscribe when no runEvents were provided', async () => {
      const h = makeHarness();
      // Build a service without runEvents.
      const service = new RecurringTasksService({
        taskSchedulesRepo: h.taskSchedulesRepo,
        taskExecutionHistoryRepo: h.taskExecutionHistoryRepo,
        executor: h.executor as unknown as TaskScheduleExecutor,
        logger: h.log,
        pollIntervalMs: 60_000,
      } as unknown as RecurringTasksServiceOptions);
      service.start();
      // No subscribeAll call
      expect(h.runEvents.subscribeAll).not.toHaveBeenCalled();
      await service.stop();
      // stop() should still work without the unsubscribe
    });
  });
});
