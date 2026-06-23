import { eq, and, asc, sql, lte } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseClient } from '../client';
import * as schema from '../schema/tasks';

type Database = DatabaseClient;

/**
 * Task schedules repository
 *
 * Provides data access for `task_schedules` rows. One row per recurring
 * task. The schedule row holds the cron/preset definition, the polling
 * state (`nextRunAt`/`lastRunAt`), the status (`active`/`paused`/`expired`),
 * the replan policy, the max-executions cap, and the description hash used
 * by the `on-description-change` policy.
 *
 * The Phase 2 executor (`TaskScheduleExecutor`) reads from this repository
 * to claim work, write history rows, and update polling state. This class
 * has no opinions about scheduling logic — it's a thin wrapper around the
 * Drizzle schema.
 */
export class TaskSchedulesRepository {
  constructor(private readonly db: Database) {}

  /**
   * Create a new schedule row for a task.
   *
   * The caller is responsible for parsing the user-supplied `ScheduleInput`
   * (via `parseScheduleInput` in `apps/server/src/pulses/utils.ts`) into
   * the normalised `cronExpression`/`preset`/`scheduleDate` triple. This
   * repo just stores what it's given.
   */
  async create(input: {
    taskId: string;
    cronExpression: string | null;
    preset: string | null;
    scheduleDate: Date | null;
    nextRunAt: Date;
    replanPolicy?: schema.ReplanPolicy;
    /** Defaults to 9999 when omitted. There is no "infinite" option. */
    maxExecutions?: number;
  }): Promise<schema.TaskSchedule> {
    const now = new Date();
    const [row] = await this.db
      .insert(schema.taskSchedules)
      .values({
        id: nanoid(),
        taskId: input.taskId,
        cronExpression: input.cronExpression,
        preset: input.preset,
        scheduleDate: input.scheduleDate,
        nextRunAt: input.nextRunAt,
        status: 'active',
        replanPolicy: input.replanPolicy ?? 'never',
        maxExecutions: input.maxExecutions ?? 9999,
        executionCount: 0,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return row!;
  }

  /**
   * Find a schedule by its primary key.
   */
  async findById(id: string): Promise<schema.TaskSchedule | null> {
    const rows = await this.db
      .select()
      .from(schema.taskSchedules)
      .where(eq(schema.taskSchedules.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Find the schedule for a task. Each task has at most one schedule
   * (enforced by the UNIQUE constraint on `task_id`).
   */
  async findByTaskId(taskId: string): Promise<schema.TaskSchedule | null> {
    const rows = await this.db
      .select()
      .from(schema.taskSchedules)
      .where(eq(schema.taskSchedules.taskId, taskId))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Atomically claim the next due schedule.
   *
   * "Due" means: `status = 'active'` AND `nextRunAt <= now`. This returns
   * the earliest-due row, ordered by `nextRunAt` ascending.
   *
   * Concurrency: in the current single-server model (the OpenAidy server
   * runs as a single process per instance), this is safe. For a
   * multi-server deployment, Phase 7 swaps this for a transactional
   * `UPDATE ... WHERE nextRunAt <= now AND status = 'active' RETURNING`
   * with `FOR UPDATE SKIP LOCKED` semantics.
   */
  async claimNextDue(now: Date = new Date()): Promise<{
    id: string;
    payload: { schedule: schema.TaskSchedule };
  } | null> {
    const rows = await this.db
      .select()
      .from(schema.taskSchedules)
      .where(
        and(
          eq(schema.taskSchedules.status, 'active'),
          lte(schema.taskSchedules.nextRunAt, now),
        ),
      )
      .orderBy(asc(schema.taskSchedules.nextRunAt))
      .limit(1);
    const schedule = rows[0];
    if (!schedule) return null;
    return { id: schedule.id, payload: { schedule } };
  }

  /**
   * Update mutable fields on a schedule.
   *
   * The executor calls this from `reschedule()` to bump `executionCount`,
   * set `lastRunAt`, and write the new `descriptionHash`. The status
   * transitions to `expired` here too when `maxExecutions` is reached.
   */
  async update(
    id: string,
    input: {
      nextRunAt?: Date;
      lastRunAt?: Date | null;
      status?: schema.TaskScheduleStatus;
      replanPolicy?: schema.ReplanPolicy;
      /** Replace the cap. Must be a positive integer. */
      maxExecutions?: number;
      descriptionHash?: string | null;
      /** Bump the execution counter. Executor sets this on every run. */
      executionCount?: number;
    },
  ): Promise<schema.TaskSchedule | null> {
    const rows = await this.db
      .update(schema.taskSchedules)
      .set({
        ...input,
        updatedAt: new Date(),
      })
      .where(eq(schema.taskSchedules.id, id))
      .returning();
    return rows[0] ?? null;
  }

  /**
   * Pause a schedule (status -> 'paused'). The scheduler will skip it.
   */
  async pause(id: string): Promise<schema.TaskSchedule | null> {
    return this.update(id, { status: 'paused' });
  }

  /**
   * Resume a paused schedule (status -> 'active'). The next `nextRunAt`
   * is left as-is — the caller is responsible for recomputing it if the
   * pause was long enough that the schedule should "skip ahead" (for v1
   * we don't skip; the next firing happens at the next cron tick after
   * the resume time).
   */
  async resume(id: string): Promise<schema.TaskSchedule | null> {
    return this.update(id, { status: 'active' });
  }

  /**
   * Delete a schedule row. The history rows are cascade-deleted by FK.
   */
  async delete(id: string): Promise<schema.TaskSchedule | null> {
    const rows = await this.db
      .delete(schema.taskSchedules)
      .where(eq(schema.taskSchedules.id, id))
      .returning();
    return rows[0] ?? null;
  }

  /**
   * List schedules by status. Used by the admin UI to show "all paused
   * schedules" or "all expired schedules".
   */
  async listByStatus(
    status: schema.TaskScheduleStatus,
  ): Promise<schema.TaskSchedule[]> {
    return this.db
      .select()
      .from(schema.taskSchedules)
      .where(eq(schema.taskSchedules.status, status))
      .orderBy(asc(schema.taskSchedules.nextRunAt));
  }

  /**
   * Count schedules by status. Useful for dashboard summaries.
   */
  async countByStatus(): Promise<Record<schema.TaskScheduleStatus, number>> {
    const rows = await this.db
      .select({
        status: schema.taskSchedules.status,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.taskSchedules)
      .groupBy(schema.taskSchedules.status);
    const counts: Record<schema.TaskScheduleStatus, number> = {
      active: 0,
      paused: 0,
      expired: 0,
    };
    for (const row of rows as Array<{
      status: schema.TaskScheduleStatus;
      count: number;
    }>) {
      counts[row.status] = Number(row.count);
    }
    return counts;
  }
}

/**
 * Factory for the schedule repository.
 */
export function createTaskSchedulesRepository(
  db: Database,
): TaskSchedulesRepository {
  return new TaskSchedulesRepository(db);
}
