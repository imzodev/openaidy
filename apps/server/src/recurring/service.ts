import type {
  TaskSchedulesStore,
  TaskExecutionHistoryStore,
} from '@openaidy/db';
import type { TaskScheduleExecutor } from '../tasks/execution/task-schedule-executor';
import type { GenericLogger } from '../scheduler/service';
import { createLogger } from '../lib/logger';

/**
 * Recurring tasks service — Phase 7 refactor.
 *
 * After the Phase 0 scheduling refactor, the polling loop lives in
 * the central `SchedulerService`. The `TaskScheduleExecutor` is
 * registered as a `ScheduledRunnable` (kind: 'task'), and the
 * scheduler's tick iterates registered runnables. This means
 * recurring tasks share the scheduler's cadence and lifecycle,
 * and they no longer need their own loop.
 *
 * What this service DOES still own (history rows are finalised by the
 * workflow run the executor starts, not here):
 *
 * 1. Startup recovery of schedules left in `running` after a crash.
 *
 * 2. The `tick()` method. The scheduler calls `runnable.execute()`
 *    directly, but tests drive `tick()` manually. We keep it as a
 *    public method that runs one full claim → execute → reschedule
 *    cycle, delegating each step to the executor.
 *
 * 3. `triggerNow()`. Manual trigger of a schedule, used by the API
 *    and the `task_schedules_trigger` tool. Delegates to the
 *    executor's `triggerNow`.
 *
 * 4. Lifecycle: `start()` and `stop()`, both idempotent.
 */
export type RecurringTasksServiceOptions = {
  taskSchedulesRepo: TaskSchedulesStore;
  taskExecutionHistoryRepo: TaskExecutionHistoryStore;
  executor: TaskScheduleExecutor;
  pollIntervalMs?: number;
  logger?: GenericLogger;
  /** Hook for tests to control the loop iteration. */
  now?: () => Date;
};

export class RecurringTasksService {
  private readonly logger: GenericLogger;
  private readonly pollIntervalMs: number;
  private readonly now: () => Date;
  private isRunning = false;
  private tickInProgress = false;

  // We hold direct references to the executor + repos so the loop
  // doesn't go through any intermediate abstraction.
  private readonly executor: TaskScheduleExecutor;
  private readonly taskSchedulesRepo: TaskSchedulesStore;
  private readonly taskExecutionHistoryRepo: TaskExecutionHistoryStore;

  constructor(options: RecurringTasksServiceOptions) {
    this.executor = options.executor;
    this.taskSchedulesRepo = options.taskSchedulesRepo;
    this.taskExecutionHistoryRepo = options.taskExecutionHistoryRepo;
    this.pollIntervalMs = options.pollIntervalMs ?? 5000;
    this.logger =
      options.logger ??
      (createLogger('RecurringTasks') as unknown as GenericLogger);
    this.now = options.now ?? (() => new Date());
  }

  /**
   * Start the service. Idempotent.
   *
   * The polling loop itself is now driven by the central
   * `SchedulerService` after this service registers the executor as
   * a `ScheduledRunnable`. We no longer start a `setInterval` here.
   *
   * On startup we also recover any schedules that were left in `running`
   * (e.g. the server crashed while a run was in flight). Without this
   * they would never be claimed again.
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    // Recover schedules left in `running` after a crash. Fire-and-forget:
    // it must not block startup, and any error is logged, not thrown.
    const stuckThreshold = new Date(this.now().getTime() - 5 * 60 * 1000);
    this.taskSchedulesRepo
      .recoverStuckSchedules(stuckThreshold)
      .then((recovered) => {
        if (recovered.length > 0) {
          this.logger.info(
            {
              count: recovered.length,
              scheduleIds: recovered.map((s) => s.id),
            },
            'Recovered stuck schedules on startup',
          );
        }
      })
      .catch((err) => {
        this.logger.error(
          { err: String(err) },
          'Failed to recover stuck schedules on startup',
        );
      });

    this.logger.info(
      { pollIntervalMs: this.pollIntervalMs },
      'Recurring tasks service started (polling driven by SchedulerService)',
    );
  }

  /**
   * Stop the service. Idempotent.
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;
    this.isRunning = false;

    // Wait for any in-progress tick to complete. The SchedulerService
    // drives ticks; tests may still be running one by hand.
    while (this.tickInProgress) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    this.logger.info('Recurring tasks service stopped');
  }

  /**
   * Run one tick: claim → execute → reschedule.
   *
   * In production the central `SchedulerService` drives this via
   * the registered `ScheduledRunnable` (the `TaskScheduleExecutor`).
   * The method is kept public so tests can drive ticks deterministically.
   */
  async tick(): Promise<boolean> {
    if (this.tickInProgress) return false;
    this.tickInProgress = true;
    try {
      const claimed = await this.executor.claimNextDue();
      if (!claimed) return false;

      this.logger.info(
        { scheduleId: claimed.id, taskId: claimed.payload.schedule.taskId },
        'Recurring task claimed for execution',
      );

      const result = await this.executor.execute(claimed.id, claimed.payload);
      const nextRunAt = await this.executor.reschedule(
        claimed.id,
        claimed.payload,
        result,
      );

      if (nextRunAt === null) {
        this.logger.info(
          { scheduleId: claimed.id },
          'Schedule terminal (one-shot fired, maxExecutions reached, or expired). Not rescheduling.',
        );
      } else {
        this.logger.info(
          { scheduleId: claimed.id, nextRunAt: nextRunAt.toISOString() },
          'Schedule rescheduled',
        );
      }
      return true;
    } finally {
      this.tickInProgress = false;
    }
  }

  /**
   * Convenience: trigger a schedule immediately without affecting its
   * `nextRunAt` or `executionCount`. Used by the API and tools.
   */
  async triggerNow(
    scheduleId: string,
  ): Promise<{ ok: boolean; historyId: string; error?: string }> {
    return this.executor.triggerNow(scheduleId);
  }
}

/**
 * Factory for the recurring tasks service.
 */
export function createRecurringTasksService(
  options: RecurringTasksServiceOptions,
): RecurringTasksService {
  return new RecurringTasksService(options);
}
