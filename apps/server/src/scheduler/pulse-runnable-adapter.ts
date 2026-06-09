/**
 * PulseRunnableAdapter
 *
 * Adapts the legacy "pulse" scheduled jobs (rows in the
 * `scheduled_jobs` table) to the `ScheduledRunnable` contract. Once
 * registered with the `SchedulerService`, pulses are claimed and
 * executed alongside the recurring-tasks executor (and any future
 * kind) inside the central polling loop.
 *
 * Before this adapter, pulses were dispatched by the
 * `SchedulerService` via a hard-coded switch on `targetType`
 * (session vs isolated). After this adapter, all of that lives in
 * one place (this file), the scheduler's tick is uniform, and the
 * `recoverStuckJobs` mechanism covers pulses too.
 *
 * Contract mapping
 * ----------------
 * - `claimNextDue`     -> `jobsRepo.claimNextDueJob()`. The
 *                         repository returns the next due job row;
 *                         we wrap it in the `PulsePayload` shape.
 * - `execute`          -> delegates to `sessionMessageService`
 *                         with the same session-vs-isolated
 *                         switch the scheduler used to do
 *                         inline.
 * - `reschedule`       -> mirrors the backoff/retry logic: on
 *                         success, advance nextRunAt via the cron
 *                         schedule; on failure, increment
 *                         retryCount, schedule the next run with
 *                         exponential backoff, or mark the job
 *                         `failed` if retries are exhausted.
 *
 * What this adapter does NOT do
 * -----------------------------
 * - It does NOT create `job_runs` rows. The central `SchedulerService`
 *   creates and updates those for `pulse`-kind runs automatically
 *   (see `runRunnable` in `service.ts`). The adapter is unaware of
 *   the audit trail, so the same code path is reusable for future
 *   scheduled kinds that may want different audit-trail shapes.
 * - It does NOT implement leader election or distributed locking.
 *   SQLite deployments are single-server; Postgres deployments will
 *   need `FOR UPDATE SKIP LOCKED` added to `claimNextDueJob`.
 */

import type {
  ScheduledRunnable,
  ClaimedItem,
  ExecutionResult,
} from '@openaidy/runtime';
import type {
  JobsStore,
  JobRunsStore,
  SessionsStore,
  ScheduledJob,
  JobRun,
} from '@openaidy/db';
import type { SessionMessageService } from '../sessions/service';
import type { GenericLogger } from './service';
import { calculateNextRun } from './cron-utils';

/**
 * The kind string used to register this runnable with the
 * scheduler. Exported so `SchedulerService.getRunnableKinds()` can
 * report it, and so other code can branch on it if needed (e.g. the
 * scheduler's `runRunnableWithJobRun` checks this to know when to
 * create a `job_runs` row).
 */
export const PULSE_RUNNABLE_KIND = 'pulse';

/**
 * What the adapter returns from `claimNextDue` and passes to
 * `execute` / `reschedule`. The whole `ScheduledJob` is cached so
 * `reschedule` can compute the next run + retry decision without
 * re-reading the DB.
 */
export type PulsePayload = {
  job: ScheduledJob;
};

/**
 * The minimal surface area the adapter needs from the session
 * service. We keep `SessionMessageService` direct (not a wrapper)
 * so the adapter is straightforward to test.
 */
export type PulseSessionService = Pick<
  SessionMessageService,
  'submitMessageStreaming'
>;
export type PulseRunnableDeps = {
  jobsRepo: JobsStore;
  jobRunsRepo: JobRunsStore;
  sessionsStore: SessionsStore;
  sessionMessageService: PulseSessionService;
  logger: GenericLogger;
  /**
   * Maximum backoff in ms. Defaults to 5 minutes. Matches the
   * SchedulerService's `maxBackoffMs` so retry behaviour is
   * identical to the legacy path.
   */
  maxBackoffMs?: number;
};

/**
 * Build a pulse runnable. Returns the adapter plus a few helpers
 * exposed for testing.
 */
export function createPulseRunnableAdapter(
  deps: PulseRunnableDeps,
): ScheduledRunnable<PulsePayload> {
  const maxBackoff = deps.maxBackoffMs ?? 5 * 60 * 1000;

  return {
    kind: PULSE_RUNNABLE_KIND,

    async claimNextDue(): Promise<ClaimedItem<PulsePayload> | null> {
      const job = await deps.jobsRepo.claimNextDueJob();
      if (!job) return null;
      return {
        id: job.id,
        payload: { job },
      };
    },

    async execute(
      _id: string,
      payload: PulsePayload,
    ): Promise<ExecutionResult> {
      const { job } = payload;
      const startedAt = Date.now();
      try {
        await executePulseJob(
          job,
          deps.sessionsStore,
          deps.sessionMessageService,
        );
        return { ok: true, durationMs: Date.now() - startedAt };
      } catch (err) {
        // Surface the error via the result so the scheduler's
        // `runRunnable` wrapper can update the JobRun row and
        // hand the result to `reschedule`.
        const error = err instanceof Error ? err : new Error(String(err));
        return {
          ok: false,
          error,
          durationMs: Date.now() - startedAt,
        };
      }
    },

    async reschedule(
      _id: string,
      payload: PulsePayload,
      result: ExecutionResult,
    ): Promise<Date | null> {
      const { job } = payload;
      return reschedulePulseJob(
        job,
        result,
        deps.jobsRepo,
        maxBackoff,
        deps.logger,
      );
    },
  };
}

// ============================================================================
// Internals
// ============================================================================

/**
 * Run the pulse's actual work. Splits on `targetType`: a
 * session-attached pulse reuses an existing session, an isolated
 * pulse creates a fresh one. Throws on failure (the adapter's
 * `execute` catches and converts to a failure `ExecutionResult`).
 */
async function executePulseJob(
  job: ScheduledJob,
  sessionsStore: SessionsStore,
  sessionMessageService: PulseSessionService,
): Promise<void> {
  if (job.targetType === 'session') {
    if (!job.targetSessionId) {
      throw new Error('Session job missing targetSessionId');
    }

    const messageInput: {
      sessionId: string;
      role: 'user';
      content: string;
      agentId?: string;
      providerId?: string;
      modelId?: string;
    } = {
      sessionId: job.targetSessionId,
      role: 'user',
      content: (job.payload.message as string) || 'Scheduled job execution',
    };

    const agentId = job.payload.agentId as string | undefined;
    const providerId = job.payload.providerId as string | undefined;
    const modelId = job.payload.modelId as string | undefined;
    if (agentId !== undefined) messageInput.agentId = agentId;
    if (providerId !== undefined) messageInput.providerId = providerId;
    if (modelId !== undefined) messageInput.modelId = modelId;

    const result = await sessionMessageService.submitMessageStreaming({
      ...messageInput,
      onStreamEvent: () => {},
    });
    if (!result.ok) {
      throw new Error(
        `Job execution failed: ${result.error.code} - ${result.error.message}`,
      );
    }
    return;
  }

  // Isolated target type — create a fresh session per run.
  const metadata = job.metadata as Record<string, unknown> | null;
  const pulseName = (metadata?.name as string | undefined) ?? 'unnamed';

  const newSession = await sessionsStore.create({
    title: `Pulse: ${pulseName}`,
  });

  const submitInput: Parameters<
    typeof sessionMessageService.submitMessageStreaming
  >[0] = {
    sessionId: newSession.id,
    role: 'user',
    content: (job.payload.message as string) || 'Scheduled job execution',
    onStreamEvent: () => {},
  };
  const agentId = job.payload.agentId as string | undefined;
  if (agentId !== undefined) submitInput.agentId = agentId;

  const result =
    await sessionMessageService.submitMessageStreaming(submitInput);
  if (!result.ok) {
    throw new Error(
      `Isolated job execution failed: ${result.error.code} - ${result.error.message}`,
    );
  }
}

/**
 * Compute the next `Date` for the job, given a successful result.
 * Re-uses `calculateNextRun` (which is the same helper the legacy
 * path used) for cron and preset schedules. Returns `null` for
 * one-shot jobs (terminal after first execution).
 */
function nextRunForSuccess(job: ScheduledJob): Date | null {
  if (job.cronExpression) {
    return calculateNextRun(job.cronExpression, new Date());
  }
  if (job.schedule) {
    return job.schedule;
  }
  if (job.type === 'one-shot') {
    return null;
  }
  // Fallback: keep the existing nextRunAt.
  return job.nextRunAt;
}

/**
 * Compute exponential backoff in ms. Duplicated here (not
 * imported from `SchedulerService`) so the adapter has zero
 * coupling to the scheduler class.
 */
function calculateBackoff(
  baseBackoffMs: number,
  retryCount: number,
  maxBackoffMs: number,
): number {
  const backoff = baseBackoffMs * Math.pow(2, retryCount);
  return Math.min(backoff, maxBackoffMs);
}

/**
 * Apply the result of an execution to the job's DB row. On
 * success, advances `nextRunAt` according to the schedule (or
 * marks the job `completed` for one-shots). On failure, decides
 * retry vs. terminal based on `retryCount` and `maxRetries`.
 *
 * Returns the new `nextRunAt` Date, or `null` for a terminal job.
 */
async function reschedulePulseJob(
  job: ScheduledJob,
  result: ExecutionResult,
  jobsRepo: JobsStore,
  maxBackoffMs: number,
  logger: GenericLogger,
): Promise<Date | null> {
  if (result.ok) {
    // Success: advance nextRunAt according to the schedule.
    const nextRunAt = nextRunForSuccess(job);
    if (nextRunAt === null) {
      // One-shot: terminal.
      await jobsRepo.update(job.id, {
        nextRunAt: new Date(),
        lastRunAt: new Date(),
        status: 'completed',
      });
      logger.info({ jobId: job.id }, 'One-shot pulse completed (terminal)');
      return null;
    }
    await jobsRepo.update(job.id, {
      nextRunAt,
      lastRunAt: new Date(),
    });
    logger.info(
      { jobId: job.id, nextRunAt: nextRunAt.toISOString() },
      'Pulse succeeded, next run scheduled',
    );
    return nextRunAt;
  }

  // Failure: decide retry vs. terminal.
  const newRetryCount = job.retryCount + 1;
  if (newRetryCount <= job.maxRetries) {
    const backoffMs = calculateBackoff(
      job.backoffMs,
      newRetryCount - 1,
      maxBackoffMs,
    );
    const nextRunAt = new Date(Date.now() + backoffMs);
    await jobsRepo.update(job.id, {
      retryCount: newRetryCount,
      nextRunAt,
      lastRunAt: new Date(),
    });
    logger.warn(
      {
        jobId: job.id,
        attempt: newRetryCount,
        maxRetries: job.maxRetries,
        backoffMs,
      },
      'Pulse failed, retry scheduled',
    );
    return nextRunAt;
  }

  // Max retries exceeded.
  await jobsRepo.update(job.id, {
    status: 'failed',
    lastRunAt: new Date(),
  });
  logger.error(
    { jobId: job.id, maxRetries: job.maxRetries },
    'Pulse permanently failed after max retries',
  );
  return null;
}

// ============================================================================
// Manual trigger
// ============================================================================

/**
 * Run a specific pulse job immediately, without waiting for the
 * scheduler's tick. Mirrors the legacy `SchedulerService.triggerJob`
 * (which we removed when migrating pulses to the runnable
 * registry) so the `POST /api/pulses/:id/trigger` route still
 * works.
 *
 * Creates a fresh `JobRun` row (the scheduler is unaware of this
 * manual run), executes the pulse, updates the run to its
 * terminal status, and returns the run.
 *
 * Does NOT touch the job's `nextRunAt`/`retryCount` — a manual
 * trigger does not consume a scheduled run.
 */
export async function triggerPulseNow(
  jobId: string,
  deps: PulseRunnableDeps,
): Promise<JobRun> {
  const job = await deps.jobsRepo.findById(jobId);
  if (!job) {
    throw new Error('Job not found');
  }

  // Create and execute run immediately. Same shape the scheduler
  // would have created for a tracked-kind run.
  const run = await deps.jobRunsRepo.create({
    jobId: job.id,
    status: 'queued',
    attemptNumber: 0, // manual trigger doesn't count as retry
  });

  await deps.jobRunsRepo.updateStatus(run.id, {
    status: 'running',
    startedAt: new Date(),
  });

  try {
    await executePulseJob(job, deps.sessionsStore, deps.sessionMessageService);
    await deps.jobRunsRepo.updateStatus(run.id, {
      status: 'succeeded',
      finishedAt: new Date(),
    });
    deps.logger.info(
      { jobId: job.id, runId: run.id },
      'Manual pulse trigger succeeded',
    );
  } catch (error) {
    await deps.jobRunsRepo.updateStatus(run.id, {
      status: 'failed',
      finishedAt: new Date(),
      errorCode: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    deps.logger.error(
      { jobId: job.id, runId: run.id, error },
      'Manual pulse trigger failed',
    );
    throw error;
  }

  return run;
}
