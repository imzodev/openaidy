import type { JobsStore, JobRunsStore, SessionsStore } from '@openaidy/db';
import type { SessionMessageService } from '../sessions/service';
import type { ScheduledRunnable } from '@openaidy/runtime';

/**
 * Generic logger interface compatible with both pino.Logger and FastifyBaseLogger
 */
export type GenericLogger = {
  info: (objOrMsg: unknown, msg?: string) => void;
  warn: (objOrMsg: unknown, msg?: string) => void;
  error: (objOrMsg: unknown, msg?: string) => void;
  debug?: (objOrMsg: unknown, msg?: string) => void;
};

/**
 * SchedulerService options
 */
export type SchedulerServiceOptions = {
  pollIntervalMs?: number; // default 5000 (5 seconds)
  enableAutoStart?: boolean; // default false
};

/**
 * SchedulerService
 *
 * Core scheduler service that polls for due jobs, executes them via the dispatch system,
 * handles retries, and manages job lifecycle. This is the heart of the Phase 2 scheduler.
 *
 * Features:
 * - Runs a polling loop to check for due jobs
 * - Claims and executes jobs atomically
 * - Integrates with existing SessionMessageService for dispatch
 * - Handles one-shot and cron job types differently
 * - Manages retry logic with exponential backoff
 * - Updates job and run status appropriately
 */
export class SchedulerService {
  private intervalId: ReturnType<typeof setInterval> | undefined;
  private isRunning = false;
  private tickInProgress = false;
  private readonly pollIntervalMs: number;

  constructor(
    /**
     * The `JobsStore` is unused now — pulses are driven by the
     * `PulseRunnableAdapter`. Kept on the constructor so
     * `createSchedulerService` doesn't break.
     */
    private readonly jobsRepo: JobsStore,
    private readonly jobRunsRepo: JobRunsStore,
    /**
     * Unused — kept for backward compatibility. The
     * `PulseRunnableAdapter` consumes this directly.
     */
    private readonly sessionMessageService: SessionMessageService,
    /**
     * Unused — kept for backward compatibility. The
     * `PulseRunnableAdapter` consumes this directly.
     */
    private readonly sessionsStore: SessionsStore,
    private readonly logger: GenericLogger,
    options?: SchedulerServiceOptions,
  ) {
    this.pollIntervalMs = options?.pollIntervalMs ?? 5000;

    if (options?.enableAutoStart) {
      this.start();
    }
  }

  /**
   * Registered `ScheduledRunnable` adapters, keyed by `kind`. The
   * scheduler iterates these in registration order on every tick
   * BEFORE the legacy `executeJob` path. The first runnable that
   * claims a due item gets to run it; the rest stand down for that
   * tick. This means: a tick can execute AT MOST ONE runnable's
   * claimed item, not all of them.
   *
   * The registry is opt-in: until you call `registerRunnable`, the
   * scheduler behaves exactly as it did before Phase 0. This keeps
   * the existing Pulse flow regression-free.
   */
  private readonly runnables = new Map<string, ScheduledRunnable>();

  /**
   * Register a runnable with the scheduler. The runnable's
   * `claimNextDue()` will be called on every tick. If it returns
   * a claimed item, the scheduler invokes `execute()` and then
   * `reschedule()`. The legacy `executeJob` path is skipped for
   * that tick.
   *
   * @throws if a runnable with the same `kind` is already registered.
   */
  registerRunnable(runnable: ScheduledRunnable): void {
    if (this.runnables.has(runnable.kind)) {
      throw new Error(
        `A ScheduledRunnable with kind "${runnable.kind}" is already registered. ` +
          `Use a unique kind string per implementation.`,
      );
    }
    this.runnables.set(runnable.kind, runnable);
    this.logger.info({ kind: runnable.kind }, 'ScheduledRunnable registered');
  }

  /**
   * Returns the kinds of registered runnables. Used by the
   * `/api/scheduler` admin route (Phase 7 observability).
   */
  getRunnableKinds(): string[] {
    return Array.from(this.runnables.keys());
  }

  /**
   * Start the scheduler polling loop
   */
  start(): void {
    if (this.isRunning) {
      throw new Error('Scheduler is already running');
    }

    this.isRunning = true;
    this.intervalId = setInterval(() => {
      this.tick().catch((error) => {
        this.logger.error({ error }, 'Scheduler tick failed');
      });
    }, this.pollIntervalMs);

    this.logger.info(
      { pollIntervalMs: this.pollIntervalMs },
      'Scheduler started',
    );
  }

  /**
   * Stop the scheduler gracefully
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.logger.info('Stopping scheduler...');
    this.isRunning = false;

    // Clear interval
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }

    // Wait for any in-progress tick to complete
    while (this.tickInProgress) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    this.logger.info('Scheduler stopped');
  }

  /**
   * Single tick - claim and execute one item from a registered
   * `ScheduledRunnable` adapter. The first runnable to claim wins
   * for that tick.
   *
   * Order of operations:
   * 1. Iterate registered `ScheduledRunnable` adapters in
   *    registration order. The first one to return a claimed
   *    item wins; we run it, reschedule, and return.
   *
   * Returns true if a runnable's claimed item was executed,
   * false otherwise.
   */
  async tick(): Promise<boolean> {
    if (!this.isRunning) {
      return false;
    }

    this.tickInProgress = true;

    try {
      for (const runnable of this.runnables.values()) {
        const claimed = await runnable.claimNextDue();
        if (!claimed) continue;
        await this.runRunnable(runnable, claimed.id, claimed.payload);
        return true;
      }
      return false;
    } catch (error) {
      this.logger.error(
        {
          error:
            error instanceof Error
              ? { message: error.message, stack: error.stack }
              : error,
        },
        'Scheduler tick failed',
      );
      return false;
    } finally {
      this.tickInProgress = false;
    }
  }

  /**
   * Check if scheduler is running
   */
  isActive(): boolean {
    return this.isRunning;
  }

  /**
   * Run a claimed item from a `ScheduledRunnable` adapter. Handles
   * the timing + error contract, then delegates to the runnable's
   * `reschedule()`. Logs lifecycle events.
   *
   * For runnables whose `kind` matches a "tracked" kind (currently
   * `'pulse'`), wraps the execute + reschedule with a `JobRun`
   * row lifecycle. The adapter itself does not need to know about
   * audit trails — the scheduler centralises that concern so the
   * adapter is reusable for future kinds with different audit
   * requirements.
   */
  private async runRunnable(
    runnable: ScheduledRunnable,
    id: string,
    payload: unknown,
  ): Promise<void> {
    const startedAt = Date.now();
    this.logger.info({ kind: runnable.kind, id }, 'Runnable claimed an item');

    // Create a JobRun row up front for tracked kinds. We do this
    // BEFORE execute so that crashes during the run still leave a
    // `running` row that the recovery sweep can clean up.
    const trackedKinds: ReadonlyArray<string> = ['pulse'];
    const isTracked = trackedKinds.includes(runnable.kind);
    const run = isTracked
      ? await this.jobRunsRepo.create({
          jobId: id,
          status: 'queued',
          attemptNumber: 0,
        })
      : null;
    if (run) {
      await this.jobRunsRepo.updateStatus(run.id, {
        status: 'running',
        startedAt: new Date(),
      });
    }

    let result: import('@openaidy/runtime').ExecutionResult;
    try {
      result = await runnable.execute(id, payload);
    } catch (err) {
      // A runnable that throws is treated as a failure (the contract
      // says implementations should report errors via the result, not
      // throw — but we defend against bad citizens).
      result = {
        ok: false,
        error: err instanceof Error ? err : new Error(String(err)),
        durationMs: Date.now() - startedAt,
      };
    }

    // Update the JobRun row with the final status.
    if (run) {
      try {
        const update: {
          status: 'succeeded' | 'failed';
          finishedAt: Date;
          errorCode?: string;
          errorMessage?: string;
        } = {
          status: result.ok ? 'succeeded' : 'failed',
          finishedAt: new Date(),
        };
        if (!result.ok) {
          update.errorCode = result.error.name ?? 'EXECUTION_ERROR';
          update.errorMessage = result.error.message;
        }
        await this.jobRunsRepo.updateStatus(run.id, update);
      } catch (err) {
        // The audit trail is best-effort — a failure to write the
        // JobRun row should not block the reschedule.
        this.logger.warn(
          { runId: run.id, kind: runnable.kind, err: String(err) },
          'Failed to update JobRun row',
        );
      }
    }

    try {
      const nextRunAt = await runnable.reschedule(id, payload, result);
      if (nextRunAt) {
        this.logger.info(
          {
            kind: runnable.kind,
            id,
            nextRunAt: nextRunAt.toISOString(),
            ok: result.ok,
          },
          'Runnable rescheduled',
        );
      } else {
        this.logger.info(
          { kind: runnable.kind, id, ok: result.ok },
          'Runnable reschedule returned null (terminal)',
        );
      }
    } catch (err) {
      // A reschedule that throws is logged but doesn't crash the
      // tick — the run already happened, and we'd rather not lose
      // the fact that it ran.
      this.logger.error(
        { kind: runnable.kind, id, err: String(err) },
        'Runnable reschedule threw — item is not rescheduled',
      );
    }
  }

  /**
   * Recover stuck runs — rows that were marked `running` when
   * the scheduler crashed. We can't safely call the runnable's
   * `reschedule()` here (the runnable may have changed since the
   * crash), so we just finalise the audit row. The runnable
   * itself will pick up the item again on the next tick if it's
   * still pending.
   */
  async recoverStuckJobs(): Promise<void> {
    const stuckRuns = await this.jobRunsRepo.listByStatus('running');

    for (const run of stuckRuns) {
      this.logger.warn(
        { runId: run.id, jobId: run.jobId },
        'Recovering stuck run',
      );

      await this.jobRunsRepo.updateStatus(run.id, {
        status: 'failed',
        finishedAt: new Date(),
        errorCode: 'SCHEDULER_CRASH',
        errorMessage: 'Run was in progress when scheduler stopped',
      });
    }

    if (stuckRuns.length > 0) {
      this.logger.info({ count: stuckRuns.length }, 'Recovered stuck runs');
    }
  }
}

/**
 * Create a scheduler service instance
 */
export function createSchedulerService(
  jobsRepo: JobsStore,
  jobRunsRepo: JobRunsStore,
  sessionMessageService: SessionMessageService,
  sessionsStore: SessionsStore,
  logger: GenericLogger,
  options?: SchedulerServiceOptions,
): SchedulerService {
  return new SchedulerService(
    jobsRepo,
    jobRunsRepo,
    sessionMessageService,
    sessionsStore,
    logger,
    options,
  );
}
