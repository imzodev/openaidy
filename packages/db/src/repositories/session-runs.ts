import { eq, and, desc, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseClient } from '../client';
import * as schema from '../schema/sessions';

type Database = DatabaseClient;

/**
 * Usage information for a run
 */
export type RunUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

/**
 * Success result options
 */
export type SuccessOptions = {
  finishReason: schema.FinishReason;
  usage?: RunUsage;
  metadata?: Record<string, unknown>;
};

/**
 * Failure options
 */
export type FailureOptions = {
  errorCode: string;
  errorMessage: string;
  metadata?: Record<string, unknown>;
};

/**
 * Session runs repository
 * 
 * Provides data access methods for session run records.
 * Tracks provider invocations with support for async execution states.
 */
export class SessionRunsRepository {
  constructor(private readonly db: Database) {}

  /**
   * Create a new run record (starts in 'queued' status)
   */
  async create(input: {
    sessionId: string;
    agentId: string;
    providerId: string;
    modelId: string;
    metadata?: Record<string, unknown>;
  }): Promise<schema.SessionRun> {
    const [run] = await this.db.insert(schema.sessionRuns).values({
      id: nanoid(),
      sessionId: input.sessionId,
      agentId: input.agentId,
      providerId: input.providerId,
      modelId: input.modelId,
      status: 'queued',
      createdAt: new Date(),
      metadata: input.metadata,
    }).returning();

    return run!;
  }

  /**
   * Find a run by ID
   */
  async findById(id: string): Promise<schema.SessionRun | null> {
    const results = await this.db.select()
      .from(schema.sessionRuns)
      .where(eq(schema.sessionRuns.id, id))
      .limit(1);

    return results[0] ?? null;
  }

  /**
   * List all runs for a session
   */
  async listBySession(sessionId: string): Promise<schema.SessionRun[]> {
    return this.db.select()
      .from(schema.sessionRuns)
      .where(eq(schema.sessionRuns.sessionId, sessionId))
      .orderBy(desc(schema.sessionRuns.createdAt));
  }

  /**
   * Mark a run as running
   */
  async markRunning(id: string): Promise<schema.SessionRun | null> {
    const results = await this.db.update(schema.sessionRuns)
      .set({
        status: 'running',
        startedAt: new Date(),
      })
      .where(eq(schema.sessionRuns.id, id))
      .returning();

    return results[0] ?? null;
  }

  /**
   * Mark a run as succeeded
   */
  async markSucceeded(id: string, input: SuccessOptions): Promise<schema.SessionRun | null> {
    const now = new Date();
    const updates: Partial<schema.SessionRun> = {
      status: 'succeeded',
      finishReason: input.finishReason,
      finishedAt: now,
    };

    if (input.usage) {
      updates.promptTokens = input.usage.promptTokens;
      updates.completionTokens = input.usage.completionTokens;
      updates.totalTokens = input.usage.totalTokens;
    }

    if (input.metadata) {
      updates.metadata = input.metadata;
    }

    const results = await this.db.update(schema.sessionRuns)
      .set(updates)
      .where(eq(schema.sessionRuns.id, id))
      .returning();

    return results[0] ?? null;
  }

  /**
   * Mark a run as failed
   */
  async markFailed(id: string, input: FailureOptions): Promise<schema.SessionRun | null> {
    const now = new Date();
    const updates: Partial<schema.SessionRun> = {
      status: 'failed',
      finishReason: 'error',
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
      finishedAt: now,
    };

    if (input.metadata) {
      updates.metadata = input.metadata;
    }

    const results = await this.db.update(schema.sessionRuns)
      .set(updates)
      .where(eq(schema.sessionRuns.id, id))
      .returning();

    return results[0] ?? null;
  }

  /**
   * Mark a run as cancelled
   */
  async markCancelled(id: string): Promise<schema.SessionRun | null> {
    const results = await this.db.update(schema.sessionRuns)
      .set({
        status: 'cancelled',
        finishedAt: new Date(),
      })
      .where(eq(schema.sessionRuns.id, id))
      .returning();

    return results[0] ?? null;
  }

  /**
   * Get the latest run for a session
   */
  async getLatest(sessionId: string): Promise<schema.SessionRun | null> {
    const results = await this.db.select()
      .from(schema.sessionRuns)
      .where(eq(schema.sessionRuns.sessionId, sessionId))
      .orderBy(desc(schema.sessionRuns.createdAt))
      .limit(1);

    return results[0] ?? null;
  }

  /**
   * Get the active (running or queued) run for a session
   */
  async getActive(sessionId: string): Promise<schema.SessionRun | null> {
    // First check for running runs
    const runningResults = await this.db.select()
      .from(schema.sessionRuns)
      .where(
        and(
          eq(schema.sessionRuns.sessionId, sessionId),
          eq(schema.sessionRuns.status, 'running')
        )
      )
      .limit(1);

    if (runningResults[0]) return runningResults[0];

    // Then check for queued runs
    const queuedResults = await this.db.select()
      .from(schema.sessionRuns)
      .where(
        and(
          eq(schema.sessionRuns.sessionId, sessionId),
          eq(schema.sessionRuns.status, 'queued')
        )
      )
      .orderBy(desc(schema.sessionRuns.createdAt))
      .limit(1);

    return queuedResults[0] ?? null;
  }

  /**
   * Count runs by status for a session
   */
  async countByStatus(sessionId: string, status: schema.RunStatus): Promise<number> {
    const result = await this.db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(schema.sessionRuns)
      .where(
        and(
          eq(schema.sessionRuns.sessionId, sessionId),
          eq(schema.sessionRuns.status, status)
        )
      );

    return Number(result[0]?.count ?? 0);
  }
}

/**
 * Create a session runs repository instance
 */
export function createSessionRunsRepository(db: Database): SessionRunsRepository {
  return new SessionRunsRepository(db);
}
