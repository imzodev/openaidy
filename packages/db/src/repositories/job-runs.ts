import { eq, and, desc } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../schema/jobs';
import * as sessionSchema from '../schema/sessions';

// Combine schemas for the database type
type CombinedSchema = typeof schema & typeof sessionSchema;
type Database = NodePgDatabase<CombinedSchema>;

/**
 * Job runs repository
 * 
 * Provides data access methods for job execution history.
 */
export class JobRunsRepository {
  constructor(private readonly db: Database) {}

  /**
   * Create a new job run
   */
  async create(input: {
    jobId: string;
    status: schema.JobRunStatus;
    attemptNumber: number;
  }): Promise<schema.JobRun> {
    const [run] = await this.db.insert(schema.jobRuns).values({
      jobId: input.jobId,
      status: input.status,
      attemptNumber: input.attemptNumber,
      startedAt: null,
      finishedAt: null,
      errorCode: null,
      errorMessage: null,
      resultData: null,
      createdAt: new Date(),
    }).returning();

    return run!;
  }

  /**
   * Find run by ID
   */
  async findById(id: string): Promise<schema.JobRun | null> {
    const results = await this.db.select()
      .from(schema.jobRuns)
      .where(eq(schema.jobRuns.id, id))
      .limit(1);
    return results[0] ?? null;
  }

  /**
   * List runs for a specific job
   */
  async listByJob(jobId: string, options?: {
    limit?: number;
    offset?: number;
  }): Promise<schema.JobRun[]> {
    const query = this.db.select()
      .from(schema.jobRuns)
      .where(eq(schema.jobRuns.jobId, jobId))
      .orderBy(desc(schema.jobRuns.createdAt));

    if (options?.limit) {
      query.limit(options.limit);
    }
    if (options?.offset) {
      query.offset(options.offset);
    }

    return query;
  }

  /**
   * Update run status and metadata
   */
  async updateStatus(id: string, updates: {
    status: 'running' | 'succeeded' | 'failed';
    startedAt?: Date;
    finishedAt?: Date;
    errorCode?: string;
    errorMessage?: string;
    resultData?: Record<string, unknown>;
  }): Promise<schema.JobRun> {
    const [run] = await this.db.update(schema.jobRuns)
      .set(updates)
      .where(eq(schema.jobRuns.id, id))
      .returning();

    return run!;
  }

  /**
   * Get latest run for a job
   */
  async getLatestByJob(jobId: string): Promise<schema.JobRun | null> {
    const results = await this.db.select()
      .from(schema.jobRuns)
      .where(eq(schema.jobRuns.jobId, jobId))
      .orderBy(desc(schema.jobRuns.createdAt))
      .limit(1);
    return results[0] ?? null;
  }

  /**
   * Count runs by job and status
   */
  async countByJobAndStatus(jobId: string, status: schema.JobRunStatus): Promise<number> {
    const results = await this.db
      .select()
      .from(schema.jobRuns)
      .where(
        and(
          eq(schema.jobRuns.jobId, jobId),
          eq(schema.jobRuns.status, status)
        )
      );

    return results.length;
  }

  /**
   * List runs by status
   */
  async listByStatus(status: schema.JobRunStatus, options?: {
    limit?: number;
    offset?: number;
  }): Promise<schema.JobRun[]> {
    const query = this.db.select()
      .from(schema.jobRuns)
      .where(eq(schema.jobRuns.status, status))
      .orderBy(desc(schema.jobRuns.createdAt));

    if (options?.limit) {
      query.limit(options.limit);
    }
    if (options?.offset) {
      query.offset(options.offset);
    }

    return query;
  }

  /**
   * Delete all runs for a job (usually handled by cascade)
   */
  async deleteByJob(jobId: string): Promise<void> {
    await this.db.delete(schema.jobRuns)
      .where(eq(schema.jobRuns.jobId, jobId));
  }
}

/**
 * Create a job runs repository instance
 */
export function createJobRunsRepository(db: Database): JobRunsRepository {
  return new JobRunsRepository(db);
}
