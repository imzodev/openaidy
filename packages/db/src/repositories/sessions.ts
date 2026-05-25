import { eq, desc } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseClient } from '../client';
import * as schema from '../schema/sessions';

type Database = DatabaseClient;

/**
 * Helper to access raw better-sqlite3 instance from a Drizzle client.
 */
function getRawSqlite(db: DatabaseClient) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (db as any).session?.client ?? (db as any).driver;
}

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
    const [session] = await this.db
      .insert(schema.sessions)
      .values({
        id: nanoid(),
        title: input.title,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return session!;
  }

  /**
   * Find a session by ID
   */
  async findById(id: string): Promise<schema.Session | null> {
    const results = await this.db
      .select()
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
      return this.db
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.status, status))
        .orderBy(desc(schema.sessions.createdAt));
    }
    return this.db
      .select()
      .from(schema.sessions)
      .orderBy(desc(schema.sessions.createdAt));
  }

  /**
   * Update a session's title
   */
  async updateTitle(id: string, title: string): Promise<schema.Session | null> {
    const results = await this.db
      .update(schema.sessions)
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
  async updateStatus(
    id: string,
    status: schema.SessionStatus,
  ): Promise<schema.Session | null> {
    const now = new Date();
    const updates: Partial<schema.Session> = {
      status,
      updatedAt: now,
    };

    if (status === 'archived') {
      updates.archivedAt = now;
    }

    const results = await this.db
      .update(schema.sessions)
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

  /**
   * Full-text search sessions by title using FTS5.
   * Returns sessions ordered by BM25 relevance rank (best match first).
   */
  async searchByTitle(query: string, limit = 5): Promise<schema.Session[]> {
    const sqlite = getRawSqlite(this.db);
    const rows = sqlite
      .prepare(
        `SELECT s.id, s.title, s.status, s.created_at, s.updated_at, s.archived_at
         FROM sessions_fts fts
         JOIN sessions s ON s.rowid = fts.rowid
         WHERE sessions_fts MATCH ?
         ORDER BY fts.rank
         LIMIT ?`,
      )
      .all(query, limit) as {
      id: string;
      title: string;
      status: string;
      created_at: string;
      updated_at: string;
      archived_at: string | null;
    }[];

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status as schema.SessionStatus,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      archivedAt: row.archived_at ? new Date(row.archived_at) : null,
    }));
  }

  /**
   * Backfill sessions_fts FTS5 index for any sessions created before
   * the FTS system was implemented. Safe to call multiple times.
   */
  async backfillFtsIndex(): Promise<{ indexed: number }> {
    const sqlite = getRawSqlite(this.db);

    const result = sqlite
      .prepare(
        `INSERT INTO sessions_fts(rowid, title)
         SELECT rowid, title FROM sessions
         WHERE rowid NOT IN (SELECT rowid FROM sessions_fts)`,
      )
      .run();

    // Rebuild FTS5 index if needed (fixes corruption issues with WAL mode)
    if (result.changes > 0) {
      sqlite
        .prepare("INSERT INTO sessions_fts(sessions_fts) VALUES('rebuild')")
        .run();
    }

    return { indexed: result.changes };
  }
}

/**
 * Create a sessions repository instance
 */
export function createSessionsRepository(db: Database): SessionsRepository {
  return new SessionsRepository(db);
}
