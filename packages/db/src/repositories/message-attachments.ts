import { eq, and, isNull, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseClient } from '../client';
import * as schema from '../schema/sessions';

type Database = DatabaseClient;

/**
 * Message attachments repository
 *
 * Metadata for image/audio media attached to session messages. Bytes live
 * on local disk (see `storagePath`); rows start unlinked (`messageId` null)
 * for user uploads and are linked to the message at submit time.
 */
export class MessageAttachmentsRepository {
  constructor(private readonly db: Database) {}

  async create(input: {
    sessionId: string;
    messageId?: string;
    kind: schema.AttachmentKind;
    source: schema.AttachmentSource;
    name?: string;
    mimeType: string;
    sizeBytes: number;
    storagePath: string;
  }): Promise<schema.MessageAttachment> {
    const [attachment] = await this.db
      .insert(schema.messageAttachments)
      .values({
        id: nanoid(),
        sessionId: input.sessionId,
        messageId: input.messageId ?? null,
        kind: input.kind,
        source: input.source,
        name: input.name ?? null,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        storagePath: input.storagePath,
        createdAt: new Date(),
      })
      .returning();

    return attachment!;
  }

  async findById(id: string): Promise<schema.MessageAttachment | null> {
    const results = await this.db
      .select()
      .from(schema.messageAttachments)
      .where(eq(schema.messageAttachments.id, id))
      .limit(1);

    return results[0] ?? null;
  }

  /**
   * Link unlinked (pending) attachments to a persisted message. Only rows
   * that belong to the given session and have no message yet are updated,
   * so an attachment can never be re-linked or claimed across sessions.
   * Returns the linked rows.
   */
  async linkToMessage(input: {
    attachmentIds: string[];
    sessionId: string;
    messageId: string;
  }): Promise<schema.MessageAttachment[]> {
    if (input.attachmentIds.length === 0) return [];

    return this.db
      .update(schema.messageAttachments)
      .set({ messageId: input.messageId })
      .where(
        and(
          inArray(schema.messageAttachments.id, input.attachmentIds),
          eq(schema.messageAttachments.sessionId, input.sessionId),
          isNull(schema.messageAttachments.messageId),
        ),
      )
      .returning();
  }

  /** List all linked attachments for a session (chronological). */
  async listBySession(sessionId: string): Promise<schema.MessageAttachment[]> {
    return this.db
      .select()
      .from(schema.messageAttachments)
      .where(eq(schema.messageAttachments.sessionId, sessionId))
      .orderBy(schema.messageAttachments.createdAt);
  }

  async listByMessage(messageId: string): Promise<schema.MessageAttachment[]> {
    return this.db
      .select()
      .from(schema.messageAttachments)
      .where(eq(schema.messageAttachments.messageId, messageId))
      .orderBy(schema.messageAttachments.createdAt);
  }

  async delete(id: string): Promise<boolean> {
    const results = await this.db
      .delete(schema.messageAttachments)
      .where(eq(schema.messageAttachments.id, id))
      .returning();
    return results.length > 0;
  }
}

/**
 * Create a message attachments repository instance
 */
export function createMessageAttachmentsRepository(
  db: Database,
): MessageAttachmentsRepository {
  return new MessageAttachmentsRepository(db);
}
