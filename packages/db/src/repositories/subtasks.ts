import { eq, asc, and } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseClient } from '../client';
import * as schema from '../schema/tasks';

type Database = DatabaseClient;

/**
 * Subtasks repository
 *
 * Provides data access methods for subtask records.
 */
export class SubtasksRepository {
  constructor(private readonly db: Database) {}

  /**
   * Create a new subtask
   */
  async create(input: {
    taskId: string;
    title: string;
    description: string;
    orderIndex?: number;
    assignedAgentId?: string;
  }): Promise<schema.Subtask> {
    const now = new Date();
    const [subtask] = await this.db
      .insert(schema.subtasks)
      .values({
        id: nanoid(),
        taskId: input.taskId,
        title: input.title,
        description: input.description,
        status: 'pending',
        orderIndex: input.orderIndex ?? 0,
        assignedAgentId: input.assignedAgentId ?? null,
        result: null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return subtask!;
  }

  /**
   * Find a subtask by ID
   */
  async findById(id: string): Promise<schema.Subtask | null> {
    const results = await this.db
      .select()
      .from(schema.subtasks)
      .where(eq(schema.subtasks.id, id))
      .limit(1);
    return results[0] ?? null;
  }

  /**
   * List all subtasks for a task
   */
  async listByTask(taskId: string): Promise<schema.Subtask[]> {
    return this.db
      .select()
      .from(schema.subtasks)
      .where(eq(schema.subtasks.taskId, taskId))
      .orderBy(asc(schema.subtasks.orderIndex));
  }

  /**
   * Add dependency edges for a subtask: `subtaskId` depends on each of
   * `dependsOnSubtaskIds` and cannot start until they all complete.
   * Self-edges (a subtask depending on itself) are dropped rather than
   * inserted — they would deadlock the subtask forever. Also enforced
   * at the DB level via a CHECK constraint as defense in depth.
   */
  async addEdges(
    subtaskId: string,
    dependsOnSubtaskIds: string[],
  ): Promise<void> {
    const filtered = dependsOnSubtaskIds.filter((id) => id !== subtaskId);
    if (filtered.length === 0) return;
    const now = new Date();
    await this.db.insert(schema.subtaskEdges).values(
      filtered.map((dependsOnSubtaskId) => ({
        id: nanoid(),
        subtaskId,
        dependsOnSubtaskId,
        edgeKind: 'dependency',
        createdAt: now,
      })),
    );
  }

  /**
   * List all dependency edges for every subtask in a task, in one
   * query (joined through `subtasks` on `subtaskId` since edges don't
   * store `taskId` directly).
   */
  async listEdgesByTask(
    taskId: string,
  ): Promise<{ subtaskId: string; dependsOnSubtaskId: string }[]> {
    return this.db
      .select({
        subtaskId: schema.subtaskEdges.subtaskId,
        dependsOnSubtaskId: schema.subtaskEdges.dependsOnSubtaskId,
      })
      .from(schema.subtaskEdges)
      .innerJoin(
        schema.subtasks,
        eq(schema.subtaskEdges.subtaskId, schema.subtasks.id),
      )
      .where(eq(schema.subtasks.taskId, taskId));
  }

  /**
   * List subtasks by status within a task
   */
  async listByStatus(
    taskId: string,
    status: schema.SubtaskStatus,
  ): Promise<schema.Subtask[]> {
    return this.db
      .select()
      .from(schema.subtasks)
      .where(
        and(
          eq(schema.subtasks.taskId, taskId),
          eq(schema.subtasks.status, status),
        ),
      )
      .orderBy(asc(schema.subtasks.orderIndex));
  }

  /**
   * Update a subtask
   */
  async update(
    id: string,
    input: {
      title?: string;
      description?: string;
      orderIndex?: number;
      sessionId?: string | null;
      status?: schema.SubtaskStatus;
      result?: string | null;
    },
  ): Promise<schema.Subtask | null> {
    const results = await this.db
      .update(schema.subtasks)
      .set({
        ...input,
        updatedAt: new Date(),
      })
      .where(eq(schema.subtasks.id, id))
      .returning();

    return results[0] ?? null;
  }

  /**
   * Assign an agent to a subtask
   */
  async assignAgent(
    id: string,
    agentId: string,
  ): Promise<schema.Subtask | null> {
    const results = await this.db
      .update(schema.subtasks)
      .set({
        assignedAgentId: agentId,
        status: 'assigned',
        updatedAt: new Date(),
      })
      .where(eq(schema.subtasks.id, id))
      .returning();

    return results[0] ?? null;
  }

  /**
   * Update a subtask's status
   */
  async updateStatus(
    id: string,
    status: schema.SubtaskStatus,
  ): Promise<schema.Subtask | null> {
    const results = await this.db
      .update(schema.subtasks)
      .set({
        status,
        updatedAt: new Date(),
      })
      .where(eq(schema.subtasks.id, id))
      .returning();

    return results[0] ?? null;
  }

  /**
   * Set the result of a subtask
   */
  async setResult(id: string, result: string): Promise<schema.Subtask | null> {
    const results = await this.db
      .update(schema.subtasks)
      .set({
        result,
        updatedAt: new Date(),
      })
      .where(eq(schema.subtasks.id, id))
      .returning();

    return results[0] ?? null;
  }

  /**
   * Get counts of subtasks by status for a task
   */
  async getCountsByStatus(
    taskId: string,
  ): Promise<Record<schema.SubtaskStatus, number>> {
    const subtasks = await this.listByTask(taskId);
    const counts: Record<schema.SubtaskStatus, number> = {
      pending: 0,
      assigned: 0,
      in_progress: 0,
      completed: 0,
      failed: 0,
    };
    for (const subtask of subtasks) {
      counts[subtask.status]++;
    }
    return counts;
  }

  /**
   * Reset all subtasks for a task so a recurring run can execute them again.
   *
   * Clears previous results, session links, retry counts and pending
   * verification state, and moves every subtask back to `pending`. This is
   * used by the recurring-task executor when `replanPolicy` is `never` or
   * `on-description-change` and the description has not changed — the existing
   * plan is reused, but each run must start from scratch.
   */
  async resetByTask(taskId: string): Promise<schema.Subtask[]> {
    const results = await this.db
      .update(schema.subtasks)
      .set({
        status: 'pending',
        result: null,
        sessionId: null,
        retryCount: 0,
        pendingVerificationResult: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.subtasks.taskId, taskId))
      .returning();
    return results;
  }

  /**
   * Delete all subtasks for a task
   */
  async deleteByTask(taskId: string): Promise<schema.Subtask[]> {
    const results = await this.db
      .delete(schema.subtasks)
      .where(eq(schema.subtasks.taskId, taskId))
      .returning();
    return results;
  }

  /**
   * Delete a subtask
   */
  async delete(id: string): Promise<schema.Subtask | null> {
    const results = await this.db
      .delete(schema.subtasks)
      .where(eq(schema.subtasks.id, id))
      .returning();

    return results[0] ?? null;
  }

  /**
   * Increment the retry count for a subtask
   */
  async incrementRetryCount(id: string): Promise<schema.Subtask | null> {
    const subtask = await this.findById(id);
    if (!subtask) return null;

    const results = await this.db
      .update(schema.subtasks)
      .set({
        retryCount: (subtask.retryCount ?? 0) + 1,
        updatedAt: new Date(),
      })
      .where(eq(schema.subtasks.id, id))
      .returning();

    return results[0] ?? null;
  }

  /**
   * List all subtasks across all tasks
   */
  async listAll(): Promise<schema.Subtask[]> {
    return this.db.select().from(schema.subtasks);
  }

  /**
   * Find a subtask by its session ID (uses index)
   */
  async findBySessionId(sessionId: string): Promise<schema.Subtask | null> {
    const results = await this.db
      .select()
      .from(schema.subtasks)
      .where(eq(schema.subtasks.sessionId, sessionId))
      .limit(1);
    return results[0] ?? null;
  }

  /**
   * Set or clear the pending verification result for a subtask.
   * This persists the result temporarily while awaiting verification,
   * surviving process restarts.
   */
  async setPendingVerificationResult(
    id: string,
    result: string | null,
  ): Promise<schema.Subtask | null> {
    const results = await this.db
      .update(schema.subtasks)
      .set({
        pendingVerificationResult: result,
        updatedAt: new Date(),
      })
      .where(eq(schema.subtasks.id, id))
      .returning();

    return results[0] ?? null;
  }

  /**
   * Atomically complete a subtask: update status, set result, clear pending verification.
   * Returns the updated subtask or null if not found.
   */
  async completeSubtask(
    id: string,
    result: string,
  ): Promise<schema.Subtask | null> {
    const results = await this.db
      .update(schema.subtasks)
      .set({
        status: 'completed',
        result,
        pendingVerificationResult: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.subtasks.id, id))
      .returning();

    return results[0] ?? null;
  }

  /**
   * Atomically fail a subtask: update status, set error as result, clear pending verification.
   * Returns the updated subtask or null if not found.
   */
  async failSubtask(
    id: string,
    errorMessage: string,
  ): Promise<schema.Subtask | null> {
    const results = await this.db
      .update(schema.subtasks)
      .set({
        status: 'failed',
        result: errorMessage,
        pendingVerificationResult: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.subtasks.id, id))
      .returning();

    return results[0] ?? null;
  }
}

/**
 * Create a subtasks repository instance
 */
export function createSubtasksRepository(db: Database): SubtasksRepository {
  return new SubtasksRepository(db);
}
