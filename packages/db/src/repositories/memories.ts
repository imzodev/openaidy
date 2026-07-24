import { randomUUID } from 'node:crypto';
import type { DatabaseClient } from '../client';
import type {
  Memory,
  CreateMemoryInput,
  UpdateMemoryInput,
  MemorySearchResult,
} from '@openaidy/shared-types';

/**
 * Helper to access the raw sqlite instance from a Drizzle client.
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

  /**
   * Update an existing memory. Only the fields present in `patch` are changed;
   * `updated_at` is always refreshed. When `agentId` is provided the update is
   * scoped to that owner (a mismatch updates nothing). Returns the updated
   * Memory, or null when no matching row exists.
   */
  async update(
    id: string,
    patch: UpdateMemoryInput,
    agentId?: string,
  ): Promise<Memory | null> {
    const sqlite = getRawSqlite(this.db);

    const sets: string[] = [];
    const values: unknown[] = [];
    if (patch.title !== undefined) {
      sets.push('title = ?');
      values.push(patch.title);
    }
    if (patch.content !== undefined) {
      sets.push('content = ?');
      values.push(patch.content);
    }
    if (patch.tags !== undefined) {
      sets.push('tags = ?');
      values.push(JSON.stringify(patch.tags));
    }
    if (patch.importance !== undefined) {
      sets.push('importance = ?');
      values.push(patch.importance);
    }
    // updated_at always bumps, so `sets` is never empty.
    const now = new Date().toISOString();
    sets.push('updated_at = ?');
    values.push(now);

    values.push(id);
    if (agentId) values.push(agentId);

    const result = sqlite
      .prepare(
        `UPDATE memories SET ${sets.join(', ')}
         WHERE id = ?${agentId ? ' AND agent_id = ?' : ''}`,
      )
      .run(...values);

    if (result.changes === 0) return null;

    const rows = sqlite
      .prepare(
        `SELECT id, agent_id, title, content, tags, importance, created_at, updated_at
         FROM memories WHERE id = ?`,
      )
      .all(id) as {
      id: string;
      agent_id: string;
      title: string;
      content: string;
      tags: string;
      importance: number;
      created_at: string;
      updated_at: string;
    }[];

    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      agentId: row.agent_id,
      title: row.title,
      content: row.content,
      tags: JSON.parse(row.tags) as string[],
      importance: row.importance,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Count memories grouped by agent. Returns a map of agentId → count;
   * agents with no memories are simply absent from the map.
   */
  async countByAgent(): Promise<Record<string, number>> {
    const sqlite = getRawSqlite(this.db);
    const rows = sqlite
      .prepare(`SELECT agent_id, COUNT(*) AS n FROM memories GROUP BY agent_id`)
      .all() as { agent_id: string; n: number }[];

    const counts: Record<string, number> = {};
    for (const row of rows) {
      counts[row.agent_id] = row.n;
    }
    return counts;
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
