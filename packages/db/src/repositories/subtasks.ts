import { eq, asc, and, isNotNull, sql } from 'drizzle-orm';
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
    subtaskKind?: schema.Subtask['subtaskKind'];
    loop?: {
      maxIterations: number;
      conditionOperator: string;
      conditionValue: string;
    } | null;
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
        subtaskKind: input.subtaskKind ?? 'agent',
        loopMaxIterations: input.loop?.maxIterations ?? null,
        loopConditionOperator: input.loop?.conditionOperator ?? null,
        loopConditionValue: input.loop?.conditionValue ?? null,
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
   * store `taskId` directly). Includes `edgeKind`/condition columns so
   * execution's `isSubtaskExecutable` can gate conditional edges —
   * existing callers that only read `subtaskId`/`dependsOnSubtaskId`
   * are unaffected by the extra fields.
   */
  async listEdgesByTask(taskId: string): Promise<
    {
      subtaskId: string;
      dependsOnSubtaskId: string;
      edgeKind: string;
      conditionOperator: string | null;
      conditionValue: string | null;
    }[]
  > {
    return this.db
      .select({
        subtaskId: schema.subtaskEdges.subtaskId,
        dependsOnSubtaskId: schema.subtaskEdges.dependsOnSubtaskId,
        edgeKind: schema.subtaskEdges.edgeKind,
        conditionOperator: schema.subtaskEdges.conditionOperator,
        conditionValue: schema.subtaskEdges.conditionValue,
      })
      .from(schema.subtaskEdges)
      .innerJoin(
        schema.subtasks,
        eq(schema.subtaskEdges.subtaskId, schema.subtasks.id),
      )
      .where(eq(schema.subtasks.taskId, taskId));
  }

  /**
   * Add a single dependency edge, optionally conditional. Unlike
   * `addEdges` (bulk, planner-only, always plain 'dependency' edges),
   * this is used by the workflow editor's edge-CRUD API and supports
   * `edgeKind: 'conditional'` with a condition.
   */
  async addEdge(input: {
    subtaskId: string;
    dependsOnSubtaskId: string;
    edgeKind?: 'dependency' | 'conditional' | undefined;
    condition?: { operator: string; value: string } | null | undefined;
  }): Promise<schema.SubtaskEdge> {
    const now = new Date();
    const [edge] = await this.db
      .insert(schema.subtaskEdges)
      .values({
        id: nanoid(),
        subtaskId: input.subtaskId,
        dependsOnSubtaskId: input.dependsOnSubtaskId,
        edgeKind: input.edgeKind ?? 'dependency',
        conditionOperator: input.condition?.operator ?? null,
        conditionValue: input.condition?.value ?? null,
        createdAt: now,
      })
      .returning();
    return edge!;
  }

  /**
   * Update an edge's kind/condition (e.g. converting a plain dependency
   * edge to a conditional one, or vice versa).
   */
  async updateEdge(
    id: string,
    input: {
      edgeKind?: 'dependency' | 'conditional' | undefined;
      condition?: { operator: string; value: string } | null | undefined;
    },
  ): Promise<schema.SubtaskEdge | null> {
    const conditionFields =
      input.condition === undefined
        ? {}
        : input.condition === null
          ? { conditionOperator: null, conditionValue: null }
          : {
              conditionOperator: input.condition.operator,
              conditionValue: input.condition.value,
            };
    const results = await this.db
      .update(schema.subtaskEdges)
      .set({
        ...(input.edgeKind !== undefined ? { edgeKind: input.edgeKind } : {}),
        ...conditionFields,
      })
      .where(eq(schema.subtaskEdges.id, id))
      .returning();
    return results[0] ?? null;
  }

  /**
   * Delete a single edge.
   */
  async deleteEdge(id: string): Promise<schema.SubtaskEdge | null> {
    const results = await this.db
      .delete(schema.subtaskEdges)
      .where(eq(schema.subtaskEdges.id, id))
      .returning();
    return results[0] ?? null;
  }

  /**
   * Like `listEdgesByTask`, but includes the edge id/kind/condition
   * columns needed by the workflow editor's edge-CRUD API. Kept separate
   * so `listEdgesByTask`'s existing minimal shape (used by execution and
   * eligibility checks) never has to change.
   */
  async listEdgesByTaskFull(taskId: string): Promise<
    Array<{
      id: string;
      subtaskId: string;
      dependsOnSubtaskId: string;
      edgeKind: string;
      conditionOperator: string | null;
      conditionValue: string | null;
      createdAt: Date;
    }>
  > {
    return this.db
      .select({
        id: schema.subtaskEdges.id,
        subtaskId: schema.subtaskEdges.subtaskId,
        dependsOnSubtaskId: schema.subtaskEdges.dependsOnSubtaskId,
        edgeKind: schema.subtaskEdges.edgeKind,
        conditionOperator: schema.subtaskEdges.conditionOperator,
        conditionValue: schema.subtaskEdges.conditionValue,
        createdAt: schema.subtaskEdges.createdAt,
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
      subtaskKind?: schema.Subtask['subtaskKind'];
      loop?: {
        maxIterations: number;
        conditionOperator: string;
        conditionValue: string;
      } | null;
    },
  ): Promise<schema.Subtask | null> {
    const { loop, ...rest } = input;
    const loopFields =
      loop === undefined
        ? {}
        : loop === null
          ? {
              loopMaxIterations: null,
              loopConditionOperator: null,
              loopConditionValue: null,
            }
          : {
              loopMaxIterations: loop.maxIterations,
              loopConditionOperator: loop.conditionOperator,
              loopConditionValue: loop.conditionValue,
            };
    const results = await this.db
      .update(schema.subtasks)
      .set({
        ...rest,
        ...loopFields,
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
   * Increment the retry count for a subtask. Uses an atomic `col = col + 1`
   * SQL expression rather than read-then-write, so two concurrent events
   * for the same subtask can't both read the same count and clobber each
   * other's increment.
   */
  async incrementRetryCount(id: string): Promise<schema.Subtask | null> {
    const results = await this.db
      .update(schema.subtasks)
      .set({
        retryCount: sql`${schema.subtasks.retryCount} + 1`,
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
   * Mark (or clear) a subtask as awaiting a human approval decision.
   * Presence of a non-null `awaitingApprovalSince` is the pause sentinel —
   * `status` stays `in_progress` throughout, mirroring how
   * `pendingVerificationResult` signals an automated-verification pause.
   */
  async setAwaitingApproval(
    id: string,
    awaiting: boolean,
  ): Promise<schema.Subtask | null> {
    const results = await this.db
      .update(schema.subtasks)
      .set({
        awaitingApprovalSince: awaiting ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(schema.subtasks.id, id))
      .returning();
    return results[0] ?? null;
  }

  /**
   * Record a human's approve/reject decision on an approval-gate subtask
   * and clear the pause sentinel. Does not itself complete/fail the
   * subtask — the caller (TaskExecution.resolveApproval) does that via
   * the normal completeSubtask/failSubtask cascade.
   *
   * The WHERE clause requires `awaitingApprovalSince IS NOT NULL`
   * atomically, rather than the caller checking it via a separate read
   * first — two concurrent resolve calls can't both succeed; the second
   * gets `null` back since the row no longer matches after the first
   * clears the sentinel.
   */
  async resolveApproval(
    id: string,
    input: {
      decision: 'approved' | 'rejected';
      note?: string | null;
      approvedBy?: string | null;
    },
  ): Promise<schema.Subtask | null> {
    const results = await this.db
      .update(schema.subtasks)
      .set({
        approvalDecision: input.decision,
        approvalNote: input.note ?? null,
        approvedBy: input.approvedBy ?? null,
        awaitingApprovalSince: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.subtasks.id, id),
          isNotNull(schema.subtasks.awaitingApprovalSince),
        ),
      )
      .returning();
    return results[0] ?? null;
  }

  /**
   * Record one iteration of a bounded self-loop: stash the iteration's
   * result for the next iteration's context, bump the counter atomically
   * (`col = col + 1`, not read-then-write — see `incrementRetryCount`),
   * and reset the subtask back to `pending` (clearing session/verification
   * state) so the next executeSubtasks() scan picks it straight back up.
   * Scoped single-row analog of `resetByTask`.
   */
  async recordLoopIteration(
    id: string,
    input: { result: string },
  ): Promise<schema.Subtask | null> {
    const results = await this.db
      .update(schema.subtasks)
      .set({
        status: 'pending',
        sessionId: null,
        pendingVerificationResult: null,
        loopLastResult: input.result,
        loopIterationCount: sql`${schema.subtasks.loopIterationCount} + 1`,
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
