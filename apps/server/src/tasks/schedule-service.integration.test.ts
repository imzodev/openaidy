import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDatabaseAdapter } from '@openaidy/db';
import { TaskScheduleService } from './schedule-service';
import type { TaskScheduleExecutor } from './execution/task-schedule-executor';
import type { Task } from '@openaidy/db';

// ============================================================================
// Integration smoke test with a real SQLite database
//
// The spec calls for:
//   - Create a task, then create a schedule with every: '15m'
//   - Verify the schedule row exists in the DB
//   - Call triggerNow, verify a history row is created
//   - Call removeSchedule, verify the row is gone
// ============================================================================

describe(
  'TaskScheduleService integration smoke test',
  { timeout: 15000 },
  () => {
    let sqliteDir: string | undefined;
    let service: TaskScheduleService | undefined;
    let task: Task;

    afterEach(async () => {
      if (sqliteDir) {
        rmSync(sqliteDir, { recursive: true, force: true });
        sqliteDir = undefined;
      }
    });

    it('creates a task + schedule, triggers, and removes the schedule', async () => {
      // 1. Set up a temporary SQLite database
      sqliteDir = mkdtempSync(join(tmpdir(), 'openaidy-int-test-'));
      const sqlitePath = join(sqliteDir, 'openaidy.db');

      const dbAdapter = await createDatabaseAdapter({
        kind: 'sqlite',
        sqlitePath,
      });

      // 2. Create a task in the DB
      task = await dbAdapter.repositories.tasks.create({
        title: 'Integration test task',
        description: 'A task for integration testing',
      });

      // 3. Create a stub executor that returns a history ID
      const stubExecutor = {
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

      // 4. Build the service with real repos + stub executor
      service = new TaskScheduleService({
        tasksRepo: dbAdapter.repositories.tasks,
        taskSchedulesRepo: dbAdapter.repositories.taskSchedules,
        taskExecutionHistoryRepo: dbAdapter.repositories.taskExecutionHistory,
        taskScheduleExecutor: stubExecutor,
      });

      // 5. Create a schedule
      const createResult = await service.createSchedule(task.id, {
        schedule: { every: '15m' },
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('expected ok');
      expect(createResult.data.taskId).toBe(task.id);
      expect(createResult.data.cronExpression).toBe('*/15 * * * *'); // every 15m
      expect(createResult.data.status).toBe('active');

      // 6. Verify the schedule row exists in the DB
      const getResult = await service.getScheduleForTask(task.id);
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) throw new Error('expected ok');
      expect(getResult.data.id).toBe(createResult.data.id);

      // 7. Call triggerNow — the stub executor returns a history ID
      const triggerResult = await service.triggerNow(task.id);
      expect(triggerResult.ok).toBe(true);
      if (!triggerResult.ok) throw new Error('expected ok');
      expect(triggerResult.data.historyId).toBe('hist-stub');

      // 8. Call removeSchedule
      const removeResult = await service.removeSchedule(task.id);
      expect(removeResult.ok).toBe(true);

      // 9. Verify the schedule row is gone
      const afterRemove = await service.getScheduleForTask(task.id);
      expect(afterRemove.ok).toBe(false);
      if (afterRemove.ok) throw new Error('expected failure');
      expect(afterRemove.error.code).toBe('schedule.not_found');

      // 10. Cleanup DB
      await dbAdapter.close();
    });
  },
);
