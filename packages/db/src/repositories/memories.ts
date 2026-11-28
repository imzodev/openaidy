import { randomUUID } from 'node:crypto';
import type { DatabaseClient } from '../client';
import {
  OWNER_MEMORY_AGENT_ID,
  type Memory,
  type MemoryKind,
  type MemorySource,
  type CreateMemoryInput,
  type UpdateMemoryInput,
  type MemorySearchResult,
  type MemoryRow,
} from '@aidyagent/shared-types';

/**
 * Helper to access the raw sqlite instance from a Drizzle client.
 */
function getRawSqlite(db: DatabaseClient) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (db as any).session?.client ?? (db as any).driver;
}

const COLUMNS = `id, agent_id, title, content, tags, importance, source, kind,
  source_session_id, created_at, updated_at`;

function toMemory(row: MemoryRow): Memory {
  return {
    id: row.id,
    agentId: row.agent_id,
    title: row.title,
    content: row.content,
    tags: JSON.parse(row.tags) as string[],
    importance: row.importance,
    source: row.source as MemorySource,
    kind: (row.kind as MemoryKind | null) ?? null,
    sourceSessionId: row.source_session_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class MemoriesRepository {
  constructor(private readonly db: DatabaseClient) {}

  async create(
    input: CreateMemoryInput & { agentId: string },
  ): Promise<Memory> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const memory: Memory = {
      id,
      agentId: input.agentId,
      title: input.title,
      content: input.content,
      tags: input.tags ?? [],
      importance: input.importance ?? 3,
      source: input.source ?? 'agent',
      kind: input.kind ?? null,
      sourceSessionId: input.sourceSessionId ?? null,
      createdAt: now,
      updatedAt: now,
    };

    getRawSqlite(this.db)
      .prepare(
        `INSERT INTO memories (${COLUMNS})
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        memory.id,
        memory.agentId,
        memory.title,
        memory.content,
        JSON.stringify(memory.tags),
        memory.importance,
        memory.source,
        memory.kind,
        memory.sourceSessionId,
        now,
        now,
      );

    return memory;
  }

  /**
   * Full-text search. With `agentId`, results cover that agent's own
   * memories; without it, every agent's. What is known about the owner is
   * included unless `includeOwner` is false (a customer conversation).
   */
  async search(
    query: string,
    agentId?: string,
    limit = 10,
    includeOwner = true,
  ): Promise<MemorySearchResult[]> {
    const owner = includeOwner ? 1 : 0;
    const rows = getRawSqlite(this.db)
      .prepare(
        `SELECT m.id, m.agent_id, m.title, m.content, m.tags, m.importance,
                m.source, m.kind, m.source_session_id,
                m.created_at, m.updated_at, fts.rank
         FROM memories_fts fts
         JOIN memories m ON m.rowid = fts.rowid
         WHERE memories_fts MATCH ?
           AND (
             (m.agent_id = ? AND ? = 1)
             OR (m.agent_id != ? AND (? IS NULL OR m.agent_id = ?))
           )
         ORDER BY fts.rank
         LIMIT ?`,
      )
      .all(
        query,
        OWNER_MEMORY_AGENT_ID,
        owner,
        OWNER_MEMORY_AGENT_ID,
        agentId ?? null,
        agentId ?? null,
        limit,
      ) as (MemoryRow & { rank: number })[];

    return rows.map((row) => ({ ...toMemory(row), rank: row.rank }));
  }

  async list(agentId?: string, limit = 50): Promise<Memory[]> {
    const sqlite = getRawSqlite(this.db);
    const rows = agentId
      ? (sqlite
          .prepare(
            `SELECT ${COLUMNS} FROM memories
             WHERE agent_id = ?
             ORDER BY importance DESC, created_at DESC
             LIMIT ?`,
          )
          .all(agentId, limit) as MemoryRow[])
      : (sqlite
          .prepare(
            `SELECT ${COLUMNS} FROM memories
             ORDER BY importance DESC, created_at DESC
             LIMIT ?`,
          )
          .all(limit) as MemoryRow[]);

    return rows.map(toMemory);
  }

  /**
   * What is known about the owner, most important and most recently
   * confirmed first — the order the prompt block wants.
   */
  async listOwner(limit = 100): Promise<Memory[]> {
    const rows = getRawSqlite(this.db)
      .prepare(
        `SELECT ${COLUMNS} FROM memories
         WHERE agent_id = ?
         ORDER BY importance DESC, updated_at DESC
         LIMIT ?`,
      )
      .all(OWNER_MEMORY_AGENT_ID, limit) as MemoryRow[];
    return rows.map(toMemory);
  }

  async findById(id: string): Promise<Memory | null> {
    const rows = getRawSqlite(this.db)
      .prepare(`SELECT ${COLUMNS} FROM memories WHERE id = ?`)
      .all(id) as MemoryRow[];
    const row = rows[0];
    return row ? toMemory(row) : null;
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
    if (patch.kind !== undefined) {
      sets.push('kind = ?');
      values.push(patch.kind);
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
    return this.findById(id);
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

  /** Delete every memory of `agentId` written by `source`; returns how many. */
  async deleteBySource(agentId: string, source: MemorySource): Promise<number> {
    const result = getRawSqlite(this.db)
      .prepare(`DELETE FROM memories WHERE agent_id = ? AND source = ?`)
      .run(agentId, source);
    return Number(result.changes);
  }
}

export function createMemoriesRepository(
  db: DatabaseClient,
): MemoriesRepository {
  return new MemoriesRepository(db);
}
