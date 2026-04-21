import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  pgEnum,
  uuid,
  index,
} from 'drizzle-orm/pg-core';
/**
 * Job type enum
 * - one-shot: executes once at a specific time
 * - cron: recurring job based on cron expression
 */
export const jobTypeEnum = pgEnum('job_type', ['one-shot', 'cron']);
/**
 * Job status enum
 * - active: job is scheduled and will run
 * - paused: job is temporarily disabled
 * - completed: one-shot job finished successfully
 * - failed: job failed after max retries
 */
export const jobStatusEnum = pgEnum('job_status', [
  'active',
  'paused',
  'completed',
  'failed',
]);
/**
 * Job target type enum
 * - session: job targets an existing session
 * - isolated: job runs in isolation (no session context)
 */
export const jobTargetTypeEnum = pgEnum('job_target_type', [
  'session',
  'isolated',
]);
/**
 * Job run status enum
 * - queued: run is waiting to be processed
 * - running: run is currently executing
 * - succeeded: run completed successfully
 * - failed: run failed with an error
 */
export const jobRunStatusEnum = pgEnum('job_run_status', [
  'queued',
  'running',
  'succeeded',
  'failed',
]);
/**
 * Scheduled jobs table
 *
 * Stores job definitions for both one-shot and cron jobs.
 * Supports retry logic with exponential backoff.
 */
export const scheduledJobs = pgTable(
  'scheduled_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: jobTypeEnum('type').notNull(),
    // For one-shot jobs: ISO 8601 timestamp when to run
    schedule: timestamp('schedule', { withTimezone: true }),
    // For cron jobs: cron expression (e.g., "*/5 * * * *")
    cronExpression: text('cron_expression'),
    targetType: jobTargetTypeEnum('target_type').notNull(),
    // Required if targetType is 'session'
    targetSessionId: text('target_session_id'),
    // Job-specific data (message, instructions, etc.)
    payload: jsonb('payload').notNull().$type(),
    status: jobStatusEnum('status').notNull().default('active'),
    // When the job should run next
    nextRunAt: timestamp('next_run_at', { withTimezone: true }).notNull(),
    // When the job last executed
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    // Current retry attempt (0 = first attempt)
    retryCount: integer('retry_count').notNull().default(0),
    // Maximum retry attempts before marking as failed
    maxRetries: integer('max_retries').notNull().default(3),
    // Base backoff delay in milliseconds (doubles on each retry)
    backoffMs: integer('backoff_ms').notNull().default(1000),
    // Additional job metadata
    metadata: jsonb('metadata').$type(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('scheduled_jobs_next_run_at_idx').on(table.nextRunAt),
    index('scheduled_jobs_status_idx').on(table.status),
    index('scheduled_jobs_type_idx').on(table.type),
  ],
);
/**
 * Job runs table
 *
 * Tracks execution history for each job run.
 * Linked to scheduled_jobs with cascade delete.
 */
export const jobRuns = pgTable(
  'job_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => scheduledJobs.id, { onDelete: 'cascade' }),
    status: jobRunStatusEnum('status').notNull().default('queued'),
    // When the run started executing
    startedAt: timestamp('started_at', { withTimezone: true }),
    // When the run finished
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    // Error code (e.g., 'TIMEOUT', 'PROVIDER_ERROR', 'UNKNOWN_ERROR')
    errorCode: text('error_code'),
    // Detailed error message
    errorMessage: text('error_message'),
    // Which retry attempt this was (1 = first attempt)
    attemptNumber: integer('attempt_number').notNull().default(1),
    // Execution result data
    resultData: jsonb('result_data').$type(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('job_runs_job_id_idx').on(table.jobId),
    index('job_runs_status_idx').on(table.status),
    index('job_runs_created_at_idx').on(table.createdAt),
  ],
);
