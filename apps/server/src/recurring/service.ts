import type {
  TaskSchedulesStore,
  TaskExecutionHistoryStore,
} from '@openaidy/db';
import type { TaskScheduleExecutor } from '../tasks/execution/task-schedule-executor';
import type { GenericLogger } from '../scheduler/service';
import { createLogger } from '../lib/logger';
import type { RunEventEmitter } from '../dispatch/events';

/**
 * Recurring tasks service — Phase 7 refactor.
 *
 * After the Phase 0 scheduling refactor, the polling loop lives in
 * the central `SchedulerService`. The `TaskScheduleExecutor` is
 * registered as a `ScheduledRunnable` (kind: 'task'), and the
 * scheduler's tick iterates registered runnables before falling back
 * to the legacy `executeJob` (Pulse) path. This means recurring
 * tasks share the scheduler's cadence and lifecycle, and they no
 * longer need their own loop.
 *
 * What this service DOES still own:
 *
 * 1. `RunEventEmitter` subscription. When a task session reaches
 *    `run.completed` or `run.failed`, the matching `task_execution_history`
 *    row needs to transition from `verifying` to its terminal state
 *    with `durationMs`. This is unique to the recurring-tasks domain
 *    (the Pulse path doesn't have a history table) and can't be moved
 *    into the generic scheduler.
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
 * 4. Lifecycle: `start()` subscribes to RunEventEmitter; `stop()`
 *    unsubscribes. Both are idempotent.
 */
export type RecurringTasksServiceOptions = {
  taskSchedulesRepo: TaskSchedulesStore;
  taskExecutionHistoryRepo: TaskExecutionHistoryStore;
  executor: TaskScheduleExecutor;
  pollIntervalMs?: number;
  logger?: GenericLogger;
  /** Hook for tests to control the loop iteration. */
  now?: () => Date;
  /**
   * Optional: when provided, the service subscribes to the run-event
   * emitter to finalise history rows. Each run submitted by the executor
   * produces a session; when that session transitions to
   * `run.completed` / `run.failed`, the matching history row is moved
   * from `verifying` to `completed` / `failed` with durationMs.
   *
   * If not provided, history rows stay in `verifying` forever (the
   * TaskExecution.handleRunEvent flow handles subtasks but not the
   * top-level task session created by the executor).
   */
  runEvents?: RunEventEmitter;
  /**
   * Lookup the session type for a given sessionId. Used to filter
   * run events: we only care about sessions of type `task`, not
   * subtask or chat sessions.
   */
  getSessionType?: (sessionId: string) => Promise<string | null | undefined>;
};

export class RecurringTasksService {
  private readonly logger: GenericLogger;
  private readonly pollIntervalMs: number;
  private readonly now: () => Date;
  private isRunning = false;
  private unsubscribeRunEvents: (() => void) | undefined;
  private tickInProgress = false;

  // We hold direct references to the executor + repos so the loop
  // doesn't go through any intermediate abstraction.
  private readonly executor: TaskScheduleExecutor;
  private readonly taskSchedulesRepo: TaskSchedulesStore;
  private readonly taskExecutionHistoryRepo: TaskExecutionHistoryStore;
  private readonly runEvents: RunEventEmitter | undefined;
  private readonly getSessionType:
    | ((sessionId: string) => Promise<string | null | undefined>)
    | undefined;

  constructor(options: RecurringTasksServiceOptions) {
    this.executor = options.executor;
    this.taskSchedulesRepo = options.taskSchedulesRepo;
    this.taskExecutionHistoryRepo = options.taskExecutionHistoryRepo;
    this.pollIntervalMs = options.pollIntervalMs ?? 5000;
    this.logger =
      options.logger ??
      (createLogger('RecurringTasks') as unknown as GenericLogger);
    this.now = options.now ?? (() => new Date());
    this.runEvents = options.runEvents;
    this.getSessionType = options.getSessionType;
  }

  /**
   * Subscribe to run events. Idempotent.
   *
   * The polling loop itself is now driven by the central
   * `SchedulerService` after this service registers the executor as
   * a `ScheduledRunnable`. We no longer start a `setInterval` here.
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    // Subscribe to run events to finalise history rows.
    if (this.runEvents) {
      this.unsubscribeRunEvents = this.runEvents.subscribeAll((event) => {
        // Return the promise so subscribers (and tests) can await it.
        // Errors are caught and logged — we never want a single bad
        // run event to crash the loop.
        return this.handleRunEvent(event).catch((err) => {
          this.logger.error(
            { sessionId: event.sessionId, err: String(err) },
            'handleRunEvent failed',
          );
        });
      });
    }

    this.logger.info(
      { pollIntervalMs: this.pollIntervalMs },
      'Recurring tasks service started (event listener only; polling driven by SchedulerService)',
    );
  }

  /**
   * Unsubscribe from run events. Idempotent.
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;
    this.isRunning = false;

    if (this.unsubscribeRunEvents) {
      this.unsubscribeRunEvents();
      this.unsubscribeRunEvents = undefined;
    }

    // Wait for any in-progress tick to complete. The SchedulerService
    // drives ticks; we only need to wait for the in-flight handleRunEvent
    // calls if any.
    while (this.tickInProgress) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    this.logger.info('Recurring tasks service stopped');
  }

  /**
   * Process a single run event. Filters by session type (`task`)
   * to avoid double-handling subtask events that the
   * `TaskExecution.handleRunEvent` flow already covers.
   */
  private async handleRunEvent(
    event: import('../dispatch/events').RunEvent,
  ): Promise<void> {
    if (event.type !== 'run.completed' && event.type !== 'run.failed') return;
    if (!this.getSessionType) return;

    const sessionType = await this.getSessionType(event.sessionId);
    if (sessionType !== 'task') return;

    const history = await this.taskExecutionHistoryRepo.findBySessionId(
      event.sessionId,
    );
    if (!history) return;
    if (history.status === 'completed' || history.status === 'failed') return;

    const startedAt =
      history.startedAt instanceof Date
        ? history.startedAt.getTime()
        : new Date(history.startedAt).getTime();
    const durationMs = Date.now() - startedAt;

    if (event.type === 'run.completed') {
      await this.taskExecutionHistoryRepo.markCompleted(history.id, durationMs);
      this.logger.info(
        { historyId: history.id, sessionId: event.sessionId, durationMs },
        'History row marked completed',
      );
    } else {
      await this.taskExecutionHistoryRepo.markFailed(history.id, durationMs, {
        code: 'RUN_FAILED',
        message: 'Run failed (see session for details)',
      });
      this.logger.info(
        { historyId: history.id, sessionId: event.sessionId, durationMs },
        'History row marked failed',
      );
    }
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
