import { asc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseClient } from '../client';
import * as schema from '../schema/tasks';

type Database = DatabaseClient;

// SQLite stores `enabled` as 0/1 and node:sqlite can't bind a JS boolean,
// so it's written as an integer (Postgres accepts that for a boolean
// parameter too) and normalised back to a boolean on read.
const flag = (value: boolean) => (value ? 1 : 0) as unknown as boolean;
const normalise = (row: schema.WorkflowTrigger): schema.WorkflowTrigger => ({
  ...row,
  enabled: Boolean(row.enabled),
});

/**
 * Workflow triggers repository
 *
 * Webhooks and channel-message rules that start a workflow run. `config`
 * is stored as JSON text and parsed by the caller.
 */
export class WorkflowTriggersRepository {
  constructor(private readonly db: Database) {}

  async create(input: {
    taskId: string;
    kind: schema.WorkflowTriggerKind;
    name: string;
    config: string;
    enabled?: boolean;
    secretHash?: string | null;
  }): Promise<schema.WorkflowTrigger> {
    const now = new Date();
    const [row] = await this.db
      .insert(schema.workflowTriggers)
      .values({
        id: nanoid(),
        taskId: input.taskId,
        kind: input.kind,
        name: input.name,
        config: input.config,
        enabled: flag(input.enabled ?? true),
        secretHash: input.secretHash ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return normalise(row!);
  }

  async findById(id: string): Promise<schema.WorkflowTrigger | null> {
    const rows = await this.db
      .select()
      .from(schema.workflowTriggers)
      .where(eq(schema.workflowTriggers.id, id))
      .limit(1);
    return rows[0] ? normalise(rows[0]) : null;
  }

  async listByTask(taskId: string): Promise<schema.WorkflowTrigger[]> {
    const rows = await this.db
      .select()
      .from(schema.workflowTriggers)
      .where(eq(schema.workflowTriggers.taskId, taskId))
      .orderBy(asc(schema.workflowTriggers.createdAt));
    return rows.map(normalise);
  }

  /** Every trigger, optionally of one kind, oldest first. */
  async list(
    kind?: schema.WorkflowTriggerKind,
  ): Promise<schema.WorkflowTrigger[]> {
    const rows = await this.db
      .select()
      .from(schema.workflowTriggers)
      .where(kind ? eq(schema.workflowTriggers.kind, kind) : undefined)
      .orderBy(asc(schema.workflowTriggers.createdAt));
    return rows.map(normalise);
  }

  /** Enabled triggers of one kind, oldest first (first match wins). */
  async listEnabled(
    kind: schema.WorkflowTriggerKind,
  ): Promise<schema.WorkflowTrigger[]> {
    return (await this.list(kind)).filter((t) => t.enabled);
  }

  async update(
    id: string,
    input: {
      name?: string;
      config?: string;
      enabled?: boolean;
      secretHash?: string | null;
    },
  ): Promise<schema.WorkflowTrigger | null> {
    const { enabled, ...rest } = input;
    const rows = await this.db
      .update(schema.workflowTriggers)
      .set({
        ...rest,
        ...(enabled !== undefined && { enabled: flag(enabled) }),
        updatedAt: new Date(),
      })
      .where(eq(schema.workflowTriggers.id, id))
      .returning();
    return rows[0] ? normalise(rows[0]) : null;
  }

  async markFired(id: string): Promise<void> {
    await this.db
      .update(schema.workflowTriggers)
      .set({ lastFiredAt: new Date() })
      .where(eq(schema.workflowTriggers.id, id));
  }

  async delete(id: string): Promise<schema.WorkflowTrigger | null> {
    const rows = await this.db
      .delete(schema.workflowTriggers)
      .where(eq(schema.workflowTriggers.id, id))
      .returning();
    return rows[0] ? normalise(rows[0]) : null;
  }
}

export function createWorkflowTriggersRepository(
  db: Database,
): WorkflowTriggersRepository {
  return new WorkflowTriggersRepository(db);
}
