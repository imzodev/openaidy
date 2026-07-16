import { eq, and, desc, gte, lt, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseClient } from '../client';
import * as schema from '../schema/sessions';

type Database = DatabaseClient;

/**
 * Minimal per-run usage row used for usage aggregation.
 */
export type UsageRunRow = {
  createdAt: string;
  providerId: string;
  modelId: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  cost: number | null;
};

/**
 * Cumulative usage totals for a session.
 */
export type SessionUsageTotals = {
  runCount: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  cost: number;
  /** True when at least one run had a known cost (else `cost` is 0/partial) */
  hasCost: boolean;
};

/**
 * Usage information for a run
 */
export type RunUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
};

/**
 * Success result options
 */
export type SuccessOptions = {
  finishReason: schema.FinishReason;
  usage?: RunUsage;
  /** Estimated cost in USD; null/omitted when pricing is unknown */
  cost?: number | null;
  firstMessageId?: string;
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
    const [run] = await this.db
      .insert(schema.sessionRuns)
      .values({
        id: nanoid(),
        sessionId: input.sessionId,
        agentId: input.agentId,
        providerId: input.providerId,
        modelId: input.modelId,
        status: 'queued',
        createdAt: new Date(),
        metadata: input.metadata,
      })
      .returning();

    return run!;
  }

  /**
   * Find a run by ID
   */
  async findById(id: string): Promise<schema.SessionRun | null> {
    const results = await this.db
      .select()
      .from(schema.sessionRuns)
      .where(eq(schema.sessionRuns.id, id))
      .limit(1);

    return results[0] ?? null;
  }

  /**
   * List all runs for a session
   */
  async listBySession(sessionId: string): Promise<schema.SessionRun[]> {
    return this.db
      .select()
      .from(schema.sessionRuns)
      .where(eq(schema.sessionRuns.sessionId, sessionId))
      .orderBy(desc(schema.sessionRuns.createdAt));
  }

  /**
   * Mark a run as running
   */
  async markRunning(id: string): Promise<schema.SessionRun | null> {
    const results = await this.db
      .update(schema.sessionRuns)
      .set({
        status: 'running',
        startedAt: new Date(),
      })
      .where(eq(schema.sessionRuns.id, id))
      .returning();

    return results[0] ?? null;
  }

  /**
   * List every run currently in the `running` state. Used by startup recovery
   * and the periodic reaper to find runs whose provider stream hung — or that
   * were left `running` by a process restart — and never reached a terminal
   * status on their own.
   */
  async listRunning(): Promise<schema.SessionRun[]> {
    return this.db
      .select()
      .from(schema.sessionRuns)
      .where(eq(schema.sessionRuns.status, 'running'));
  }

  /**
   * Mark a run as succeeded
   */
  async markSucceeded(
    id: string,
    input: SuccessOptions,
  ): Promise<schema.SessionRun | null> {
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
      if (input.usage.cacheReadTokens !== undefined) {
        updates.cacheReadTokens = input.usage.cacheReadTokens;
      }
      if (input.usage.cacheCreationTokens !== undefined) {
        updates.cacheCreationTokens = input.usage.cacheCreationTokens;
      }
    }

    if (input.cost !== undefined && input.cost !== null) {
      updates.cost = input.cost;
    }

    if (input.firstMessageId) {
      updates.firstMessageId = input.firstMessageId;
    }

    if (input.metadata) {
      updates.metadata = input.metadata;
    }

    const results = await this.db
      .update(schema.sessionRuns)
      .set(updates)
      .where(eq(schema.sessionRuns.id, id))
      .returning();

    return results[0] ?? null;
  }

  /**
   * Mark a run as failed
   */
  async markFailed(
    id: string,
    input: FailureOptions,
  ): Promise<schema.SessionRun | null> {
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

    const results = await this.db
      .update(schema.sessionRuns)
      .set(updates)
      .where(eq(schema.sessionRuns.id, id))
      .returning();

    return results[0] ?? null;
  }

  /**
   * Mark a run as cancelled
   */
  async markCancelled(id: string): Promise<schema.SessionRun | null> {
    const results = await this.db
      .update(schema.sessionRuns)
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
    const results = await this.db
      .select()
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
    const runningResults = await this.db
      .select()
      .from(schema.sessionRuns)
      .where(
        and(
          eq(schema.sessionRuns.sessionId, sessionId),
          eq(schema.sessionRuns.status, 'running'),
        ),
      )
      .limit(1);

    if (runningResults[0]) return runningResults[0];

    // Then check for queued runs
    const queuedResults = await this.db
      .select()
      .from(schema.sessionRuns)
      .where(
        and(
          eq(schema.sessionRuns.sessionId, sessionId),
          eq(schema.sessionRuns.status, 'queued'),
        ),
      )
      .orderBy(desc(schema.sessionRuns.createdAt))
      .limit(1);

    return queuedResults[0] ?? null;
  }

  /**
   * Fetch minimal per-run usage rows for aggregation, optionally filtered
   * by a created-at range and/or session. Grouping (by day / provider /
   * model) is done in JS by the caller so the query stays portable across
   * SQLite and Postgres (no engine-specific date functions).
   *
   * `from`/`to` are ISO-8601 strings; `to` is exclusive.
   */
  async listUsageRows(options?: {
    sessionId?: string;
    from?: string;
    to?: string;
  }): Promise<UsageRunRow[]> {
    const conditions = [eq(schema.sessionRuns.status, 'succeeded')];
    if (options?.sessionId) {
      conditions.push(eq(schema.sessionRuns.sessionId, options.sessionId));
    }
    if (options?.from) {
      conditions.push(
        gte(schema.sessionRuns.createdAt, new Date(options.from)),
      );
    }
    if (options?.to) {
      conditions.push(lt(schema.sessionRuns.createdAt, new Date(options.to)));
    }

    const rows = await this.db
      .select({
        createdAt: schema.sessionRuns.createdAt,
        providerId: schema.sessionRuns.providerId,
        modelId: schema.sessionRuns.modelId,
        promptTokens: schema.sessionRuns.promptTokens,
        completionTokens: schema.sessionRuns.completionTokens,
        totalTokens: schema.sessionRuns.totalTokens,
        cacheReadTokens: schema.sessionRuns.cacheReadTokens,
        cacheCreationTokens: schema.sessionRuns.cacheCreationTokens,
        cost: schema.sessionRuns.cost,
      })
      .from(schema.sessionRuns)
      .where(and(...conditions))
      .orderBy(schema.sessionRuns.createdAt);

    type RawUsageRow = {
      createdAt: Date | string;
      providerId: string;
      modelId: string;
      promptTokens: number | null;
      completionTokens: number | null;
      totalTokens: number | null;
      cacheReadTokens: number | null;
      cacheCreationTokens: number | null;
      cost: number | null;
    };
    return (rows as RawUsageRow[]).map((r) => ({
      createdAt:
        r.createdAt instanceof Date
          ? r.createdAt.toISOString()
          : String(r.createdAt),
      providerId: r.providerId,
      modelId: r.modelId,
      promptTokens: r.promptTokens ?? 0,
      completionTokens: r.completionTokens ?? 0,
      totalTokens: r.totalTokens ?? 0,
      cacheReadTokens: r.cacheReadTokens ?? 0,
      cacheCreationTokens: r.cacheCreationTokens ?? 0,
      cost: r.cost ?? null,
    }));
  }

  /**
   * Cumulative usage totals for a single session (succeeded runs only).
   */
  async getSessionUsage(sessionId: string): Promise<SessionUsageTotals> {
    const rows = await this.listUsageRows({ sessionId });
    const totals: SessionUsageTotals = {
      runCount: rows.length,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      cost: 0,
      hasCost: false,
    };
    for (const row of rows) {
      totals.promptTokens += row.promptTokens;
      totals.completionTokens += row.completionTokens;
      totals.totalTokens += row.totalTokens;
      totals.cacheReadTokens += row.cacheReadTokens;
      totals.cacheCreationTokens += row.cacheCreationTokens;
      if (row.cost !== null) {
        totals.cost += row.cost;
        totals.hasCost = true;
      }
    }
    return totals;
  }

  /**
   * Count runs by status for a session
   */
  async countByStatus(
    sessionId: string,
    status: schema.RunStatus,
  ): Promise<number> {
    const result = await this.db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(schema.sessionRuns)
      .where(
        and(
          eq(schema.sessionRuns.sessionId, sessionId),
          eq(schema.sessionRuns.status, status),
        ),
      );

    return Number(result[0]?.count ?? 0);
  }
}

/**
 * Create a session runs repository instance
 */
export function createSessionRunsRepository(
  db: Database,
): SessionRunsRepository {
  return new SessionRunsRepository(db);
}
