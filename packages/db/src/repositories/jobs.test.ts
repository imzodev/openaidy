import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as sessionSchema from '../schema/sessions';
import * as jobsSchema from '../schema/jobs';
import { SessionsRepository } from './sessions';
import { JobsRepository } from './jobs';
import { JobRunsRepository } from './job-runs';

// Combined schema type
type CombinedSchema = typeof sessionSchema & typeof jobsSchema;
type Database = NodePgDatabase<CombinedSchema>;

/**
 * Integration tests for jobs repositories
 *
 * These tests require a PostgreSQL database. Set DATABASE_URL to run.
 */
describe('Jobs Repositories (integration)', () => {
  // Skip tests if no DATABASE_URL
  const databaseUrl = process.env.DATABASE_URL;
  const shouldRun = !!databaseUrl;

  let pool: Pool | undefined;
  let db: Database | undefined;
  let sessionsRepo: SessionsRepository | undefined;
  let jobsRepo: JobsRepository | undefined;
  let jobRunsRepo: JobRunsRepository | undefined;

  beforeEach(async () => {
    if (!shouldRun || !databaseUrl) return;

    pool = new Pool({ connectionString: databaseUrl });
    db = drizzle(pool, {
      schema: { ...sessionSchema, ...jobsSchema },
    }) as Database;

    sessionsRepo = new SessionsRepository(db);
    jobsRepo = new JobsRepository(db);
    jobRunsRepo = new JobRunsRepository(db);

    // Clean up test data (order matters due to foreign keys)
    await db.delete(jobsSchema.jobRuns);
    await db.delete(jobsSchema.scheduledJobs);
    await db.delete(sessionSchema.sessionRuns);
    await db.delete(sessionSchema.sessionMessages);
    await db.delete(sessionSchema.sessions);
  });

  afterEach(async () => {
    if (pool) {
      await pool.end();
    }
  });

  // Mark tests as skipped when no database
  const test = shouldRun ? it : it.skip;

  describe('JobsRepository', () => {
    describe('create()', () => {
      test('should create a one-shot job with all required fields', async () => {
        const nextRunAt = new Date(Date.now() + 60000);
        const job = await jobsRepo!.create({
          type: 'one-shot',
          schedule: nextRunAt,
          targetType: 'isolated',
          payload: { message: 'Test job' },
          nextRunAt,
        });

        expect(job.id).toBeDefined();
        expect(job.type).toBe('one-shot');
        expect(job.schedule).toEqual(nextRunAt);
        expect(job.targetType).toBe('isolated');
        expect(job.payload).toEqual({ message: 'Test job' });
        expect(job.status).toBe('active');
        expect(job.retryCount).toBe(0);
        expect(job.maxRetries).toBe(3);
        expect(job.backoffMs).toBe(1000);
      });

      test('should create a cron job with cron expression', async () => {
        const nextRunAt = new Date(Date.now() + 60000);
        const job = await jobsRepo!.create({
          type: 'cron',
          cronExpression: '*/5 * * * *',
          targetType: 'isolated',
          payload: { task: 'cleanup' },
          nextRunAt,
        });

        expect(job.id).toBeDefined();
        expect(job.type).toBe('cron');
        expect(job.cronExpression).toBe('*/5 * * * *');
        expect(job.schedule).toBeNull();
      });

      test('should create a session-targeted job', async () => {
        const session = await sessionsRepo!.create({ title: 'Target Session' });
        const nextRunAt = new Date(Date.now() + 60000);

        const job = await jobsRepo!.create({
          type: 'one-shot',
          schedule: nextRunAt,
          targetType: 'session',
          targetSessionId: session.id,
          payload: { message: 'Session job' },
          nextRunAt,
        });

        expect(job.targetType).toBe('session');
        expect(job.targetSessionId).toBe(session.id);
      });

      test('should set default values for optional fields', async () => {
        const nextRunAt = new Date(Date.now() + 60000);
        const job = await jobsRepo!.create({
          type: 'one-shot',
          targetType: 'isolated',
          payload: {},
          nextRunAt,
        });

        expect(job.status).toBe('active');
        expect(job.maxRetries).toBe(3);
        expect(job.backoffMs).toBe(1000);
        expect(job.retryCount).toBe(0);
        expect(job.metadata).toBeNull();
      });

      test('should accept custom maxRetries and backoffMs', async () => {
        const nextRunAt = new Date(Date.now() + 60000);
        const job = await jobsRepo!.create({
          type: 'one-shot',
          targetType: 'isolated',
          payload: {},
          maxRetries: 5,
          backoffMs: 2000,
          nextRunAt,
        });

        expect(job.maxRetries).toBe(5);
        expect(job.backoffMs).toBe(2000);
      });

      test('should create job with paused status', async () => {
        const nextRunAt = new Date(Date.now() + 60000);
        const job = await jobsRepo!.create({
          type: 'one-shot',
          targetType: 'isolated',
          payload: {},
          status: 'paused',
          nextRunAt,
        });

        expect(job.status).toBe('paused');
      });
    });

    describe('findById()', () => {
      test('should return job when exists', async () => {
        const nextRunAt = new Date(Date.now() + 60000);
        const created = await jobsRepo!.create({
          type: 'one-shot',
          targetType: 'isolated',
          payload: { test: 'data' },
          nextRunAt,
        });

        const found = await jobsRepo!.findById(created.id);

        expect(found).toBeDefined();
        expect(found?.id).toBe(created.id);
        expect(found?.payload).toEqual({ test: 'data' });
      });

      test('should return null when not found', async () => {
        const found = await jobsRepo!.findById(
          '00000000-0000-0000-0000-000000000000',
        );
        expect(found).toBeNull();
      });
    });

    describe('list()', () => {
      test('should return all jobs when no filters', async () => {
        const nextRunAt = new Date(Date.now() + 60000);
        await jobsRepo!.create({
          type: 'one-shot',
          targetType: 'isolated',
          payload: {},
          nextRunAt,
        });
        await jobsRepo!.create({
          type: 'cron',
          targetType: 'isolated',
          payload: {},
          cronExpression: '* * * * *',
          nextRunAt,
        });

        const jobs = await jobsRepo!.list();
        expect(jobs).toHaveLength(2);
      });

      test('should filter by status', async () => {
        const nextRunAt = new Date(Date.now() + 60000);
        await jobsRepo!.create({
          type: 'one-shot',
          targetType: 'isolated',
          payload: {},
          status: 'active',
          nextRunAt,
        });
        await jobsRepo!.create({
          type: 'one-shot',
          targetType: 'isolated',
          payload: {},
          status: 'paused',
          nextRunAt,
        });

        const activeJobs = await jobsRepo!.list({ status: 'active' });
        expect(activeJobs).toHaveLength(1);
        expect(activeJobs[0]?.status).toBe('active');
      });

      test('should filter by type', async () => {
        const nextRunAt = new Date(Date.now() + 60000);
        await jobsRepo!.create({
          type: 'one-shot',
          targetType: 'isolated',
          payload: {},
          nextRunAt,
        });
        await jobsRepo!.create({
          type: 'cron',
          targetType: 'isolated',
          payload: {},
          cronExpression: '* * * * *',
          nextRunAt,
        });

        const cronJobs = await jobsRepo!.list({ type: 'cron' });
        expect(cronJobs).toHaveLength(1);
        expect(cronJobs[0]?.type).toBe('cron');
      });

      test('should filter by targetSessionId', async () => {
        const session = await sessionsRepo!.create({ title: 'Test' });
        const nextRunAt = new Date(Date.now() + 60000);

        await jobsRepo!.create({
          type: 'one-shot',
          targetType: 'session',
          targetSessionId: session.id,
          payload: {},
          nextRunAt,
        });
        await jobsRepo!.create({
          type: 'one-shot',
          targetType: 'isolated',
          payload: {},
          nextRunAt,
        });

        const sessionJobs = await jobsRepo!.list({
          targetSessionId: session.id,
        });
        expect(sessionJobs).toHaveLength(1);
        expect(sessionJobs[0]?.targetSessionId).toBe(session.id);
      });

      test('should respect limit and offset for pagination', async () => {
        const nextRunAt = new Date(Date.now() + 60000);
        for (let i = 0; i < 5; i++) {
          await jobsRepo!.create({
            type: 'one-shot',
            targetType: 'isolated',
            payload: { index: i },
            nextRunAt,
          });
        }

        const page1 = await jobsRepo!.list({ limit: 2, offset: 0 });
        const page2 = await jobsRepo!.list({ limit: 2, offset: 2 });

        expect(page1).toHaveLength(2);
        expect(page2).toHaveLength(2);
      });
    });

    describe('update()', () => {
      test('should update status', async () => {
        const nextRunAt = new Date(Date.now() + 60000);
        const job = await jobsRepo!.create({
          type: 'one-shot',
          targetType: 'isolated',
          payload: {},
          nextRunAt,
        });

        const updated = await jobsRepo!.update(job.id, { status: 'paused' });

        expect(updated.status).toBe('paused');
      });

      test('should update nextRunAt and lastRunAt', async () => {
        const nextRunAt = new Date(Date.now() + 60000);
        const job = await jobsRepo!.create({
          type: 'cron',
          targetType: 'isolated',
          payload: {},
          cronExpression: '* * * * *',
          nextRunAt,
        });

        const newNextRun = new Date(Date.now() + 120000);
        const lastRun = new Date();
        const updated = await jobsRepo!.update(job.id, {
          nextRunAt: newNextRun,
          lastRunAt: lastRun,
        });

        expect(updated.nextRunAt).toEqual(newNextRun);
        expect(updated.lastRunAt).toEqual(lastRun);
      });

      test('should update retryCount', async () => {
        const nextRunAt = new Date(Date.now() + 60000);
        const job = await jobsRepo!.create({
          type: 'one-shot',
          targetType: 'isolated',
          payload: {},
          nextRunAt,
        });

        const updated = await jobsRepo!.update(job.id, { retryCount: 2 });

        expect(updated.retryCount).toBe(2);
      });

      test('should update metadata', async () => {
        const nextRunAt = new Date(Date.now() + 60000);
        const job = await jobsRepo!.create({
          type: 'one-shot',
          targetType: 'isolated',
          payload: {},
          nextRunAt,
        });

        const updated = await jobsRepo!.update(job.id, {
          metadata: { lastError: 'connection timeout' },
        });

        expect(updated.metadata).toEqual({ lastError: 'connection timeout' });
      });
    });

    describe('delete()', () => {
      test('should remove job from database', async () => {
        const nextRunAt = new Date(Date.now() + 60000);
        const job = await jobsRepo!.create({
          type: 'one-shot',
          targetType: 'isolated',
          payload: {},
          nextRunAt,
        });

        await jobsRepo!.delete(job.id);

        const found = await jobsRepo!.findById(job.id);
        expect(found).toBeNull();
      });

      test('should cascade delete job runs', async () => {
        const nextRunAt = new Date(Date.now() + 60000);
        const job = await jobsRepo!.create({
          type: 'one-shot',
          targetType: 'isolated',
          payload: {},
          nextRunAt,
        });

        const run = await jobRunsRepo!.create({
          jobId: job.id,
          status: 'queued',
          attemptNumber: 1,
        });

        await jobsRepo!.delete(job.id);

        const foundRun = await jobRunsRepo!.findById(run.id);
        expect(foundRun).toBeNull();
      });
    });

    describe('claimNextDueJob()', () => {
      test('should return null when no due jobs', async () => {
        // Create a job in the future
        const futureDate = new Date(Date.now() + 3600000); // 1 hour from now
        await jobsRepo!.create({
          type: 'one-shot',
          targetType: 'isolated',
          payload: {},
          nextRunAt: futureDate,
        });

        const job = await jobsRepo!.claimNextDueJob();
        expect(job).toBeNull();
      });

      test('should return job when due', async () => {
        const pastDate = new Date(Date.now() - 1000); // 1 second ago
        const created = await jobsRepo!.create({
          type: 'one-shot',
          targetType: 'isolated',
          payload: { test: 'due' },
          nextRunAt: pastDate,
        });

        const job = await jobsRepo!.claimNextDueJob();

        expect(job).toBeDefined();
        expect(job?.id).toBe(created.id);
      });

      test('should only return active jobs', async () => {
        const pastDate = new Date(Date.now() - 1000);
        await jobsRepo!.create({
          type: 'one-shot',
          targetType: 'isolated',
          payload: {},
          status: 'paused',
          nextRunAt: pastDate,
        });

        const job = await jobsRepo!.claimNextDueJob();
        expect(job).toBeNull();
      });

      test('should skip paused jobs', async () => {
        const pastDate = new Date(Date.now() - 1000);

        // Create paused job
        await jobsRepo!.create({
          type: 'one-shot',
          targetType: 'isolated',
          payload: { status: 'paused' },
          status: 'paused',
          nextRunAt: pastDate,
        });

        // Create active job
        const activeJob = await jobsRepo!.create({
          type: 'one-shot',
          targetType: 'isolated',
          payload: { status: 'active' },
          nextRunAt: pastDate,
        });

        const job = await jobsRepo!.claimNextDueJob();
        expect(job?.id).toBe(activeJob.id);
      });

      // This test requires actual concurrent connections which is harder to test in unit tests
      // Skipping - would require multiple database connections
    });

    describe('countByStatus()', () => {
      test('should return correct counts', async () => {
        const nextRunAt = new Date(Date.now() + 60000);
        await jobsRepo!.create({
          type: 'one-shot',
          targetType: 'isolated',
          payload: {},
          status: 'active',
          nextRunAt,
        });
        await jobsRepo!.create({
          type: 'one-shot',
          targetType: 'isolated',
          payload: {},
          status: 'active',
          nextRunAt,
        });
        await jobsRepo!.create({
          type: 'one-shot',
          targetType: 'isolated',
          payload: {},
          status: 'paused',
          nextRunAt,
        });

        const activeCount = await jobsRepo!.countByStatus('active');
        const pausedCount = await jobsRepo!.countByStatus('paused');

        expect(activeCount).toBe(2);
        expect(pausedCount).toBe(1);
      });
    });

    describe('listActive()', () => {
      test('should return only active jobs', async () => {
        const nextRunAt = new Date(Date.now() + 60000);
        await jobsRepo!.create({
          type: 'one-shot',
          targetType: 'isolated',
          payload: {},
          status: 'active',
          nextRunAt,
        });
        await jobsRepo!.create({
          type: 'one-shot',
          targetType: 'isolated',
          payload: {},
          status: 'paused',
          nextRunAt,
        });

        const activeJobs = await jobsRepo!.listActive();
        expect(activeJobs).toHaveLength(1);
        expect(activeJobs[0]?.status).toBe('active');
      });
    });
  });

  describe('JobRunsRepository', () => {
    let jobId: string;

    beforeEach(async () => {
      const nextRunAt = new Date(Date.now() + 60000);
      const job = await jobsRepo!.create({
        type: 'one-shot',
        targetType: 'isolated',
        payload: {},
        nextRunAt,
      });
      jobId = job.id;
    });

    describe('create()', () => {
      test('should create run with required fields', async () => {
        const run = await jobRunsRepo!.create({
          jobId,
          status: 'queued',
          attemptNumber: 1,
        });

        expect(run.id).toBeDefined();
        expect(run.jobId).toBe(jobId);
        expect(run.status).toBe('queued');
        expect(run.attemptNumber).toBe(1);
      });

      test('should link run to job via foreign key', async () => {
        const run = await jobRunsRepo!.create({
          jobId,
          status: 'queued',
          attemptNumber: 1,
        });

        expect(run.jobId).toBe(jobId);
      });
    });

    describe('findById()', () => {
      test('should return run when exists', async () => {
        const created = await jobRunsRepo!.create({
          jobId,
          status: 'queued',
          attemptNumber: 1,
        });

        const found = await jobRunsRepo!.findById(created.id);

        expect(found).toBeDefined();
        expect(found?.id).toBe(created.id);
      });

      test('should return null when not found', async () => {
        const found = await jobRunsRepo!.findById(
          '00000000-0000-0000-0000-000000000000',
        );
        expect(found).toBeNull();
      });
    });

    describe('listByJob()', () => {
      test('should return all runs for a job', async () => {
        await jobRunsRepo!.create({
          jobId,
          status: 'queued',
          attemptNumber: 1,
        });
        await jobRunsRepo!.create({
          jobId,
          status: 'succeeded',
          attemptNumber: 2,
        });

        const runs = await jobRunsRepo!.listByJob(jobId);
        expect(runs).toHaveLength(2);
      });

      test('should return empty array when no runs', async () => {
        const runs = await jobRunsRepo!.listByJob(jobId);
        expect(runs).toEqual([]);
      });

      test('should respect limit and offset', async () => {
        for (let i = 0; i < 5; i++) {
          await jobRunsRepo!.create({
            jobId,
            status: 'succeeded',
            attemptNumber: i + 1,
          });
        }

        const page1 = await jobRunsRepo!.listByJob(jobId, {
          limit: 2,
          offset: 0,
        });
        const page2 = await jobRunsRepo!.listByJob(jobId, {
          limit: 2,
          offset: 2,
        });

        expect(page1).toHaveLength(2);
        expect(page2).toHaveLength(2);
      });

      test('should order by created_at descending', async () => {
        await jobRunsRepo!.create({
          jobId,
          status: 'succeeded',
          attemptNumber: 1,
        });
        await new Promise((r) => setTimeout(r, 10)); // Small delay
        await jobRunsRepo!.create({
          jobId,
          status: 'succeeded',
          attemptNumber: 2,
        });

        const runs = await jobRunsRepo!.listByJob(jobId);
        expect(runs[0]?.attemptNumber).toBe(2);
        expect(runs[1]?.attemptNumber).toBe(1);
      });
    });

    describe('updateStatus()', () => {
      test('should update status to running', async () => {
        const run = await jobRunsRepo!.create({
          jobId,
          status: 'queued',
          attemptNumber: 1,
        });

        const updated = await jobRunsRepo!.updateStatus(run.id, {
          status: 'running',
          startedAt: new Date(),
        });

        expect(updated.status).toBe('running');
        expect(updated.startedAt).toBeInstanceOf(Date);
      });

      test('should update status to succeeded with result', async () => {
        const run = await jobRunsRepo!.create({
          jobId,
          status: 'running',
          attemptNumber: 1,
        });

        const updated = await jobRunsRepo!.updateStatus(run.id, {
          status: 'succeeded',
          finishedAt: new Date(),
          resultData: { output: 'success' },
        });

        expect(updated.status).toBe('succeeded');
        expect(updated.finishedAt).toBeInstanceOf(Date);
        expect(updated.resultData).toEqual({ output: 'success' });
      });

      test('should update status to failed with error', async () => {
        const run = await jobRunsRepo!.create({
          jobId,
          status: 'running',
          attemptNumber: 1,
        });

        const updated = await jobRunsRepo!.updateStatus(run.id, {
          status: 'failed',
          finishedAt: new Date(),
          errorCode: 'TIMEOUT',
          errorMessage: 'Job timed out after 30 seconds',
        });

        expect(updated.status).toBe('failed');
        expect(updated.errorCode).toBe('TIMEOUT');
        expect(updated.errorMessage).toBe('Job timed out after 30 seconds');
      });

      test('should set timestamps correctly', async () => {
        const run = await jobRunsRepo!.create({
          jobId,
          status: 'queued',
          attemptNumber: 1,
        });

        const startedAt = new Date();
        const finishedAt = new Date(startedAt.getTime() + 5000);

        const updated = await jobRunsRepo!.updateStatus(run.id, {
          status: 'succeeded',
          startedAt,
          finishedAt,
        });

        expect(updated.startedAt).toEqual(startedAt);
        expect(updated.finishedAt).toEqual(finishedAt);
      });
    });

    describe('getLatestByJob()', () => {
      test('should return most recent run', async () => {
        await jobRunsRepo!.create({
          jobId,
          status: 'succeeded',
          attemptNumber: 1,
        });
        await new Promise((r) => setTimeout(r, 10));
        const latest = await jobRunsRepo!.create({
          jobId,
          status: 'succeeded',
          attemptNumber: 2,
        });

        const found = await jobRunsRepo!.getLatestByJob(jobId);
        expect(found?.id).toBe(latest.id);
      });

      test('should return null when no runs', async () => {
        const found = await jobRunsRepo!.getLatestByJob(jobId);
        expect(found).toBeNull();
      });
    });

    describe('countByJobAndStatus()', () => {
      test('should return correct counts', async () => {
        await jobRunsRepo!.create({
          jobId,
          status: 'succeeded',
          attemptNumber: 1,
        });
        await jobRunsRepo!.create({
          jobId,
          status: 'succeeded',
          attemptNumber: 2,
        });
        await jobRunsRepo!.create({
          jobId,
          status: 'failed',
          attemptNumber: 3,
        });

        const succeededCount = await jobRunsRepo!.countByJobAndStatus(
          jobId,
          'succeeded',
        );
        const failedCount = await jobRunsRepo!.countByJobAndStatus(
          jobId,
          'failed',
        );

        expect(succeededCount).toBe(2);
        expect(failedCount).toBe(1);
      });
    });

    describe('listByStatus()', () => {
      test('should list runs by status', async () => {
        await jobRunsRepo!.create({
          jobId,
          status: 'queued',
          attemptNumber: 1,
        });
        await jobRunsRepo!.create({
          jobId,
          status: 'running',
          attemptNumber: 2,
        });

        const queued = await jobRunsRepo!.listByStatus('queued');
        expect(queued).toHaveLength(1);
        expect(queued[0]?.status).toBe('queued');
      });
    });

    describe('deleteByJob()', () => {
      test('should delete all runs for a job', async () => {
        await jobRunsRepo!.create({
          jobId,
          status: 'succeeded',
          attemptNumber: 1,
        });
        await jobRunsRepo!.create({
          jobId,
          status: 'succeeded',
          attemptNumber: 2,
        });

        await jobRunsRepo!.deleteByJob(jobId);

        const runs = await jobRunsRepo!.listByJob(jobId);
        expect(runs).toEqual([]);
      });
    });

    describe('isolation between jobs', () => {
      test('should isolate runs between jobs', async () => {
        const nextRunAt = new Date(Date.now() + 60000);
        const job2 = await jobsRepo!.create({
          type: 'one-shot',
          targetType: 'isolated',
          payload: {},
          nextRunAt,
        });

        await jobRunsRepo!.create({
          jobId,
          status: 'succeeded',
          attemptNumber: 1,
        });
        await jobRunsRepo!.create({
          jobId: job2.id,
          status: 'failed',
          attemptNumber: 1,
        });

        const job1Runs = await jobRunsRepo!.listByJob(jobId);
        const job2Runs = await jobRunsRepo!.listByJob(job2.id);

        expect(job1Runs).toHaveLength(1);
        expect(job1Runs[0]?.status).toBe('succeeded');
        expect(job2Runs).toHaveLength(1);
        expect(job2Runs[0]?.status).toBe('failed');
      });
    });
  });

  describe('cascade delete', () => {
    test('deleting job should cascade to runs', async () => {
      const nextRunAt = new Date(Date.now() + 60000);
      const job = await jobsRepo!.create({
        type: 'one-shot',
        targetType: 'isolated',
        payload: {},
        nextRunAt,
      });

      const run1 = await jobRunsRepo!.create({
        jobId: job.id,
        status: 'succeeded',
        attemptNumber: 1,
      });
      const run2 = await jobRunsRepo!.create({
        jobId: job.id,
        status: 'succeeded',
        attemptNumber: 2,
      });

      await jobsRepo!.delete(job.id);

      const foundRun1 = await jobRunsRepo!.findById(run1.id);
      const foundRun2 = await jobRunsRepo!.findById(run2.id);

      expect(foundRun1).toBeNull();
      expect(foundRun2).toBeNull();
    });
  });
});
