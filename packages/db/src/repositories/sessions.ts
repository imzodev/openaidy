import { eq, desc } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseClient } from '../client';
import * as schema from '../schema/sessions';

type Database = DatabaseClient;

/**
 * Sessions repository
 * 
 * Provides data access methods for session records.
 */
export class SessionsRepository {
  constructor(private readonly db: Database) {}

  /**
   * Create a new session
   */
  async create(input: { title: string }): Promise<schema.Session> {
    const now = new Date();
    const [session] = await this.db.insert(schema.sessions).values({
      id: nanoid(),
      title: input.title,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    }).returning();

    return session!;
  }

  /**
   * Find a session by ID
   */
  async findById(id: string): Promise<schema.Session | null> {
    const results = await this.db.select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, id))
      .limit(1);
    return results[0] ?? null;
  }

  /**
   * List all sessions, optionally filtered by status
   */
  async list(status?: schema.SessionStatus): Promise<schema.Session[]> {
    if (status) {
      return this.db.select()
        .from(schema.sessions)
        .where(eq(schema.sessions.status, status))
        .orderBy(desc(schema.sessions.createdAt));
    }
    return this.db.select()
      .from(schema.sessions)
      .orderBy(desc(schema.sessions.createdAt));
  }

  /**
   * Update a session's title
   */
  async updateTitle(id: string, title: string): Promise<schema.Session | null> {
    const results = await this.db.update(schema.sessions)
      .set({
        title,
        updatedAt: new Date(),
      })
      .where(eq(schema.sessions.id, id))
      .returning();

    return results[0] ?? null;
  }

  /**
   * Update a session's status
   */
  async updateStatus(id: string, status: schema.SessionStatus): Promise<schema.Session | null> {
    const now = new Date();
    const updates: Partial<schema.Session> = {
      status,
      updatedAt: now,
    };

    if (status === 'archived') {
      updates.archivedAt = now;
    }

    const results = await this.db.update(schema.sessions)
      .set(updates)
      .where(eq(schema.sessions.id, id))
      .returning();

    return results[0] ?? null;
  }

  /**
   * Delete a session (soft delete by setting status to 'deleted')
   */
  async delete(id: string): Promise<schema.Session | null> {
    return this.updateStatus(id, 'deleted');
  }
}

/**
 * Create a sessions repository instance
 */
export function createSessionsRepository(db: Database): SessionsRepository {
  return new SessionsRepository(db);
}
