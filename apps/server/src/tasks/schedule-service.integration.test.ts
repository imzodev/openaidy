/**
 * TaskScheduleService integration tests (Phase 7, Task 4).
 *
 * Real SQLite database, real repositories, stub executor. The
 * integration tests prove the service's persistence and lifecycle
 * transitions work end-to-end without relying on fakes.
 *
 * What we cover:
 * - `createSchedule` parses every/cron/at/daily schedules correctly
 *   and persists a row in `task_schedules`.
 * - `createSchedule` rejects when a schedule already exists for the task.
 * - `updateSchedule` recomputes `nextRunAt` when the schedule changes.
 * - `pauseSchedule` + `resumeSchedule` transitions work.
 * - `removeSchedule` deletes the row.
 * - `triggerNow` calls the executor (which returns a history ID).
 * - `updateSchedule` rejects `maxExecutions` ≤ 0 with the right error code.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDatabaseAdapter, type DatabaseAdapter } from '@openaidy/db';
import { TaskScheduleService } from './schedule-service';
import type { TaskScheduleExecutor } from './execution/task-schedule-executor';
import type { Task } from '@openaidy/db';

describe('TaskScheduleService integration tests', { timeout: 15000 }, () => {
  let sqliteDir: string | undefined;
  let dbAdapter: DatabaseAdapter | undefined;
  let service: TaskScheduleService | undefined;
  let task: Task;
  let stubExecutor: TaskScheduleExecutor;

  beforeEach(async () => {
    sqliteDir = mkdtempSync(join(tmpdir(), 'openaidy-sched-svc-int-'));
    const sqlitePath = join(sqliteDir, 'openaidy.db');

    dbAdapter = await createDatabaseAdapter({
      kind: 'sqlite',
      sqlitePath,
    });

    // 2. Create a task in the DB
    task = await dbAdapter.repositories.tasks.create({
      title: 'Integration test task',
      description: 'A task for integration testing',
    });

    // 3. Stub executor
    stubExecutor = {
      kind: 'task' as const,
      claimNextDue: vi.fn(),
      execute: vi.fn(),
      reschedule: vi.fn(),
      triggerNow: vi.fn().mockImplementation(async (scheduleId: string) => ({
        ok: true as const,
        historyId: 'hist-stub',
        scheduleId,
      })),
    } as unknown as TaskScheduleExecutor;

    // 4. Build the service
    service = new TaskScheduleService({
      tasksRepo: dbAdapter.repositories.tasks,
      taskSchedulesRepo: dbAdapter.repositories.taskSchedules,
      taskExecutionHistoryRepo: dbAdapter.repositories.taskExecutionHistory,
      taskScheduleExecutor: stubExecutor,
    });
  });

  afterEach(async () => {
    if (dbAdapter) {
      await dbAdapter.close();
      dbAdapter = undefined;
    }
    if (sqliteDir) {
      rmSync(sqliteDir, { recursive: true, force: true });
      sqliteDir = undefined;
    }
  });

  it('createSchedule parses and stores an `every` schedule', async () => {
    const result = await service!.createSchedule(task.id, {
      schedule: { every: '15m' },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.cronExpression).toBe('*/15 * * * *');
    expect(result.data.status).toBe('active');
    expect(result.data.executionCount).toBe(0);
    expect(result.data.scheduleHuman).toMatch(/15/);
  });

  it('createSchedule parses and stores a `cron` schedule', async () => {
    const result = await service!.createSchedule(task.id, {
      schedule: { cron: '0 9 * * 1-5' },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.cronExpression).toBe('0 9 * * 1-5');
    // scheduleHuman is the cron expression as-is for non-canonical forms
    // (this is a known limitation — see known-limitations.md).
    expect(result.data.scheduleHuman).toBe('0 9 * * 1-5');
  });

  it('createSchedule parses and stores a one-shot schedule', async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const result = await service!.createSchedule(task.id, {
      schedule: { at: future },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.scheduleDate).toBe(future);
    expect(result.data.cronExpression).toBeNull();
  });

  it('createSchedule rejects when a schedule already exists for the task', async () => {
    await service!.createSchedule(task.id, { schedule: { every: '1h' } });
    const second = await service!.createSchedule(task.id, {
      schedule: { every: '12h' },
    });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.code).toBe('schedule.already_exists');
  });

  it('updateSchedule recomputes nextRunAt when the schedule changes', async () => {
    // Pin the clock so the comparison is deterministic. `1h` (`0 * * * *`)
    // and `30m` (`*/30 * * * *`) both resolve to the next `:00` during the
    // back half of any hour, which made this assertion flaky by wall-clock.
    // At 12:10Z they differ: 1h → 13:00Z, 30m → 12:30Z. Fake only `Date`
    // (not setTimeout/etc.) so the real async + SQLite flow is unaffected.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-29T12:10:00.000Z'));
    try {
      const created = await service!.createSchedule(task.id, {
        schedule: { every: '1h' },
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const originalNext = created.data.nextRunAt;
      // Change to every 30m — nextRunAt should be sooner.
      const updated = await service!.updateSchedule(task.id, {
        schedule: { every: '30m' },
      });
      expect(updated.ok).toBe(true);
      if (!updated.ok) return;
      expect(updated.data.cronExpression).toBe('*/30 * * * *');
      // The new nextRunAt should be sooner (12:30Z vs 13:00Z), hence different.
      expect(updated.data.nextRunAt).not.toBe(originalNext);
    } finally {
      vi.useRealTimers();
    }
  });

  it('pauseSchedule + resumeSchedule transitions work', async () => {
    await service!.createSchedule(task.id, { schedule: { every: '1h' } });
    const paused = await service!.pauseSchedule(task.id);
    expect(paused.ok).toBe(true);
    if (!paused.ok) return;
    expect(paused.data.status).toBe('paused');

    const resumed = await service!.resumeSchedule(task.id);
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    expect(resumed.data.status).toBe('active');
  });

  it('removeSchedule deletes the row', async () => {
    await service!.createSchedule(task.id, { schedule: { every: '1h' } });
    const removed = await service!.removeSchedule(task.id);
    expect(removed.ok).toBe(true);
    const after = await service!.getScheduleForTask(task.id);
    expect(after.ok).toBe(false);
    if (after.ok) return;
    expect(after.error.code).toBe('schedule.not_found');
  });

  it('triggerNow creates a history row via the executor', async () => {
    await service!.createSchedule(task.id, { schedule: { every: '1h' } });
    const result = await service!.triggerNow(task.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.historyId).toBe('hist-stub');
    expect(stubExecutor.triggerNow).toHaveBeenCalled();
  });

  it('updateSchedule rejects maxExecutions ≤ 0', async () => {
    await service!.createSchedule(task.id, { schedule: { every: '1h' } });
    const updated = await service!.updateSchedule(task.id, {
      maxExecutions: 0,
    });
    expect(updated.ok).toBe(false);
    if (updated.ok) return;
    expect(updated.error.code).toBe('schedule.invalid_max_executions');

    const negative = await service!.updateSchedule(task.id, {
      maxExecutions: -5,
    });
    expect(negative.ok).toBe(false);
    if (negative.ok) return;
    expect(negative.error.code).toBe('schedule.invalid_max_executions');
  });
});
