import { eq } from 'drizzle-orm';
import type { DatabaseClient } from '../client';
import * as schema from '../schema/sessions';

/**
 * Session → channel chat routes (see `sessionChannels`). One row per
 * session, replaced on every inbound message so it always points at the
 * chat the conversation last came from.
 */
export class SessionChannelsRepository {
  constructor(private readonly db: DatabaseClient) {}

  async record(input: {
    sessionId: string;
    channelId: string;
    channelType: string;
    target: string;
    senderId: string;
  }): Promise<void> {
    const row = { ...input, updatedAt: new Date() };
    await this.db
      .insert(schema.sessionChannels)
      .values(row)
      .onConflictDoUpdate({
        target: schema.sessionChannels.sessionId,
        set: {
          channelId: row.channelId,
          channelType: row.channelType,
          target: row.target,
          senderId: row.senderId,
          updatedAt: row.updatedAt,
        },
      });
  }

  async find(sessionId: string): Promise<schema.SessionChannel | null> {
    const rows = await this.db
      .select()
      .from(schema.sessionChannels)
      .where(eq(schema.sessionChannels.sessionId, sessionId))
      .limit(1);
    return rows[0] ?? null;
  }
}

export function createSessionChannelsRepository(
  db: DatabaseClient,
): SessionChannelsRepository {
  return new SessionChannelsRepository(db);
}
