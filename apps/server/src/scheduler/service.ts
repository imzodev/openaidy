import type { JobsStore, JobRunsStore, SessionsStore } from '@openaidy/db';
import type { ScheduledJob, JobRun } from '@openaidy/db';
import type { SessionMessageService } from '../sessions/service';
import { calculateNextRun } from './cron-utils';

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
  private readonly maxBackoffMs: number = 300000; // 5 minutes max

  constructor(
    private readonly jobsRepo: JobsStore,
    private readonly jobRunsRepo: JobRunsStore,
    private readonly sessionMessageService: SessionMessageService,
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
   * Single tick - claim and execute one due job
   * Returns true if a job was executed, false if none due
   */
  async tick(): Promise<boolean> {
    if (!this.isRunning) {
      return false;
    }

    this.tickInProgress = true;

    try {
      // 1. Claim next due job atomically
      const job = await this.jobsRepo.claimNextDueJob();
      if (!job) {
        return false; // No due jobs
      }

      this.logger.info({ jobId: job.id }, 'Claimed job for execution');

      // 2. Create job run record
      const run = await this.jobRunsRepo.create({
        jobId: job.id,
        status: 'queued',
        attemptNumber: job.retryCount + 1,
      });

      // 3. Update run to running
      await this.jobRunsRepo.updateStatus(run.id, {
        status: 'running',
        startedAt: new Date(),
      });

      // 4. Execute job based on type
      try {
        await this.executeJob(job, run);

        // 5a. Success: mark run succeeded
        await this.jobRunsRepo.updateStatus(run.id, {
          status: 'succeeded',
          finishedAt: new Date(),
        });

        // 5b. Update job based on type
        if (job.type === 'one-shot') {
          await this.jobsRepo.update(job.id, {
            status: 'completed',
            lastRunAt: new Date(),
          });
          this.logger.info({ jobId: job.id }, 'One-shot job completed');
        } else if (job.type === 'cron') {
          const nextRun = calculateNextRun(job.cronExpression!, new Date());
          await this.jobsRepo.update(job.id, {
            nextRunAt: nextRun,
            lastRunAt: new Date(),
            retryCount: 0, // reset retry count on success
          });
          this.logger.info(
            { jobId: job.id, nextRunAt: nextRun },
            'Cron job completed, rescheduled',
          );
        }

        return true;
      } catch (error) {
        // 6. Failure: handle retry logic
        await this.handleJobFailure(job, run, error);
        return true;
      }
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
   * Manual trigger - execute a specific job immediately
   */
  async triggerJob(jobId: string): Promise<JobRun> {
    const job = await this.jobsRepo.findById(jobId);
    if (!job) {
      throw new Error('Job not found');
    }

    // Create and execute run immediately
    const run = await this.jobRunsRepo.create({
      jobId: job.id,
      status: 'queued',
      attemptNumber: 0, // manual trigger doesn't count as retry
    });

    await this.jobRunsRepo.updateStatus(run.id, {
      status: 'running',
      startedAt: new Date(),
    });

    try {
      await this.executeJob(job, run);
      await this.jobRunsRepo.updateStatus(run.id, {
        status: 'succeeded',
        finishedAt: new Date(),
      });
      this.logger.info(
        { jobId: job.id, runId: run.id },
        'Manual trigger succeeded',
      );
    } catch (error) {
      await this.jobRunsRepo.updateStatus(run.id, {
        status: 'failed',
        finishedAt: new Date(),
        errorCode: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      this.logger.error(
        { jobId: job.id, runId: run.id, error },
        'Manual trigger failed',
      );
      throw error;
    }

    return run;
  }

  /**
   * Check if scheduler is running
   */
  isActive(): boolean {
    return this.isRunning;
  }

  /**
   * Execute job based on target type
   */
  private async executeJob(job: ScheduledJob, _run: JobRun): Promise<void> {
    if (job.targetType === 'session') {
      // Execute against existing session
      if (!job.targetSessionId) {
        throw new Error('Session job missing targetSessionId');
      }

      // Build the message input, only including optional fields if they have values
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

      // Use SessionMessageService to submit message
      const result = await this.sessionMessageService.submitMessageStreaming({
        ...messageInput,
        onStreamEvent: () => {},
      });

      if (!result.ok) {
        throw new Error(
          `Job execution failed: ${result.error.code} - ${result.error.message}`,
        );
      }
    } else {
      // Isolated execution - create a fresh session for the pulse
      const metadata = job.metadata as Record<string, unknown> | null;
      const pulseName = (metadata?.name as string | undefined) ?? 'unnamed';

      // Create a new session for this isolated execution
      const newSession = await this.sessionsStore.create({
        title: `Pulse: ${pulseName}`,
      });

      // Submit the message to the new session
      const submitInput: Parameters<
        typeof this.sessionMessageService.submitMessageStreaming
      >[0] = {
        sessionId: newSession.id,
        role: 'user',
        content: (job.payload.message as string) || 'Scheduled job execution',
        onStreamEvent: () => {},
      };
      const agentId = job.payload.agentId as string | undefined;
      if (agentId !== undefined) submitInput.agentId = agentId;
      const result =
        await this.sessionMessageService.submitMessageStreaming(submitInput);

      if (!result.ok) {
        throw new Error(
          `Isolated job execution failed: ${result.error.code} - ${result.error.message}`,
        );
      }
    }
  }

  /**
   * Handle job failure with retry logic
   */
  private async handleJobFailure(
    job: ScheduledJob,
    run: JobRun,
    error: unknown,
  ): Promise<void> {
    // Mark run as failed
    await this.jobRunsRepo.updateStatus(run.id, {
      status: 'failed',
      finishedAt: new Date(),
      errorCode: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
      errorMessage: error instanceof Error ? error.message : String(error),
    });

    // Check if should retry
    if (job.retryCount < job.maxRetries) {
      // Calculate exponential backoff
      const backoffMs = this.calculateBackoff(job.backoffMs, job.retryCount);
      const nextRunAt = new Date(Date.now() + backoffMs);

      await this.jobsRepo.update(job.id, {
        retryCount: job.retryCount + 1,
        nextRunAt,
        lastRunAt: new Date(),
      });

      this.logger.warn(
        {
          jobId: job.id,
          attempt: job.retryCount + 1,
          maxRetries: job.maxRetries,
          backoffMs,
        },
        `Job failed, retry scheduled`,
      );
    } else {
      // Max retries exceeded, mark job as failed
      await this.jobsRepo.update(job.id, {
        status: 'failed',
        lastRunAt: new Date(),
      });

      this.logger.error(
        { jobId: job.id, maxRetries: job.maxRetries },
        'Job permanently failed after max retries',
      );
    }
  }

  /**
   * Calculate exponential backoff
   */
  private calculateBackoff(baseBackoffMs: number, retryCount: number): number {
    // Exponential: backoff * 2^retryCount
    const backoff = baseBackoffMs * Math.pow(2, retryCount);

    // Cap at maximum
    return Math.min(backoff, this.maxBackoffMs);
  }

  /**
   * Recover stuck jobs that were running when scheduler crashed
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
        errorMessage: 'Job was running when scheduler stopped',
      });

      // Trigger retry for the job
      const job = await this.jobsRepo.findById(run.jobId);
      if (job && job.status === 'active') {
        await this.handleJobFailure(job, run, new Error('Scheduler crash'));
      }
    }

    if (stuckRuns.length > 0) {
      this.logger.info({ count: stuckRuns.length }, 'Recovered stuck jobs');
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
