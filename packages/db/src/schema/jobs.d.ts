/**
 * Job type enum
 * - one-shot: executes once at a specific time
 * - cron: recurring job based on cron expression
 */
export declare const jobTypeEnum: import('drizzle-orm/pg-core').PgEnum<
  ['one-shot', 'cron']
>;
/**
 * Job status enum
 * - active: job is scheduled and will run
 * - paused: job is temporarily disabled
 * - completed: one-shot job finished successfully
 * - failed: job failed after max retries
 */
export declare const jobStatusEnum: import('drizzle-orm/pg-core').PgEnum<
  ['active', 'paused', 'completed', 'failed']
>;
/**
 * Job target type enum
 * - session: job targets an existing session
 * - isolated: job runs in isolation (no session context)
 */
export declare const jobTargetTypeEnum: import('drizzle-orm/pg-core').PgEnum<
  ['session', 'isolated']
>;
/**
 * Job run status enum
 * - queued: run is waiting to be processed
 * - running: run is currently executing
 * - succeeded: run completed successfully
 * - failed: run failed with an error
 */
export declare const jobRunStatusEnum: import('drizzle-orm/pg-core').PgEnum<
  ['queued', 'running', 'succeeded', 'failed']
>;
/**
 * Scheduled jobs table
 *
 * Stores job definitions for both one-shot and cron jobs.
 * Supports retry logic with exponential backoff.
 */
export declare const scheduledJobs: import('drizzle-orm/pg-core').PgTableWithColumns<{
  name: 'scheduled_jobs';
  schema: undefined;
  columns: {
    id: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'id';
        tableName: 'scheduled_jobs';
        dataType: 'string';
        columnType: 'PgUUID';
        data: string;
        driverParam: string;
        notNull: true;
        hasDefault: true;
        isPrimaryKey: true;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: undefined;
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    type: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'type';
        tableName: 'scheduled_jobs';
        dataType: 'string';
        columnType: 'PgEnumColumn';
        data: 'one-shot' | 'cron';
        driverParam: string;
        notNull: true;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: ['one-shot', 'cron'];
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    schedule: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'schedule';
        tableName: 'scheduled_jobs';
        dataType: 'date';
        columnType: 'PgTimestamp';
        data: Date;
        driverParam: string;
        notNull: false;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: undefined;
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    cronExpression: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'cron_expression';
        tableName: 'scheduled_jobs';
        dataType: 'string';
        columnType: 'PgText';
        data: string;
        driverParam: string;
        notNull: false;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: [string, ...string[]];
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    targetType: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'target_type';
        tableName: 'scheduled_jobs';
        dataType: 'string';
        columnType: 'PgEnumColumn';
        data: 'session' | 'isolated';
        driverParam: string;
        notNull: true;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: ['session', 'isolated'];
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    targetSessionId: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'target_session_id';
        tableName: 'scheduled_jobs';
        dataType: 'string';
        columnType: 'PgText';
        data: string;
        driverParam: string;
        notNull: false;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: [string, ...string[]];
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    payload: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'payload';
        tableName: 'scheduled_jobs';
        dataType: 'json';
        columnType: 'PgJsonb';
        data: Record<string, unknown>;
        driverParam: unknown;
        notNull: true;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: undefined;
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {
        $type: Record<string, unknown>;
      }
    >;
    status: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'status';
        tableName: 'scheduled_jobs';
        dataType: 'string';
        columnType: 'PgEnumColumn';
        data: 'active' | 'paused' | 'completed' | 'failed';
        driverParam: string;
        notNull: true;
        hasDefault: true;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: ['active', 'paused', 'completed', 'failed'];
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    nextRunAt: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'next_run_at';
        tableName: 'scheduled_jobs';
        dataType: 'date';
        columnType: 'PgTimestamp';
        data: Date;
        driverParam: string;
        notNull: true;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: undefined;
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    lastRunAt: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'last_run_at';
        tableName: 'scheduled_jobs';
        dataType: 'date';
        columnType: 'PgTimestamp';
        data: Date;
        driverParam: string;
        notNull: false;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: undefined;
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    retryCount: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'retry_count';
        tableName: 'scheduled_jobs';
        dataType: 'number';
        columnType: 'PgInteger';
        data: number;
        driverParam: string | number;
        notNull: true;
        hasDefault: true;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: undefined;
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    maxRetries: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'max_retries';
        tableName: 'scheduled_jobs';
        dataType: 'number';
        columnType: 'PgInteger';
        data: number;
        driverParam: string | number;
        notNull: true;
        hasDefault: true;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: undefined;
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    backoffMs: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'backoff_ms';
        tableName: 'scheduled_jobs';
        dataType: 'number';
        columnType: 'PgInteger';
        data: number;
        driverParam: string | number;
        notNull: true;
        hasDefault: true;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: undefined;
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    metadata: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'metadata';
        tableName: 'scheduled_jobs';
        dataType: 'json';
        columnType: 'PgJsonb';
        data: Record<string, unknown>;
        driverParam: unknown;
        notNull: false;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: undefined;
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {
        $type: Record<string, unknown>;
      }
    >;
    createdAt: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'created_at';
        tableName: 'scheduled_jobs';
        dataType: 'date';
        columnType: 'PgTimestamp';
        data: Date;
        driverParam: string;
        notNull: true;
        hasDefault: true;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: undefined;
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    updatedAt: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'updated_at';
        tableName: 'scheduled_jobs';
        dataType: 'date';
        columnType: 'PgTimestamp';
        data: Date;
        driverParam: string;
        notNull: true;
        hasDefault: true;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: undefined;
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
  };
  dialect: 'pg';
}>;
/**
 * Job runs table
 *
 * Tracks execution history for each job run.
 * Linked to scheduled_jobs with cascade delete.
 */
export declare const jobRuns: import('drizzle-orm/pg-core').PgTableWithColumns<{
  name: 'job_runs';
  schema: undefined;
  columns: {
    id: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'id';
        tableName: 'job_runs';
        dataType: 'string';
        columnType: 'PgUUID';
        data: string;
        driverParam: string;
        notNull: true;
        hasDefault: true;
        isPrimaryKey: true;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: undefined;
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    jobId: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'job_id';
        tableName: 'job_runs';
        dataType: 'string';
        columnType: 'PgUUID';
        data: string;
        driverParam: string;
        notNull: true;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: undefined;
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    status: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'status';
        tableName: 'job_runs';
        dataType: 'string';
        columnType: 'PgEnumColumn';
        data: 'failed' | 'queued' | 'running' | 'succeeded';
        driverParam: string;
        notNull: true;
        hasDefault: true;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: ['queued', 'running', 'succeeded', 'failed'];
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    startedAt: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'started_at';
        tableName: 'job_runs';
        dataType: 'date';
        columnType: 'PgTimestamp';
        data: Date;
        driverParam: string;
        notNull: false;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: undefined;
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    finishedAt: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'finished_at';
        tableName: 'job_runs';
        dataType: 'date';
        columnType: 'PgTimestamp';
        data: Date;
        driverParam: string;
        notNull: false;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: undefined;
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    errorCode: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'error_code';
        tableName: 'job_runs';
        dataType: 'string';
        columnType: 'PgText';
        data: string;
        driverParam: string;
        notNull: false;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: [string, ...string[]];
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    errorMessage: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'error_message';
        tableName: 'job_runs';
        dataType: 'string';
        columnType: 'PgText';
        data: string;
        driverParam: string;
        notNull: false;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: [string, ...string[]];
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    attemptNumber: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'attempt_number';
        tableName: 'job_runs';
        dataType: 'number';
        columnType: 'PgInteger';
        data: number;
        driverParam: string | number;
        notNull: true;
        hasDefault: true;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: undefined;
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
    resultData: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'result_data';
        tableName: 'job_runs';
        dataType: 'json';
        columnType: 'PgJsonb';
        data: Record<string, unknown>;
        driverParam: unknown;
        notNull: false;
        hasDefault: false;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: undefined;
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {
        $type: Record<string, unknown>;
      }
    >;
    createdAt: import('drizzle-orm/pg-core').PgColumn<
      {
        name: 'created_at';
        tableName: 'job_runs';
        dataType: 'date';
        columnType: 'PgTimestamp';
        data: Date;
        driverParam: string;
        notNull: true;
        hasDefault: true;
        isPrimaryKey: false;
        isAutoincrement: false;
        hasRuntimeDefault: false;
        enumValues: undefined;
        baseColumn: never;
        identity: undefined;
        generated: undefined;
      },
      {},
      {}
    >;
  };
  dialect: 'pg';
}>;
export type ScheduledJob = typeof scheduledJobs.$inferSelect;
export type NewScheduledJob = typeof scheduledJobs.$inferInsert;
export type JobRun = typeof jobRuns.$inferSelect;
export type NewJobRun = typeof jobRuns.$inferInsert;
export type JobType = (typeof jobTypeEnum.enumValues)[number];
export type JobStatus = (typeof jobStatusEnum.enumValues)[number];
export type JobTargetType = (typeof jobTargetTypeEnum.enumValues)[number];
export type JobRunStatus = (typeof jobRunStatusEnum.enumValues)[number];
