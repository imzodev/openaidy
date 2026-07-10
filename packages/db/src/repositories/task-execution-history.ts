import { eq, desc, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseClient } from '../client';
import * as schema from '../schema/tasks';

type Database = DatabaseClient;

/**
 * Task execution history repository
 *
 * Append-only log of runs. The executor (Phase 2) writes a row at the
 * start of every run, then updates its status as the run progresses.
 * The RunEventEmitter flow also writes here when a run's session
 * transitions to `completed` or `failed` — that's the same row the
 * executor created, just updated.
 */
export class TaskExecutionHistoryRepository {
  constructor(private readonly db: Database) {}

  /**
   * Create a new history row at the start of a run.
   *
   * Always sets `status = 'planned'`. The caller updates it later as
   * the run progresses.
   */
  async create(input: {
    taskId: string;
    scheduleId: string;
    taskTitle: string;
    taskDescription: string;
    attemptNumber?: number;
  }): Promise<schema.TaskExecutionHistoryRow> {
    // We bypass the typed Drizzle insert because the table is declared
    // with `pgTable` (Postgres-style types), but the actual driver in
    // the dev SQLite DB is node:sqlite. Two mismatches:
    //   1. `defaultNow()` would compile to `now()` in SQL, which
    //      SQLite doesn't have. `task_execution_history` is created
    //      via raw CREATE TABLE in client.ts with `TEXT NOT NULL
    //      DEFAULT CURRENT_TIMESTAMP` (so the SQL default works) but
    //      Drizzle still emits `now()` from the typed schema.
    //   2. `timestamp({ withTimezone: true })` columns try to bind
    //      JS `Date` objects, but node:sqlite only accepts
    //      numbers/strings/bigints/buffers/null. Other repos work
    //      around this by passing the value through a different path,
    //      but `create` here is the only place that does an INSERT
    //      (everywhere else is an UPDATE which Drizzle handles).
    //
    // Using raw SQL is the only way to avoid the schema-vs-driver
    // mismatch for inserts to this table.
    const id = nanoid();
    const now = new Date().toISOString();
    const _result = await this.db.run(
      // drizzle-orm exposes `sql` for parameterised raw queries.
      sql`INSERT INTO task_execution_history
            (id, task_id, schedule_id, status, task_title,
             task_description, attempt_number, started_at, created_at)
          VALUES
            (${id}, ${input.taskId}, ${input.scheduleId}, ${'planned'},
             ${input.taskTitle}, ${input.taskDescription},
             ${input.attemptNumber ?? 1}, ${now}, ${now})`,
    );
    // `result` from a Drizzle SQLite run doesn't echo the row back;
    // look it up to return a row-shaped object.
    const found = await this.findById(id);
    if (!found) {
      throw new Error(
        `task_execution_history.create: row not found after insert (id=${id})`,
      );
    }
    return found;
  }

  /**
   * Find a history row by primary key.
   */
  async findById(id: string): Promise<schema.TaskExecutionHistoryRow | null> {
    const rows = await this.db
      .select()
      .from(schema.taskExecutionHistory)
      .where(eq(schema.taskExecutionHistory.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Find the most recent history row for a given session.
   *
   * The RunEventEmitter handler in the executor uses this to look up
   * the row that a just-completed session belongs to. Newest first
   * because a session is associated with exactly one history row,
   * but we order by `createdAt` desc to be safe if a session is
   * somehow reused.
   */
  async findBySessionId(
    sessionId: string,
  ): Promise<schema.TaskExecutionHistoryRow | null> {
    const rows = await this.db
      .select()
      .from(schema.taskExecutionHistory)
      .where(eq(schema.taskExecutionHistory.sessionId, sessionId))
      .orderBy(desc(schema.taskExecutionHistory.createdAt))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Update a history row. Used by the executor to mark progress
   * (planned → planning → executing → verifying → completed/failed)
   * and by the RunEventEmitter handler to finalise status.
   */
  async update(
    id: string,
    input: {
      status?: schema.TaskExecutionHistoryStatus;
      sessionId?: string | null;
      didReplan?: boolean;
      finishedAt?: Date | null;
      durationMs?: number | null;
      errorCode?: string | null;
      errorMessage?: string | null;
      subtaskSummary?: string | null;
    },
  ): Promise<schema.TaskExecutionHistoryRow | null> {
    const rows = await this.db
      .update(schema.taskExecutionHistory)
      .set(input)
      .where(eq(schema.taskExecutionHistory.id, id))
      .returning();
    return rows[0] ?? null;
  }

  /**
   * Convenience: set just the status (plus optional sessionId).
   * Used heavily by the executor's lifecycle transitions.
   */
  async updateStatus(
    id: string,
    input: {
      status: schema.TaskExecutionHistoryStatus;
      sessionId?: string | null;
      didReplan?: boolean;
    },
  ): Promise<schema.TaskExecutionHistoryRow | null> {
    return this.update(id, input);
  }

  /**
   * Mark a row as completed. Stamps `finishedAt` and `durationMs`.
   */
  async markCompleted(
    id: string,
    durationMs: number,
  ): Promise<schema.TaskExecutionHistoryRow | null> {
    return this.update(id, {
      status: 'completed',
      finishedAt: new Date(),
      durationMs,
    });
  }

  /**
   * Mark a row as failed. Captures the error info.
   */
  async markFailed(
    id: string,
    durationMs: number,
    error: { code: string; message: string },
  ): Promise<schema.TaskExecutionHistoryRow | null> {
    return this.update(id, {
      status: 'failed',
      finishedAt: new Date(),
      durationMs,
      errorCode: error.code,
      errorMessage: error.message,
    });
  }

  /**
   * List all history rows for a task, newest first.
   *
   * Used by the executions history page in the UI (Phase 6) and by
   * the `tasks_list_executions` tool (Phase 5). The caller is
   * responsible for pagination — this returns all rows.
   */
  async listByTask(taskId: string): Promise<schema.TaskExecutionHistoryRow[]> {
    return this.db
      .select()
      .from(schema.taskExecutionHistory)
      .where(eq(schema.taskExecutionHistory.taskId, taskId))
      .orderBy(desc(schema.taskExecutionHistory.startedAt));
  }

  /**
   * List history rows for a schedule, newest first. Used by the
   * executions page when scoped to a specific schedule.
   */
  async listBySchedule(
    scheduleId: string,
  ): Promise<schema.TaskExecutionHistoryRow[]> {
    return this.db
      .select()
      .from(schema.taskExecutionHistory)
      .where(eq(schema.taskExecutionHistory.scheduleId, scheduleId))
      .orderBy(desc(schema.taskExecutionHistory.startedAt));
  }

  /**
   * List history rows filtered by status. Useful for showing
   * "all failed runs" or "currently executing runs" in the UI.
   */
  async listByStatus(
    status: schema.TaskExecutionHistoryStatus,
  ): Promise<schema.TaskExecutionHistoryRow[]> {
    return this.db
      .select()
      .from(schema.taskExecutionHistory)
      .where(eq(schema.taskExecutionHistory.status, status))
      .orderBy(desc(schema.taskExecutionHistory.startedAt));
  }

  /**
   * Count history rows by status. Useful for dashboard summaries.
   */
  async countByStatus(): Promise<
    Record<schema.TaskExecutionHistoryStatus, number>
  > {
    const rows = await this.db
      .select({
        status: schema.taskExecutionHistory.status,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.taskExecutionHistory)
      .groupBy(schema.taskExecutionHistory.status);
    const counts: Record<schema.TaskExecutionHistoryStatus, number> = {
      planned: 0,
      planning: 0,
      executing: 0,
      verifying: 0,
      completed: 0,
      failed: 0,
    };
    for (const row of rows as Array<{
      status: schema.TaskExecutionHistoryStatus;
      count: number;
    }>) {
      counts[row.status] = Number(row.count);
    }
    return counts;
  }

  /**
   * List the most recent N runs for a task, paginated by offset.
   * Used by the executions history page when the dataset gets large.
   */
  async listByTaskPaginated(
    taskId: string,
    options: { limit: number; offset: number },
  ): Promise<schema.TaskExecutionHistoryRow[]> {
    return this.db
      .select()
      .from(schema.taskExecutionHistory)
      .where(eq(schema.taskExecutionHistory.taskId, taskId))
      .orderBy(desc(schema.taskExecutionHistory.startedAt))
      .limit(options.limit)
      .offset(options.offset);
  }
}

/**
 * Factory for the history repository.
 */
export function createTaskExecutionHistoryRepository(
  db: Database,
): TaskExecutionHistoryRepository {
  return new TaskExecutionHistoryRepository(db);
}
