import type {
  TaskSchedulesStore,
  TaskExecutionHistoryStore,
} from '@openaidy/db';
import type { TaskScheduleExecutor } from '../tasks/execution/task-schedule-executor';
import type { GenericLogger } from '../scheduler/service';
import { createLogger } from '../lib/logger';
import type { RunEventEmitter } from '../dispatch/events';

/**
 * Recurring tasks service
 *
 * Wires the TaskScheduleExecutor to a simple polling loop. The executor
 * implements the `ScheduledRunnable` interface from `@openaidy/runtime`
 * (Phase 0), but we drive it with our own loop instead of the legacy
 * `SchedulerService` because:
 *
 * 1. The legacy scheduler's `executeJob` is hard-coded to the
 *    `scheduled_jobs` table (Pulses) and has no polymorphic dispatch
 *    yet. Rewiring that is Phase 7.
 * 2. The recurring-tasks polling has different semantics: we claim
 *    one schedule per tick, run it, wait for the reschedule callback
 *    to compute the next run, and immediately go again. There's no
 *    "queue of jobs" — there's exactly one next run per schedule.
 * 3. Keeping this isolated means we can ship the feature behind a
 *    flag (RECURRING_TASKS_ENABLED) without touching the Pulse flow.
 *
 * The loop matches the scheduler's default 5s tick — same overhead
 * budget as a Pulse claim, just a different table.
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
   * top-level task session created by the executor). This is a Phase 7
   * quality-of-life improvement; the feature still works without it.
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
  private intervalId: ReturnType<typeof setInterval> | undefined;
  private isRunning = false;
  private tickInProgress = false;
  private unsubscribeRunEvents: (() => void) | undefined;

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
   * Start the polling loop. Idempotent.
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.intervalId = setInterval(() => {
      this.tick().catch((err) => {
        this.logger.error({ err: String(err) }, 'Recurring tasks tick failed');
      });
    }, this.pollIntervalMs);

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
      'Recurring tasks scheduler started',
    );
  }

  /**
   * Stop the polling loop. Idempotent.
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;
    this.isRunning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
    if (this.unsubscribeRunEvents) {
      this.unsubscribeRunEvents();
      this.unsubscribeRunEvents = undefined;
    }
    while (this.tickInProgress) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    this.logger.info('Recurring tasks scheduler stopped');
  }

  /**
   * Handle a run event for the top-level task session. We filter on
   * session type `task` so we don't accidentally try to finalise a
   * history row for a subtask or chat session. The TaskExecution flow
   * already handles subtask verification, so this is purely additive.
   */
  private async handleRunEvent(
    event: import('../dispatch/events').RunEvent,
  ): Promise<void> {
    if (event.type !== 'run.completed' && event.type !== 'run.failed') return;
    if (!this.getSessionType) return;

    let sessionType: string | null | undefined;
    try {
      sessionType = await this.getSessionType(event.sessionId);
    } catch {
      return;
    }
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
        message: 'Run failed (reported by RunEventEmitter)',
      });
      this.logger.warn(
        { historyId: history.id, sessionId: event.sessionId, durationMs },
        'History row marked failed',
      );
    }
  }

  /**
   * Run one tick. Returns true if a schedule was claimed and run.
   *
   * This is the public entry point used by tests. The production code
   * drives ticks via the `setInterval` started in `start()`.
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
