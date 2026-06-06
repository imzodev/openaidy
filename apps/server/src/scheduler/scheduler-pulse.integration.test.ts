/**
 * End-to-end integration test for the PulseRunnableAdapter wired
 * into the central SchedulerService.
 *
 * What we test (with real SQLite, real repos, mock session service):
 * - A pulse with `nextRunAt` in the past is claimed, executed, and
 *   rescheduled. A `JobRun` row is created (queued → running →
 *   succeeded) and the job's `lastRunAt` advances.
 * - An isolated pulse creates a fresh session per run via the
 *   session service.
 * - A session-attached pulse reuses the existing session id.
 * - A failed pulse increments `retryCount` and schedules the next
 *   run in the future (with backoff). A JobRun row records the
 *   failure.
 * - A pulse that exhausts `maxRetries` is marked `failed` and
 *   its `nextRunAt` is no longer in the future.
 *
 * This is the same pattern as `scheduler.integration.test.ts` but
 * specifically for the pulse path so we can prove the legacy
 * `executeJob()` switch is no longer in use.
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
import { createPulseRunnableAdapter } from './pulse-runnable-adapter';
import type { SessionMessageService } from '../sessions/service';
import type { SessionsStore } from '@openaidy/db';

const POLL_MS = 50;

describe(
  'PulseRunnableAdapter end-to-end (real SQLite, mocked session)',
  {
    timeout: 15_000,
  },
  () => {
    let sqliteDir: string | undefined;
    let dbAdapter: DatabaseAdapter | undefined;
    let scheduler: SchedulerService | undefined;
    let submitSpy: ReturnType<typeof vi.fn>;
    let sessionsStore: SessionsStore | undefined;

    beforeEach(async () => {
      sqliteDir = mkdtempSync(join(tmpdir(), 'openaidy-pulse-int-'));
      const sqlitePath = join(sqliteDir, 'openaidy.db');

      dbAdapter = await createDatabaseAdapter({
        kind: 'sqlite',
        sqlitePath,
      });

      const jobsRepo = createJobsRepository(dbAdapter.client);
      const jobRunsRepo = createJobRunsRepository(dbAdapter.client);
      sessionsStore = dbAdapter.repositories.sessions;

      submitSpy = vi.fn().mockResolvedValue({ ok: true });
      const sessionService = {
        submitMessageStreaming: submitSpy,
      } as unknown as SessionMessageService;

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

      // Register the pulse runnable.
      scheduler.registerRunnable(
        createPulseRunnableAdapter({
          jobsRepo,
          sessionsStore,
          sessionMessageService: sessionService,
          logger: {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
          },
        }),
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

    it('claims and reschedules a cron pulse whose nextRunAt is due', async () => {
      const jobsRepo = createJobsRepository(dbAdapter!.client);
      const jobRunsRepo = createJobRunsRepository(dbAdapter!.client);
      const originalNext = new Date(Date.now() - 1000);
      const created = await jobsRepo.create({
        type: 'cron',
        status: 'active',
        metadata: { kind: 'pulse', name: 'cron-pulse' },
        payload: { message: 'cron fired' },
        nextRunAt: originalNext,
        cronExpression: '*/5 * * * *',
        targetType: 'isolated',
        maxRetries: 3,
        backoffMs: 1000,
      });

      scheduler!.start();
      await new Promise((r) => setTimeout(r, 250));

      // The session service was invoked.
      expect(submitSpy).toHaveBeenCalledTimes(1);
      // The job advanced.
      const after = await jobsRepo.findById(created.id);
      expect(after?.status).toBe('active');
      expect(after!.nextRunAt.getTime()).toBeGreaterThan(
        originalNext.getTime(),
      );
      expect(after!.lastRunAt).not.toBeNull();
      // A JobRun row was created and marked succeeded.
      const runs = await jobRunsRepo.listByJob(created.id);
      expect(runs.length).toBe(1);
      expect(runs[0]!.status).toBe('succeeded');
    });

    it('isolated pulse creates a fresh session per run', async () => {
      const jobsRepo = createJobsRepository(dbAdapter!.client);
      const createSessionSpy = vi.spyOn(sessionsStore!, 'create');
      await jobsRepo.create({
        type: 'one-shot',
        status: 'active',
        metadata: { kind: 'pulse', name: 'morning-brief' },
        payload: { message: 'gm' },
        nextRunAt: new Date(Date.now() - 1000),
        targetType: 'isolated',
        maxRetries: 3,
        backoffMs: 1000,
      });

      scheduler!.start();
      await new Promise((r) => setTimeout(r, 250));

      expect(submitSpy).toHaveBeenCalledTimes(1);
      // A new session was created (isolated target type).
      expect(createSessionSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Pulse: morning-brief' }),
      );
      // The submit call uses the new session id (we don't assert the
      // exact id — Drizzle generates it — but the shape is correct).
      expect(submitSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'user',
          content: 'gm',
        }),
      );
    });

    it('session-attached pulse reuses the existing session id', async () => {
      const jobsRepo = createJobsRepository(dbAdapter!.client);
      // Create the session the job will reference. Without this,
      // SQLite rejects the foreign key on the jobs insert.
      await sessionsStore!.create({
        title: 'Pre-existing session for attached pulse',
      });
      // Now grab its id (Drizzle generates the id).
      const list = await sessionsStore!.list();
      const sessionId = list[0]!.id;
      await jobsRepo.create({
        type: 'one-shot',
        status: 'active',
        metadata: { kind: 'pulse', name: 'attached' },
        payload: { message: 'hi' },
        nextRunAt: new Date(Date.now() - 1000),
        targetType: 'session',
        targetSessionId: sessionId,
        maxRetries: 3,
        backoffMs: 1000,
      });

      scheduler!.start();
      await new Promise((r) => setTimeout(r, 250));

      expect(submitSpy).toHaveBeenCalledTimes(1);
      expect(submitSpy).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId }),
      );
    });

    it('failing pulse increments retryCount and creates a failed JobRun', async () => {
      const jobsRepo = createJobsRepository(dbAdapter!.client);
      const jobRunsRepo = createJobRunsRepository(dbAdapter!.client);
      submitSpy.mockResolvedValue({
        ok: false,
        error: { code: 'PROVIDER_DOWN', message: 'upstream error' },
      });
      const created = await jobsRepo.create({
        type: 'one-shot',
        status: 'active',
        metadata: { kind: 'pulse', name: 'failing' },
        payload: { message: 'will fail' },
        nextRunAt: new Date(Date.now() - 1000),
        targetType: 'isolated',
        maxRetries: 3,
        backoffMs: 10_000, // long enough to prevent the next tick from re-claiming
      });

      scheduler!.start();
      await new Promise((r) => setTimeout(r, 250));

      const after = await jobsRepo.findById(created.id);
      // retryCount bumped, status still active (we have retries left).
      expect(after!.retryCount).toBe(1);
      expect(after!.status).toBe('active');
      // JobRun row is marked failed.
      const runs = await jobRunsRepo.listByJob(created.id);
      expect(runs[0]!.status).toBe('failed');
      expect(runs[0]!.errorMessage).toMatch(/upstream error/);
    });

    it('pulse with maxRetries=0 marks the job failed without retrying', async () => {
      const jobsRepo = createJobsRepository(dbAdapter!.client);
      submitSpy.mockResolvedValue({
        ok: false,
        error: { code: 'PROVIDER_DOWN', message: 'fail' },
      });
      const created = await jobsRepo.create({
        type: 'one-shot',
        status: 'active',
        metadata: { kind: 'pulse', name: 'no-retry' },
        payload: { message: 'x' },
        nextRunAt: new Date(Date.now() - 1000),
        targetType: 'isolated',
        maxRetries: 0,
        backoffMs: 1000,
      });

      scheduler!.start();
      await new Promise((r) => setTimeout(r, 250));

      // Only one attempt.
      expect(submitSpy).toHaveBeenCalledTimes(1);
      // Job is permanently failed.
      const after = await jobsRepo.findById(created.id);
      expect(after!.status).toBe('failed');
    });

    it('pulse with future nextRunAt is skipped', async () => {
      const jobsRepo = createJobsRepository(dbAdapter!.client);
      await jobsRepo.create({
        type: 'one-shot',
        status: 'active',
        metadata: { kind: 'pulse', name: 'future' },
        payload: { message: 'nope yet' },
        nextRunAt: new Date(Date.now() + 60_000), // 1 min in the future
        targetType: 'isolated',
        maxRetries: 3,
        backoffMs: 1000,
      });

      scheduler!.start();
      await new Promise((r) => setTimeout(r, 250));

      expect(submitSpy).not.toHaveBeenCalled();
    });

    it('one-shot pulse transitions to completed after firing', async () => {
      const jobsRepo = createJobsRepository(dbAdapter!.client);
      const created = await jobsRepo.create({
        type: 'one-shot',
        status: 'active',
        metadata: { kind: 'pulse', name: 'fire-and-forget' },
        payload: { message: 'once' },
        nextRunAt: new Date(Date.now() - 1000),
        targetType: 'isolated',
        maxRetries: 3,
        backoffMs: 1000,
      });

      scheduler!.start();
      await new Promise((r) => setTimeout(r, 250));

      const after = await jobsRepo.findById(created.id);
      expect(after!.status).toBe('completed');
    });
  },
);
