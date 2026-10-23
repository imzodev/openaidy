import { and, desc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseClient } from '../client';
import * as schema from '../schema/tasks';

type Database = DatabaseClient;

/**
 * Workflow runs repository
 *
 * One row per execution of a task's subtask graph. The task executor
 * creates the row when a run starts and finishes it once every subtask
 * has reached a terminal state (or the run is cancelled).
 */
export class WorkflowRunsRepository {
  constructor(private readonly db: Database) {}

  async create(input: {
    taskId: string;
    trigger: schema.WorkflowRunTrigger;
    sessionId?: string | null;
    historyId?: string | null;
  }): Promise<schema.WorkflowRun> {
    const [run] = await this.db
      .insert(schema.workflowRuns)
      .values({
        id: nanoid(),
        taskId: input.taskId,
        trigger: input.trigger,
        status: 'running',
        sessionId: input.sessionId ?? null,
        historyId: input.historyId ?? null,
        startedAt: new Date(),
      })
      .returning();
    return run!;
  }

  async findById(id: string): Promise<schema.WorkflowRun | null> {
    const rows = await this.db
      .select()
      .from(schema.workflowRuns)
      .where(eq(schema.workflowRuns.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  /** The task's run that is still in progress, if any. */
  async findRunning(taskId: string): Promise<schema.WorkflowRun | null> {
    const rows = await this.db
      .select()
      .from(schema.workflowRuns)
      .where(
        and(
          eq(schema.workflowRuns.taskId, taskId),
          eq(schema.workflowRuns.status, 'running'),
        ),
      )
      .orderBy(desc(schema.workflowRuns.startedAt))
      .limit(1);
    return rows[0] ?? null;
  }

  /** The task's most recent run, finished or not. */
  async findLatest(taskId: string): Promise<schema.WorkflowRun | null> {
    const rows = await this.db
      .select()
      .from(schema.workflowRuns)
      .where(eq(schema.workflowRuns.taskId, taskId))
      .orderBy(desc(schema.workflowRuns.startedAt))
      .limit(1);
    return rows[0] ?? null;
  }

  async listByTask(taskId: string, limit = 50): Promise<schema.WorkflowRun[]> {
    return this.db
      .select()
      .from(schema.workflowRuns)
      .where(eq(schema.workflowRuns.taskId, taskId))
      .orderBy(desc(schema.workflowRuns.startedAt))
      .limit(limit);
  }

  async listRunning(): Promise<schema.WorkflowRun[]> {
    return this.db
      .select()
      .from(schema.workflowRuns)
      .where(eq(schema.workflowRuns.status, 'running'));
  }

  /**
   * Move a running run to a terminal status. The `status = 'running'`
   * guard makes this idempotent: only the first finisher wins, so a
   * cancellation can't be overwritten by a late completion (or vice
   * versa). Returns null when the run was already finished.
   */
  async finish(
    id: string,
    input: {
      status: Exclude<schema.WorkflowRunStatus, 'running'>;
      error?: string | null;
      summary?: string | null;
    },
  ): Promise<schema.WorkflowRun | null> {
    const rows = await this.db
      .update(schema.workflowRuns)
      .set({
        status: input.status,
        error: input.error ?? null,
        summary: input.summary ?? null,
        finishedAt: new Date(),
      })
      .where(
        and(
          eq(schema.workflowRuns.id, id),
          eq(schema.workflowRuns.status, 'running'),
        ),
      )
      .returning();
    return rows[0] ?? null;
  }

  /**
   * Put a finished run back into `running` so a retried step continues
   * it instead of starting a new run.
   */
  async reopen(id: string): Promise<schema.WorkflowRun | null> {
    const rows = await this.db
      .update(schema.workflowRuns)
      .set({ status: 'running', error: null, summary: null, finishedAt: null })
      .where(eq(schema.workflowRuns.id, id))
      .returning();
    return rows[0] ?? null;
  }
}

export function createWorkflowRunsRepository(
  db: Database,
): WorkflowRunsRepository {
  return new WorkflowRunsRepository(db);
}
