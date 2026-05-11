import { randomUUID } from 'node:crypto';
import type { DatabaseClient } from '../client';
import type {
  Memory,
  CreateMemoryInput,
  MemorySearchResult,
} from '@openaidy/shared-types';

/**
 * Helper to access raw better-sqlite3 instance from a Drizzle client.
 */
function getRawSqlite(db: DatabaseClient) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (db as any).session?.client ?? (db as any).driver;
}

export class MemoriesRepository {
  constructor(private readonly db: DatabaseClient) {}

  async create(
    input: CreateMemoryInput & { agentId: string },
  ): Promise<Memory> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const tags = input.tags ?? [];
    const importance = input.importance ?? 3;

    const sqlite = getRawSqlite(this.db);
    sqlite
      .prepare(
        `INSERT INTO memories (id, agent_id, title, content, tags, importance, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.agentId,
        input.title,
        input.content,
        JSON.stringify(tags),
        importance,
        now,
        now,
      );

    return {
      id,
      agentId: input.agentId,
      title: input.title,
      content: input.content,
      tags,
      importance,
      createdAt: now,
      updatedAt: now,
    };
  }

  async search(
    query: string,
    agentId?: string,
    limit = 10,
  ): Promise<MemorySearchResult[]> {
    const sqlite = getRawSqlite(this.db);
    const rows = sqlite
      .prepare(
        `SELECT m.id, m.agent_id, m.title, m.content, m.tags, m.importance,
                m.created_at, m.updated_at, fts.rank
         FROM memories_fts fts
         JOIN memories m ON m.rowid = fts.rowid
         WHERE memories_fts MATCH ?
           AND (? IS NULL OR m.agent_id = ?)
         ORDER BY fts.rank
         LIMIT ?`,
      )
      .all(query, agentId ?? null, agentId ?? null, limit) as {
      id: string;
      agent_id: string;
      title: string;
      content: string;
      tags: string;
      importance: number;
      created_at: string;
      updated_at: string;
      rank: number;
    }[];

    return rows.map((row) => ({
      id: row.id,
      agentId: row.agent_id,
      title: row.title,
      content: row.content,
      tags: JSON.parse(row.tags) as string[],
      importance: row.importance,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      rank: row.rank,
    }));
  }

  async list(agentId?: string, limit = 50): Promise<Memory[]> {
    const sqlite = getRawSqlite(this.db);
    const rows = agentId
      ? (sqlite
          .prepare(
            `SELECT id, agent_id, title, content, tags, importance, created_at, updated_at
             FROM memories
             WHERE agent_id = ?
             ORDER BY importance DESC, created_at DESC
             LIMIT ?`,
          )
          .all(agentId, limit) as {
          id: string;
          agent_id: string;
          title: string;
          content: string;
          tags: string;
          importance: number;
          created_at: string;
          updated_at: string;
        }[])
      : (sqlite
          .prepare(
            `SELECT id, agent_id, title, content, tags, importance, created_at, updated_at
             FROM memories
             ORDER BY importance DESC, created_at DESC
             LIMIT ?`,
          )
          .all(limit) as {
          id: string;
          agent_id: string;
          title: string;
          content: string;
          tags: string;
          importance: number;
          created_at: string;
          updated_at: string;
        }[]);

    return rows.map((row) => ({
      id: row.id,
      agentId: row.agent_id,
      title: row.title,
      content: row.content,
      tags: JSON.parse(row.tags) as string[],
      importance: row.importance,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async delete(id: string, agentId?: string): Promise<boolean> {
    const sqlite = getRawSqlite(this.db);
    const result = agentId
      ? sqlite
          .prepare(`DELETE FROM memories WHERE id = ? AND agent_id = ?`)
          .run(id, agentId)
      : sqlite.prepare(`DELETE FROM memories WHERE id = ?`).run(id);
    return result.changes > 0;
  }
}

export function createMemoriesRepository(
  db: DatabaseClient,
): MemoriesRepository {
  return new MemoriesRepository(db);
}
