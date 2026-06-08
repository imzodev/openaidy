import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as sessionSchema from '../schema/sessions';
import * as tasksSchema from '../schema/tasks';
import { TasksRepository } from './tasks';
import { TaskSchedulesRepository } from './task-schedules';
import { TaskExecutionHistoryRepository } from './task-execution-history';

type CombinedSchema = typeof sessionSchema & typeof tasksSchema;
type Database = NodePgDatabase<CombinedSchema>;

/**
 * Integration tests for the recurring-tasks repositories.
 *
 * Requires a running PostgreSQL with the schema applied. Set
 * DATABASE_URL to run:
 *
 *   DATABASE_URL=postgres://... pnpm vitest run src/repositories/task-schedules.test.ts
 */
describe('Recurring tasks repositories (integration)', () => {
  const databaseUrl = process.env.DATABASE_URL;
  const shouldRun = !!databaseUrl;
  const test = shouldRun ? it : it.skip;

  let pool: Pool | undefined;
  let db: Database | undefined;
  let tasksRepo: TasksRepository | undefined;
  let schedulesRepo: TaskSchedulesRepository | undefined;
  let historyRepo: TaskExecutionHistoryRepository | undefined;

  beforeEach(async () => {
    if (!shouldRun || !databaseUrl) return;

    pool = new Pool({ connectionString: databaseUrl });
    db = drizzle(pool, {
      schema: { ...sessionSchema, ...tasksSchema },
    }) as Database;
    tasksRepo = new TasksRepository(db);
    schedulesRepo = new TaskSchedulesRepository(db);
    historyRepo = new TaskExecutionHistoryRepository(db);

    // Clean up test data (order matters because of FKs)
    await db.delete(tasksSchema.taskExecutionHistory);
    await db.delete(tasksSchema.taskSchedules);
    await db.delete(tasksSchema.taskAgents);
    await db.delete(tasksSchema.subtasks);
    await db.delete(tasksSchema.tasks);
  });

  afterEach(async () => {
    if (pool) await pool.end();
  });

  // -------------------------------------------------------------------------
  // TaskSchedulesRepository
  // -------------------------------------------------------------------------
  describe('TaskSchedulesRepository', () => {
    test('create inserts a row with sensible defaults', async () => {
      const task = await tasksRepo!.create({
        title: 'Daily summary',
        description: 'Summarise the day',
      });
      const nextRunAt = new Date(Date.now() + 60_000);
      const schedule = await schedulesRepo!.create({
        taskId: task.id,
        cronExpression: '0 9 * * *',
        preset: '1d',
        scheduleDate: null,
        nextRunAt,
      });

      expect(schedule.id).toBeDefined();
      expect(schedule.taskId).toBe(task.id);
      expect(schedule.cronExpression).toBe('0 9 * * *');
      expect(schedule.preset).toBe('1d');
      expect(schedule.status).toBe('active');
      expect(schedule.replanPolicy).toBe('never');
      expect(schedule.maxExecutions).toBe(9999);
      expect(schedule.executionCount).toBe(0);
      expect(schedule.descriptionHash).toBeNull();
    });

    test('create honours custom replanPolicy and maxExecutions', async () => {
      const task = await tasksRepo!.create({ title: 'T', description: 'D' });
      const schedule = await schedulesRepo!.create({
        taskId: task.id,
        cronExpression: null,
        preset: '15m',
        scheduleDate: null,
        nextRunAt: new Date(Date.now() + 1000),
        replanPolicy: 'on-description-change',
        maxExecutions: 50,
      });
      expect(schedule.replanPolicy).toBe('on-description-change');
      expect(schedule.maxExecutions).toBe(50);
    });

    test('findById returns null for an unknown id', async () => {
      const found = await schedulesRepo!.findById('no-such-id');
      expect(found).toBeNull();
    });

    test('findByTaskId returns the schedule for a task', async () => {
      const task = await tasksRepo!.create({ title: 'T', description: 'D' });
      const created = await schedulesRepo!.create({
        taskId: task.id,
        cronExpression: '*/15 * * * *',
        preset: null,
        scheduleDate: null,
        nextRunAt: new Date(Date.now() + 1000),
      });
      const found = await schedulesRepo!.findByTaskId(task.id);
      expect(found?.id).toBe(created.id);
    });

    test('findByTaskId returns null when the task has no schedule', async () => {
      const task = await tasksRepo!.create({ title: 'T', description: 'D' });
      const found = await schedulesRepo!.findByTaskId(task.id);
      expect(found).toBeNull();
    });

    test('claimNextDue returns the earliest due active schedule', async () => {
      const t1 = await tasksRepo!.create({ title: 'T1', description: 'D' });
      const t2 = await tasksRepo!.create({ title: 'T2', description: 'D' });

      const future = new Date(Date.now() + 60_000);
      const past = new Date(Date.now() - 60_000);

      // t1 is due, t2 is in the future
      await schedulesRepo!.create({
        taskId: t1.id,
        cronExpression: null,
        preset: '15m',
        scheduleDate: null,
        nextRunAt: past,
      });
      await schedulesRepo!.create({
        taskId: t2.id,
        cronExpression: null,
        preset: '15m',
        scheduleDate: null,
        nextRunAt: future,
      });

      const claimed = await schedulesRepo!.claimNextDue(new Date());
      expect(claimed).not.toBeNull();
      expect(claimed!.payload.schedule.taskId).toBe(t1.id);
    });

    test('claimNextDue returns null when nothing is due', async () => {
      const task = await tasksRepo!.create({ title: 'T', description: 'D' });
      await schedulesRepo!.create({
        taskId: task.id,
        cronExpression: null,
        preset: '15m',
        scheduleDate: null,
        nextRunAt: new Date(Date.now() + 60_000),
      });
      const claimed = await schedulesRepo!.claimNextDue(new Date());
      expect(claimed).toBeNull();
    });

    test('claimNextDue skips paused and expired schedules', async () => {
      const t1 = await tasksRepo!.create({ title: 'T1', description: 'D' });
      const t2 = await tasksRepo!.create({ title: 'T2', description: 'D' });
      const t3 = await tasksRepo!.create({ title: 'T3', description: 'D' });
      const past = new Date(Date.now() - 60_000);

      const _a = await schedulesRepo!.create({
        taskId: t1.id,
        cronExpression: null,
        preset: '15m',
        scheduleDate: null,
        nextRunAt: past,
      });
      const p = await schedulesRepo!.create({
        taskId: t2.id,
        cronExpression: null,
        preset: '15m',
        scheduleDate: null,
        nextRunAt: past,
      });
      const e = await schedulesRepo!.create({
        taskId: t3.id,
        cronExpression: null,
        preset: '15m',
        scheduleDate: null,
        nextRunAt: past,
      });
      await schedulesRepo!.pause(p.id);
      // expire via direct update (no public method to "expire" without going
      // through the reschedule flow, which is Phase 2's job)
      await schedulesRepo!.update(e.id, { status: 'expired' });

      const claimed = await schedulesRepo!.claimNextDue(new Date());
      expect(claimed).not.toBeNull();
      expect(claimed!.payload.schedule.taskId).toBe(t1.id);
      // a is still active
      expect(claimed!.payload.schedule.status).toBe('active');
    });

    test('update mutates fields and stamps updatedAt', async () => {
      const task = await tasksRepo!.create({ title: 'T', description: 'D' });
      const schedule = await schedulesRepo!.create({
        taskId: task.id,
        cronExpression: null,
        preset: '15m',
        scheduleDate: null,
        nextRunAt: new Date(Date.now() + 1000),
      });
      const next = new Date(Date.now() + 5_000);
      const updated = await schedulesRepo!.update(schedule.id, {
        nextRunAt: next,
        descriptionHash: 'abc123',
        executionCount: 3,
      });
      expect(updated?.nextRunAt.toISOString()).toBe(next.toISOString());
      expect(updated?.descriptionHash).toBe('abc123');
      expect(updated?.executionCount).toBe(3);
    });

    test('pause and resume flip status', async () => {
      const task = await tasksRepo!.create({ title: 'T', description: 'D' });
      const schedule = await schedulesRepo!.create({
        taskId: task.id,
        cronExpression: null,
        preset: '15m',
        scheduleDate: null,
        nextRunAt: new Date(Date.now() + 1000),
      });
      const paused = await schedulesRepo!.pause(schedule.id);
      expect(paused?.status).toBe('paused');
      const resumed = await schedulesRepo!.resume(schedule.id);
      expect(resumed?.status).toBe('active');
    });

    test('delete removes the row', async () => {
      const task = await tasksRepo!.create({ title: 'T', description: 'D' });
      const schedule = await schedulesRepo!.create({
        taskId: task.id,
        cronExpression: null,
        preset: '15m',
        scheduleDate: null,
        nextRunAt: new Date(Date.now() + 1000),
      });
      const deleted = await schedulesRepo!.delete(schedule.id);
      expect(deleted?.id).toBe(schedule.id);
      const found = await schedulesRepo!.findById(schedule.id);
      expect(found).toBeNull();
    });

    test('listByStatus and countByStatus work', async () => {
      const t1 = await tasksRepo!.create({ title: 'T1', description: 'D' });
      const t2 = await tasksRepo!.create({ title: 'T2', description: 'D' });
      const t3 = await tasksRepo!.create({ title: 'T3', description: 'D' });
      const s1 = await schedulesRepo!.create({
        taskId: t1.id,
        cronExpression: null,
        preset: '15m',
        scheduleDate: null,
        nextRunAt: new Date(Date.now() + 1000),
      });
      const s2 = await schedulesRepo!.create({
        taskId: t2.id,
        cronExpression: null,
        preset: '15m',
        scheduleDate: null,
        nextRunAt: new Date(Date.now() + 1000),
      });
      const s3 = await schedulesRepo!.create({
        taskId: t3.id,
        cronExpression: null,
        preset: '15m',
        scheduleDate: null,
        nextRunAt: new Date(Date.now() + 1000),
      });
      await schedulesRepo!.pause(s2.id);
      await schedulesRepo!.update(s3.id, { status: 'expired' });

      const active = await schedulesRepo!.listByStatus('active');
      const paused = await schedulesRepo!.listByStatus('paused');
      const expired = await schedulesRepo!.listByStatus('expired');
      expect(active.map((s) => s.id)).toEqual([s1.id]);
      expect(paused.map((s) => s.id)).toEqual([s2.id]);
      expect(expired.map((s) => s.id)).toEqual([s3.id]);

      const counts = await schedulesRepo!.countByStatus();
      expect(counts.active).toBe(1);
      expect(counts.paused).toBe(1);
      expect(counts.expired).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // TaskExecutionHistoryRepository
  // -------------------------------------------------------------------------
  describe('TaskExecutionHistoryRepository', () => {
    test('create inserts a planned row', async () => {
      const task = await tasksRepo!.create({ title: 'T', description: 'D' });
      const schedule = await schedulesRepo!.create({
        taskId: task.id,
        cronExpression: null,
        preset: '15m',
        scheduleDate: null,
        nextRunAt: new Date(Date.now() + 1000),
      });
      const row = await historyRepo!.create({
        taskId: task.id,
        scheduleId: schedule.id,
        taskTitle: task.title,
        taskDescription: task.description,
      });
      expect(row.id).toBeDefined();
      expect(row.status).toBe('planned');
      expect(row.taskTitle).toBe('T');
      expect(row.taskDescription).toBe('D');
      expect(row.didReplan).toBe(false);
      expect(row.attemptNumber).toBe(1);
      expect(row.finishedAt).toBeNull();
    });

    test('updateStatus advances the lifecycle', async () => {
      const task = await tasksRepo!.create({ title: 'T', description: 'D' });
      const schedule = await schedulesRepo!.create({
        taskId: task.id,
        cronExpression: null,
        preset: '15m',
        scheduleDate: null,
        nextRunAt: new Date(Date.now() + 1000),
      });
      const row = await historyRepo!.create({
        taskId: task.id,
        scheduleId: schedule.id,
        taskTitle: task.title,
        taskDescription: task.description,
      });
      const planning = await historyRepo!.updateStatus(row.id, {
        status: 'planning',
        didReplan: true,
      });
      expect(planning?.status).toBe('planning');
      expect(planning?.didReplan).toBe(true);
      const executing = await historyRepo!.updateStatus(row.id, {
        status: 'executing',
        sessionId: null,
      });
      expect(executing?.status).toBe('executing');
    });

    test('markCompleted and markFailed stamp finishedAt + durationMs + error', async () => {
      const task = await tasksRepo!.create({ title: 'T', description: 'D' });
      const schedule = await schedulesRepo!.create({
        taskId: task.id,
        cronExpression: null,
        preset: '15m',
        scheduleDate: null,
        nextRunAt: new Date(Date.now() + 1000),
      });
      const row = await historyRepo!.create({
        taskId: task.id,
        scheduleId: schedule.id,
        taskTitle: task.title,
        taskDescription: task.description,
      });
      const ok = await historyRepo!.markCompleted(row.id, 123);
      expect(ok?.status).toBe('completed');
      expect(ok?.durationMs).toBe(123);
      expect(ok?.finishedAt).toBeInstanceOf(Date);

      const row2 = await historyRepo!.create({
        taskId: task.id,
        scheduleId: schedule.id,
        taskTitle: task.title,
        taskDescription: task.description,
      });
      const failed = await historyRepo!.markFailed(row2.id, 456, {
        code: 'BOOM',
        message: 'something broke',
      });
      expect(failed?.status).toBe('failed');
      expect(failed?.errorCode).toBe('BOOM');
      expect(failed?.errorMessage).toBe('something broke');
      expect(failed?.durationMs).toBe(456);
    });

    test('findBySessionId returns the most recent row for a session', async () => {
      const task = await tasksRepo!.create({ title: 'T', description: 'D' });
      const schedule = await schedulesRepo!.create({
        taskId: task.id,
        cronExpression: null,
        preset: '15m',
        scheduleDate: null,
        nextRunAt: new Date(Date.now() + 1000),
      });
      const r1 = await historyRepo!.create({
        taskId: task.id,
        scheduleId: schedule.id,
        taskTitle: task.title,
        taskDescription: task.description,
      });
      // r1 gets a sessionId
      await historyRepo!.update(r1.id, { sessionId: 'sess-1' });
      const r2 = await historyRepo!.create({
        taskId: task.id,
        scheduleId: schedule.id,
        taskTitle: task.title,
        taskDescription: task.description,
      });
      await historyRepo!.update(r2.id, { sessionId: 'sess-1' });
      const found = await historyRepo!.findBySessionId('sess-1');
      // Newest first
      expect(found?.id).toBe(r2.id);
    });

    test('listByTask returns rows newest first', async () => {
      const task = await tasksRepo!.create({ title: 'T', description: 'D' });
      const schedule = await schedulesRepo!.create({
        taskId: task.id,
        cronExpression: null,
        preset: '15m',
        scheduleDate: null,
        nextRunAt: new Date(Date.now() + 1000),
      });
      const r1 = await historyRepo!.create({
        taskId: task.id,
        scheduleId: schedule.id,
        taskTitle: task.title,
        taskDescription: task.description,
      });
      // small delay so createdAt ordering is deterministic
      await new Promise((r) => setTimeout(r, 5));
      const r2 = await historyRepo!.create({
        taskId: task.id,
        scheduleId: schedule.id,
        taskTitle: task.title,
        taskDescription: task.description,
      });
      const list = await historyRepo!.listByTask(task.id);
      expect(list.map((r) => r.id)).toEqual([r2.id, r1.id]);
    });

    test('listByTaskPaginated respects limit and offset', async () => {
      const task = await tasksRepo!.create({ title: 'T', description: 'D' });
      const schedule = await schedulesRepo!.create({
        taskId: task.id,
        cronExpression: null,
        preset: '15m',
        scheduleDate: null,
        nextRunAt: new Date(Date.now() + 1000),
      });
      for (let i = 0; i < 5; i++) {
        await historyRepo!.create({
          taskId: task.id,
          scheduleId: schedule.id,
          taskTitle: task.title,
          taskDescription: task.description,
        });
        await new Promise((r) => setTimeout(r, 2));
      }
      const page1 = await historyRepo!.listByTaskPaginated(task.id, {
        limit: 2,
        offset: 0,
      });
      const page2 = await historyRepo!.listByTaskPaginated(task.id, {
        limit: 2,
        offset: 2,
      });
      expect(page1).toHaveLength(2);
      expect(page2).toHaveLength(2);
      expect(page1[0]?.id).not.toBe(page2[0]?.id);
    });
  });
});
