import { eq, and, desc, lt, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseClient } from '../client';
import * as schema from '../schema/sessions';

type Database = DatabaseClient;

/**
 * Session messages repository
 * 
 * Provides data access methods for session message records.
 * Uses append-only semantics with deterministic ordering.
 */
export class SessionMessagesRepository {
  constructor(private readonly db: Database) {}

  /**
   * Append a message to a session
   * 
   * Automatically assigns the next sequence number for deterministic ordering.
   */
  async append(input: {
    sessionId: string;
    role: schema.MessageRole;
    content: string;
    toolCallId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<schema.SessionMessage> {
    // Get the next sequence number for this session
    const nextSequence = await this.getNextSequence(input.sessionId);

    const [message] = await this.db.insert(schema.sessionMessages).values({
      id: nanoid(),
      sessionId: input.sessionId,
      role: input.role,
      content: input.content,
      toolCallId: input.toolCallId,
      sequence: nextSequence,
      metadata: input.metadata,
      createdAt: new Date(),
    }).returning();

    return message!;
  }

  /**
   * Get the next sequence number for a session
   */
  private async getNextSequence(sessionId: string): Promise<number> {
    // Use a subquery to get the max sequence for this session
    const result = await this.db
      .select({ maxSeq: sql<number>`COALESCE(MAX(${schema.sessionMessages.sequence}), 0)` })
      .from(schema.sessionMessages)
      .where(eq(schema.sessionMessages.sessionId, sessionId));

    const maxSeq = result[0]?.maxSeq ?? 0;
    return Number(maxSeq) + 1;
  }

  /**
   * List all messages for a session in chronological order
   */
  async listBySession(sessionId: string): Promise<schema.SessionMessage[]> {
    return this.db.select()
      .from(schema.sessionMessages)
      .where(eq(schema.sessionMessages.sessionId, sessionId))
      .orderBy(schema.sessionMessages.sequence);
  }

  /**
   * List messages for a session with pagination
   */
  async listBySessionPaginated(
    sessionId: string,
    options: { limit?: number; beforeSequence?: number } = {}
  ): Promise<schema.SessionMessage[]> {
    const { limit = 50, beforeSequence } = options;

    if (beforeSequence !== undefined) {
      return this.db.select()
        .from(schema.sessionMessages)
        .where(
          and(
            eq(schema.sessionMessages.sessionId, sessionId),
            lt(schema.sessionMessages.sequence, beforeSequence)
          )
        )
        .orderBy(desc(schema.sessionMessages.sequence))
        .limit(limit);
    }

    return this.db.select()
      .from(schema.sessionMessages)
      .where(eq(schema.sessionMessages.sessionId, sessionId))
      .orderBy(desc(schema.sessionMessages.sequence))
      .limit(limit);
  }

  /**
   * Find a specific message by ID
   */
  async findById(id: string): Promise<schema.SessionMessage | null> {
    const results = await this.db.select()
      .from(schema.sessionMessages)
      .where(eq(schema.sessionMessages.id, id))
      .limit(1);

    return results[0] ?? null;
  }

  /**
   * Get the latest message for a session
   */
  async getLatest(sessionId: string): Promise<schema.SessionMessage | null> {
    const results = await this.db.select()
      .from(schema.sessionMessages)
      .where(eq(schema.sessionMessages.sessionId, sessionId))
      .orderBy(desc(schema.sessionMessages.sequence))
      .limit(1);

    return results[0] ?? null;
  }

  /**
   * Count messages for a session
   */
  async countBySession(sessionId: string): Promise<number> {
    const result = await this.db
      .select({ count: sql<number>`COUNT(*)` })
      .from(schema.sessionMessages)
      .where(eq(schema.sessionMessages.sessionId, sessionId));

    return Number(result[0]?.count ?? 0);
  }
}

/**
 * Create a session messages repository instance
 */
export function createSessionMessagesRepository(db: Database): SessionMessagesRepository {
  return new SessionMessagesRepository(db);
}
