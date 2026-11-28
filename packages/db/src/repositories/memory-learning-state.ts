import type { DatabaseClient } from '../client';
import type {
  MemoryLearningCandidate,
  MemoryLearningCursor,
  MemoryLearningCandidateRow,
  MemoryLearningStateRow,
} from '@aidyagent/shared-types';

function getRawSqlite(db: DatabaseClient) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (db as any).session?.client ?? (db as any).driver;
}

/**
 * How far background memory learning has read each conversation, so a
 * session's turns are learned from once even across restarts.
 */
export class MemoryLearningStateRepository {
  constructor(private readonly db: DatabaseClient) {}

  async getCursor(sessionId: string): Promise<MemoryLearningCursor | null> {
    const rows = getRawSqlite(this.db)
      .prepare(
        `SELECT session_id, through_sequence, updated_at
         FROM memory_learning_state WHERE session_id = ?`,
      )
      .all(sessionId) as MemoryLearningStateRow[];
    const row = rows[0];
    return row
      ? {
          sessionId: row.session_id,
          throughSequence: row.through_sequence,
          updatedAt: row.updated_at,
        }
      : null;
  }

  async setCursor(sessionId: string, throughSequence: number): Promise<void> {
    getRawSqlite(this.db)
      .prepare(
        `INSERT INTO memory_learning_state (session_id, through_sequence, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           through_sequence = excluded.through_sequence,
           updated_at = excluded.updated_at`,
      )
      .run(sessionId, throughSequence, new Date().toISOString());
  }

  /**
   * Active chat sessions whose last user message is between `activeAfter`
   * and `idleBefore` (ISO timestamps) and that have messages past their
   * cursor. Oldest first, so a backlog drains in order.
   */
  async findCandidates(params: {
    idleBefore: string;
    activeAfter: string;
    limit: number;
  }): Promise<MemoryLearningCandidate[]> {
    const rows = getRawSqlite(this.db)
      .prepare(
        `SELECT s.id AS session_id, s.agent_id,
                COALESCE(st.through_sequence, -1) AS through_sequence,
                m.last_sequence, m.last_user_at
         FROM sessions s
         JOIN (
           SELECT session_id,
                  MAX(sequence) AS last_sequence,
                  MAX(CASE WHEN role = 'user' THEN created_at END) AS last_user_at
           FROM session_messages
           WHERE created_at > ?
           GROUP BY session_id
         ) m ON m.session_id = s.id
         LEFT JOIN memory_learning_state st ON st.session_id = s.id
         WHERE s.type = 'chat'
           AND s.status = 'active'
           AND m.last_user_at IS NOT NULL
           AND m.last_user_at < ?
           AND m.last_user_at > ?
           AND m.last_sequence > COALESCE(st.through_sequence, -1)
         ORDER BY m.last_user_at ASC
         LIMIT ?`,
      )
      .all(
        params.activeAfter,
        params.idleBefore,
        params.activeAfter,
        params.limit,
      ) as MemoryLearningCandidateRow[];

    return rows.map((row) => ({
      sessionId: row.session_id,
      agentId: row.agent_id,
      throughSequence: row.through_sequence,
      lastSequence: row.last_sequence,
    }));
  }
}

export function createMemoryLearningStateRepository(
  db: DatabaseClient,
): MemoryLearningStateRepository {
  return new MemoryLearningStateRepository(db);
}
