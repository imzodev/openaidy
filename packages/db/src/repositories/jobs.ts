import { randomUUID } from 'node:crypto';
import { eq, and, lte, asc, desc, sql } from 'drizzle-orm';
import type { DatabaseClient } from '../client';
import * as schema from '../schema/jobs';

type Database = DatabaseClient;

/**
 * Jobs repository
 * 
 * Provides data access methods for scheduled job records.
 * Includes atomic job claiming with PostgreSQL FOR UPDATE SKIP LOCKED.
 */
export class JobsRepository {
  constructor(private readonly db: Database) {}

  /**
   * Claim the next due job atomically
   * 
   * Uses PostgreSQL FOR UPDATE SKIP LOCKED to prevent concurrent execution.
   * This ensures that multiple scheduler instances never claim the same job.
   * 
   * @returns The next due job, or null if none available
   */
  async claimNextDueJob(): Promise<schema.ScheduledJob | null> {
    const results = await this.db.transaction(async (tx: any) => {
      const jobs = await tx
        .select()
        .from(schema.scheduledJobs)
        .where(
          and(
            eq(schema.scheduledJobs.status, 'active'),
            lte(schema.scheduledJobs.nextRunAt, new Date())
          )
        )
        .orderBy(asc(schema.scheduledJobs.nextRunAt))
        .limit(1)
        .for('update', { skipLocked: true });

      return jobs;
    });

    return results[0] ?? null;
  }

  /**
   * Create a new scheduled job
   */
  async create(input: {
    type: schema.JobType;
    schedule?: Date;
    cronExpression?: string;
    targetType: schema.JobTargetType;
    targetSessionId?: string;
    payload: Record<string, unknown>;
    status?: schema.JobStatus;
    maxRetries?: number;
    backoffMs?: number;
    metadata?: Record<string, unknown>;
    nextRunAt: Date;
  }): Promise<schema.ScheduledJob> {
    const [job] = await this.db.insert(schema.scheduledJobs).values({
      id: randomUUID(),
      type: input.type,
      schedule: input.schedule,
      cronExpression: input.cronExpression,
      targetType: input.targetType,
      targetSessionId: input.targetSessionId ?? null,
      payload: input.payload,
      status: input.status ?? 'active',
      nextRunAt: input.nextRunAt,
      maxRetries: input.maxRetries ?? 3,
      backoffMs: input.backoffMs ?? 1000,
      metadata: input.metadata ?? null,
      retryCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning();

    return job!;
  }

  /**
   * Find job by ID
   */
  async findById(id: string): Promise<schema.ScheduledJob | null> {
    const results = await this.db.select()
      .from(schema.scheduledJobs)
      .where(eq(schema.scheduledJobs.id, id))
      .limit(1);
    return results[0] ?? null;
  }

  /**
   * List jobs with optional filters
   */
  async list(filters?: {
    status?: schema.JobStatus;
    type?: schema.JobType;
    targetType?: schema.JobTargetType;
    targetSessionId?: string;
    limit?: number;
    offset?: number;
  }): Promise<schema.ScheduledJob[]> {
    const conditions = [];
    
    if (filters?.status) {
      conditions.push(eq(schema.scheduledJobs.status, filters.status));
    }
    if (filters?.type) {
      conditions.push(eq(schema.scheduledJobs.type, filters.type));
    }
    if (filters?.targetType) {
      conditions.push(eq(schema.scheduledJobs.targetType, filters.targetType));
    }
    if (filters?.targetSessionId) {
      conditions.push(eq(schema.scheduledJobs.targetSessionId, filters.targetSessionId));
    }

    const query = this.db.select()
      .from(schema.scheduledJobs)
      .orderBy(desc(schema.scheduledJobs.createdAt));

    if (conditions.length > 0) {
      query.where(and(...conditions));
    }

    if (filters?.limit) {
      query.limit(filters.limit);
    }
    if (filters?.offset) {
      query.offset(filters.offset);
    }

    return query;
  }

  /**
   * Update job fields
   */
  async update(id: string, updates: {
    status?: schema.JobStatus;
    nextRunAt?: Date;
    lastRunAt?: Date;
    retryCount?: number;
    metadata?: Record<string, unknown>;
  }): Promise<schema.ScheduledJob> {
    const [job] = await this.db.update(schema.scheduledJobs)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(schema.scheduledJobs.id, id))
      .returning();

    return job!;
  }

  /**
   * Delete job (cascade deletes runs)
   */
  async delete(id: string): Promise<void> {
    await this.db.delete(schema.scheduledJobs)
      .where(eq(schema.scheduledJobs.id, id));
  }

  /**
   * Count jobs by status
   */
  async countByStatus(status: schema.JobStatus): Promise<number> {
    const [result] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(schema.scheduledJobs)
      .where(eq(schema.scheduledJobs.status, status));

    return result?.count ?? 0;
  }

  /**
   * Get all active jobs (for scheduler initialization)
   */
  async listActive(): Promise<schema.ScheduledJob[]> {
    return this.db.select()
      .from(schema.scheduledJobs)
      .where(eq(schema.scheduledJobs.status, 'active'))
      .orderBy(asc(schema.scheduledJobs.nextRunAt));
  }
}

/**
 * Create a jobs repository instance
 */
export function createJobsRepository(db: Database): JobsRepository {
  return new JobsRepository(db);
}
