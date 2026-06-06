/**
 * Scheduler end-to-end integration test (Phase 7, Task 2).
 *
 * The spec calls for an end-to-end test that exercises the scheduler
 * tick → claim → execute → reschedule path against a real SQLite
 * database. We don't have a full `PulseRunnableAdapter` yet (that's
 * Phase 7 stretch), so the scheduler's `executeJob` legacy path is
 * what we drive. The test still proves the scheduler's claim +
 * execution + state machine works for a real `scheduled_jobs` row.
 *
 * What we test:
 * - A scheduled `one-shot` job with `nextRunAt` in the past gets
 *   claimed and marked `completed` after a successful run.
 * - A scheduled `cron` job with `nextRunAt` in the past gets claimed,
 *   run, and rescheduled (nextRunAt moves forward).
 * - A job with `maxRetries: 0` does not retry on failure.
 * - A job that exhausts its retries transitions to `failed`.
 *
 * What we do NOT test (would require a real session service):
 * - Session-attached vs isolated pulse dispatch.
 * - Real LLM round-trips.
 *
 * @see docs/recurring-tasks/recurring-tasks-phase-7-testing.md
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createDatabaseAdapter,
  createJobsRepository,
  createJobRunsRepository,
  type DatabaseAdapter,
} from '@openaidy/db';
import { SchedulerService } from './service';
import type { SessionMessageService } from '../sessions/service';

const POLL_MS = 50;

describe(
  'SchedulerService end-to-end (real SQLite, mocked session)',
  {
    timeout: 15_000,
  },
  () => {
    let sqliteDir: string | undefined;
    let dbAdapter: DatabaseAdapter | undefined;
    let scheduler: SchedulerService | undefined;
    let submitSpy: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      sqliteDir = mkdtempSync(join(tmpdir(), 'openaidy-sched-int-'));
      const sqlitePath = join(sqliteDir, 'openaidy.db');

      dbAdapter = await createDatabaseAdapter({
        kind: 'sqlite',
        sqlitePath,
      });

      const jobsRepo = createJobsRepository(dbAdapter.client);
      const jobRunsRepo = createJobRunsRepository(dbAdapter.client);

      submitSpy = vi.fn().mockResolvedValue({ ok: true });
      const sessionService = {
        submitMessageStreaming: submitSpy,
      } as unknown as SessionMessageService;

      const sessionsStore = dbAdapter.repositories.sessions;

      scheduler = new SchedulerService(
        jobsRepo,
        jobRunsRepo,
        sessionService,
        sessionsStore,
        // Silent logger.
        {
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
        },
        { pollIntervalMs: POLL_MS },
      );
    });

    afterEach(async () => {
      if (scheduler) {
        await scheduler.stop();
      }
      if (dbAdapter) {
        await dbAdapter.close();
      }
      if (sqliteDir) {
        rmSync(sqliteDir, { recursive: true, force: true });
        sqliteDir = undefined;
      }
    });

    it('claims and completes a one-shot job whose nextRunAt is in the past', async () => {
      const jobsRepo = createJobsRepository(dbAdapter!.client);
      await jobsRepo.create({
        type: 'one-shot',
        status: 'active',
        metadata: { kind: 'pulse', name: 'one-shot-pulse' },
        payload: { message: 'one-shot fired' },
        nextRunAt: new Date(Date.now() - 1000), // due
        targetType: 'isolated',
        maxRetries: 3,
        backoffMs: 1000,
      });

      scheduler!.start();
      // Wait for the first tick (poll interval = 50ms).
      await new Promise((r) => setTimeout(r, 250));

      // The job should have been claimed and the session service called.
      expect(submitSpy).toHaveBeenCalled();
      // And the job should be marked completed.
      const list = await jobsRepo.list();
      const job = list[0]!;
      expect(job.status).toBe('completed');
    });

    it('reschedules a cron job after a successful run', async () => {
      const jobsRepo = createJobsRepository(dbAdapter!.client);
      const originalNext = new Date(Date.now() - 1000); // due
      const created = await jobsRepo.create({
        type: 'cron',
        status: 'active',
        metadata: { kind: 'pulse', name: 'cron-pulse' },
        payload: { message: 'cron fired' },
        nextRunAt: originalNext,
        cronExpression: '*/5 * * * *', // every 5 minutes
        targetType: 'isolated',
        maxRetries: 3,
        backoffMs: 1000,
      });

      scheduler!.start();
      await new Promise((r) => setTimeout(r, 250));

      // Session service was invoked.
      expect(submitSpy).toHaveBeenCalled();
      // Job is still active (cron doesn't auto-terminate).
      const after = await jobsRepo.findById(created.id);
      expect(after?.status).toBe('active');
      // nextRunAt moved forward.
      expect(after!.nextRunAt.getTime()).toBeGreaterThan(
        originalNext.getTime(),
      );
    });

    it('does not retry a job with maxRetries: 0 on failure', async () => {
      const jobsRepo = createJobsRepository(dbAdapter!.client);
      // Force the session service to fail.
      submitSpy.mockResolvedValue({
        ok: false,
        error: { code: 'SESSION_ERROR', message: 'nope' },
      });
      await jobsRepo.create({
        type: 'one-shot',
        status: 'active',
        metadata: { kind: 'pulse', name: 'no-retry-pulse' },
        payload: { message: 'fire once' },
        nextRunAt: new Date(Date.now() - 1000),
        targetType: 'isolated',
        maxRetries: 0,
        backoffMs: 1000,
      });

      scheduler!.start();
      await new Promise((r) => setTimeout(r, 250));

      // Session service was invoked exactly once — no retries.
      expect(submitSpy).toHaveBeenCalledTimes(1);
      // Job is marked failed (maxRetries exhausted).
      const list = await jobsRepo.list();
      expect(list[0]!.status).toBe('failed');
    });

    it('retries a job that fails and eventually marks it failed after maxRetries', async () => {
      const jobsRepo = createJobsRepository(dbAdapter!.client);
      // Always fail.
      submitSpy.mockResolvedValue({
        ok: false,
        error: { code: 'SESSION_ERROR', message: 'persistent' },
      });
      await jobsRepo.create({
        type: 'one-shot',
        status: 'active',
        metadata: { kind: 'pulse', name: 'exhaust-pulse' },
        payload: { message: 'fire' },
        nextRunAt: new Date(Date.now() - 1000),
        targetType: 'isolated',
        // Allow 1 retry.
        maxRetries: 1,
        backoffMs: 50, // fast backoff for the test
      });

      scheduler!.start();
      // Wait long enough for the original + 1 retry.
      await new Promise((r) => setTimeout(r, 500));

      // Two attempts (original + 1 retry).
      expect(submitSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
      // Job is now failed.
      const list = await jobsRepo.list();
      expect(list[0]!.status).toBe('failed');
    });

    it('skips a job whose nextRunAt is in the future', async () => {
      const jobsRepo = createJobsRepository(dbAdapter!.client);
      await jobsRepo.create({
        type: 'one-shot',
        status: 'active',
        metadata: { kind: 'pulse', name: 'not-due-yet' },
        payload: { message: 'future' },
        nextRunAt: new Date(Date.now() + 60_000), // 1 minute in the future
        targetType: 'isolated',
        maxRetries: 3,
        backoffMs: 1000,
      });

      scheduler!.start();
      await new Promise((r) => setTimeout(r, 250));

      // Session service was NOT invoked.
      expect(submitSpy).not.toHaveBeenCalled();
      // Job is still active and not rescheduled.
      const list = await jobsRepo.list();
      expect(list[0]!.status).toBe('active');
    });
  },
);
