import { eq, asc } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseClient } from '../client';
import * as schema from '../schema/deliverables';

type Database = DatabaseClient;

/**
 * Deliverables repository
 *
 * Provides data access methods for deliverable records.
 */
export class DeliverablesRepository {
  constructor(private readonly db: Database) {}

  /**
   * Create a new deliverable
   */
  async create(input: {
    taskId: string;
    type: schema.DeliverableType;
    description: string;
    format?: string;
    size?: string;
    path?: string;
    url?: string;
    version?: string;
    metadata?: string;
  }): Promise<schema.Deliverable> {
    const now = new Date();
    const [deliverable] = await this.db
      .insert(schema.deliverables)
      .values({
        id: nanoid(),
        taskId: input.taskId,
        type: input.type,
        description: input.description,
        status: 'pending',
        format: input.format ?? null,
        size: input.size ?? null,
        path: input.path ?? null,
        url: input.url ?? null,
        version: input.version ?? null,
        metadata: input.metadata ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return deliverable!;
  }

  /**
   * Find a deliverable by ID
   */
  async findById(id: string): Promise<schema.Deliverable | null> {
    const results = await this.db
      .select()
      .from(schema.deliverables)
      .where(eq(schema.deliverables.id, id))
      .limit(1);
    return results[0] ?? null;
  }

  /**
   * Find all deliverables for a task
   */
  async findByTask(taskId: string): Promise<schema.Deliverable[]> {
    const results = await this.db
      .select()
      .from(schema.deliverables)
      .where(eq(schema.deliverables.taskId, taskId))
      .orderBy(asc(schema.deliverables.createdAt));
    return results;
  }

  /**
   * Update a deliverable
   */
  async update(
    id: string,
    input: Partial<{
      type: schema.DeliverableType;
      description: string;
      status: schema.DeliverableStatus;
      format: string;
      size: string;
      path: string;
      url: string;
      version: string;
      metadata: string;
    }>,
  ): Promise<schema.Deliverable> {
    const [deliverable] = await this.db
      .update(schema.deliverables)
      .set({
        ...input,
        updatedAt: new Date(),
      })
      .where(eq(schema.deliverables.id, id))
      .returning();

    return deliverable!;
  }

  /**
   * Delete a deliverable by ID
   */
  async delete(id: string): Promise<void> {
    await this.db
      .delete(schema.deliverables)
      .where(eq(schema.deliverables.id, id));
  }

  /**
   * Delete all deliverables for a task
   */
  async deleteByTask(taskId: string): Promise<void> {
    await this.db
      .delete(schema.deliverables)
      .where(eq(schema.deliverables.taskId, taskId));
  }
}

/**
 * Create a deliverables repository instance
 */
export function createDeliverablesRepository(
  db: Database,
): DeliverablesRepository {
  return new DeliverablesRepository(db);
}
