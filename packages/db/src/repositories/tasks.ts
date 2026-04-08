import { eq, desc, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseClient } from '../client';
import * as schema from '../schema/tasks';

type Database = DatabaseClient;

/**
 * Tasks repository
 *
 * Provides data access methods for task records.
 */
export class TasksRepository {
  constructor(private readonly db: Database) {}

  /**
   * Create a new task
   */
  async create(input: {
    title: string;
    description: string;
    priority?: schema.TaskPriority;
    planningEnabled?: boolean;
  }): Promise<schema.Task> {
    const now = new Date();
    const [task] = await this.db.insert(schema.tasks).values({
      id: nanoid(),
      title: input.title,
      description: input.description,
      status: 'backlog',
      priority: input.priority ?? 'medium',
      planningEnabled: input.planningEnabled ?? false,
      planningStatus: input.planningEnabled ? 'pending' : null,
      createdAt: now,
      updatedAt: now,
    }).returning();

    return task!;
  }

  /**
   * Find a task by ID
   */
  async findById(id: string): Promise<schema.Task | null> {
    const results = await this.db.select()
      .from(schema.tasks)
      .where(eq(schema.tasks.id, id))
      .limit(1);
    return results[0] ?? null;
  }

  /**
   * List all tasks, optionally filtered by status
   */
  async list(status?: schema.TaskStatus): Promise<schema.Task[]> {
    if (status) {
      return this.db.select()
        .from(schema.tasks)
        .where(eq(schema.tasks.status, status))
        .orderBy(desc(schema.tasks.createdAt));
    }
    return this.db.select()
      .from(schema.tasks)
      .orderBy(desc(schema.tasks.createdAt));
  }

  /**
   * List tasks by multiple statuses (for Kanban board)
   */
  async listByStatuses(statuses: schema.TaskStatus[]): Promise<schema.Task[]> {
    if (statuses.length === 0) {
      return this.list();
    }
    return this.db.select()
      .from(schema.tasks)
      .where(inArray(schema.tasks.status, statuses))
      .orderBy(desc(schema.tasks.createdAt));
  }

  /**
   * Update a task
   */
  async update(
    id: string,
    input: {
      title?: string;
      description?: string;
      priority?: schema.TaskPriority;
      planningEnabled?: boolean;
      sessionId?: string | null;
    }
  ): Promise<schema.Task | null> {
    const results = await this.db.update(schema.tasks)
      .set({
        ...input,
        updatedAt: new Date(),
      })
      .where(eq(schema.tasks.id, id))
      .returning();

    return results[0] ?? null;
  }

  /**
   * Update a task's status
   */
  async updateStatus(id: string, status: schema.TaskStatus): Promise<schema.Task | null> {
    const results = await this.db.update(schema.tasks)
      .set({
        status,
        updatedAt: new Date(),
      })
      .where(eq(schema.tasks.id, id))
      .returning();

    return results[0] ?? null;
  }

  /**
   * Update a task's planning status
   */
  async updatePlanningStatus(
    id: string,
    planningStatus: schema.PlanningStatus
  ): Promise<schema.Task | null> {
    const results = await this.db.update(schema.tasks)
      .set({
        planningStatus,
        updatedAt: new Date(),
      })
      .where(eq(schema.tasks.id, id))
      .returning();

    return results[0] ?? null;
  }

  /**
   * Delete a task
   */
  async delete(id: string): Promise<schema.Task | null> {
    const results = await this.db.delete(schema.tasks)
      .where(eq(schema.tasks.id, id))
      .returning();

    return results[0] ?? null;
  }
}

/**
 * Create a tasks repository instance
 */
export function createTasksRepository(db: Database): TasksRepository {
  return new TasksRepository(db);
}
