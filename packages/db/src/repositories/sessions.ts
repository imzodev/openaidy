import { eq, desc } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseClient } from '../client';
import * as schema from '../schema/sessions';
import type { SessionSearchResult } from '../types/index.js';

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
  async create(input: {
    title: string;
    type?: 'chat' | 'task' | 'subtask';
  }): Promise<schema.Session> {
    const now = new Date();
    const [session] = await this.db
      .insert(schema.sessions)
      .values({
        id: nanoid(),
        title: input.title,
        type: input.type ?? 'chat',
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
   * Update a session's agent ID
   */
  async updateAgentId(
    id: string,
    agentId: string,
  ): Promise<schema.Session | null> {
    const results = await this.db
      .update(schema.sessions)
      .set({
        agentId,
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
  async searchByTitle(
    query: string,
    limit = 5,
    excludeSessionId?: string,
  ): Promise<SessionSearchResult[]> {
    const sqlite = getRawSqlite(this.db);
    const rows = sqlite
      .prepare(
        `SELECT s.id, s.title, s.status, s.created_at, s.updated_at, s.archived_at,
                fts.rank
         FROM sessions_fts fts
         JOIN sessions s ON s.rowid = fts.rowid
         WHERE sessions_fts MATCH ?
         ${excludeSessionId ? 'AND s.id != ?' : ''}
         ORDER BY fts.rank
         LIMIT ?`,
      )
      .all(
        ...(excludeSessionId
          ? [query, excludeSessionId, limit]
          : [query, limit]),
      ) as {
      id: string;
      title: string;
      status: string;
      created_at: string;
      updated_at: string;
      archived_at: string | null;
      rank: number;
    }[];

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status as schema.SessionStatus,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      archivedAt: row.archived_at ? new Date(row.archived_at) : null,
      matchType: 'title' as const,
      rank: row.rank,
      snippet: null,
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

  /**
   * Search session messages by content using FTS5.
   *
   * Option A: Direct content search via FTS5 on session_messages.content
   * - Fast, keyword-based matching
   * - Searches all message content in a session
   *
   * Option B (TODO): LLM-generated session summaries
   * - Smaller index, more meaningful matches
   * - Would add 'summary' column to sessions table
   *
   * Option C (TODO): Embeddings-based semantic search
   * - Natural language understanding
   * - Would require sqlite-vector or pgvector extension
   *
   * Returns sessions that have messages matching the query, ordered by relevance.
   */
  async searchByContent(
    query: string,
    limit = 5,
    excludeSessionId?: string,
  ): Promise<SessionSearchResult[]> {
    const sqlite = getRawSqlite(this.db);

    // Search messages_fts for matching session_ids, grouped and ranked
    const sql = `SELECT s.id, s.title, s.status, s.created_at, s.updated_at, s.archived_at,
                COUNT(*) as match_count,
                MAX(fts.rank) as max_rank
         FROM session_messages_fts fts
         JOIN sessions s ON s.id = fts.session_id
         WHERE session_messages_fts MATCH ?
         ${excludeSessionId ? 'AND s.id != ?' : ''}
         GROUP BY s.id
         ORDER BY match_count DESC, max_rank ASC
         LIMIT ?`;
    const params = excludeSessionId
      ? [query, excludeSessionId, limit]
      : [query, limit];
    const rows = sqlite.prepare(sql).all(...params) as {
      id: string;
      title: string;
      status: string;
      created_at: string;
      updated_at: string;
      archived_at: string | null;
      match_count: number;
      max_rank: number;
    }[];

    // For each session, get a snippet of the matching content
    const results: SessionSearchResult[] = [];
    for (const row of rows) {
      const snippetRow = sqlite
        .prepare(
          `SELECT content FROM session_messages_fts
           WHERE session_messages_fts MATCH ? AND session_id = ?
           ORDER BY rank
           LIMIT 1`,
        )
        .get(query, row.id) as { content: string } | undefined;

      results.push({
        id: row.id,
        title: row.title,
        status: row.status as schema.SessionStatus,
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
        archivedAt: row.archived_at ? new Date(row.archived_at) : null,
        matchType: 'content',
        rank: row.max_rank,
        matchCount: row.match_count,
        snippet: snippetRow
          ? snippetRow.content.substring(0, 200) +
            (snippetRow.content.length > 200 ? '...' : '')
          : null,
      });
    }

    return results;
  }

  /**
   * Backfill session_messages_fts FTS5 index for any messages created before
   * the FTS system was implemented. Safe to call multiple times.
   *
   * Option A: Index actual message content (current implementation)
   * Option B (TODO): Index LLM-generated summaries instead of full content
   * Option C (TODO): Use embeddings for semantic search (requires sqlite-vector)
   */
  async backfillMessagesFtsIndex(): Promise<{ indexed: number }> {
    const sqlite = getRawSqlite(this.db);
    console.log(`================================`); // Separator for logs
    console.log(`================================`); // Separator for logs
    console.log(`Backfilling session_messages_fts index...`);

    const result = sqlite
      .prepare(
        `INSERT INTO session_messages_fts(rowid, content, session_id)
         SELECT rowid, content, session_id FROM session_messages
         WHERE rowid NOT IN (SELECT rowid FROM session_messages_fts)`,
      )
      .run();
    console.log(`Backfill complete. Indexed ${result.changes} messages.`);

    // Rebuild FTS5 index if needed (fixes corruption issues with WAL mode)
    if (result.changes > 0) {
      console.log(`Rebuilding session_messages_fts index...`);
      console.log(`Rebuild complete.`);
      sqlite
        .prepare(
          "INSERT INTO session_messages_fts(session_messages_fts) VALUES('rebuild')",
        )
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
