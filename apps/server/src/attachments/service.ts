/**
 * Attachment service
 *
 * Stores and serves image/audio media attached to session messages.
 * Bytes live on local disk under a dedicated attachments directory
 * (`<baseDir>/<sessionId>/<id>.<ext>`); only metadata goes to the DB
 * (`message_attachments` table). Tool-produced media (e.g. screenshots
 * persisted into an agent workspace) is registered here too, pointing at
 * its existing on-disk location.
 */

import { mkdir, writeFile, readFile, stat, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { nanoid } from 'nanoid';
import type {
  MessageAttachmentsStore,
  MessageAttachment,
  AttachmentKind,
} from '@openaidy/db';

/** Max upload size (decoded bytes). */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/** Allowed mime types by kind. */
const ALLOWED_MIME_TYPES: Record<AttachmentKind, readonly string[]> = {
  image: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'],
  audio: [
    'audio/wav',
    'audio/x-wav',
    'audio/mpeg',
    'audio/mp3',
    'audio/mp4',
    'audio/ogg',
    'audio/webm',
    'audio/flac',
    'audio/aac',
  ],
};

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/ogg': 'ogg',
  'audio/webm': 'webm',
  'audio/flac': 'flac',
  'audio/aac': 'aac',
};

/** Derive the attachment kind from a mime type, or null if unsupported. */
export function kindForMimeType(mimeType: string): AttachmentKind | null {
  if (ALLOWED_MIME_TYPES.image.includes(mimeType)) return 'image';
  if (ALLOWED_MIME_TYPES.audio.includes(mimeType)) return 'audio';
  return null;
}

export class AttachmentError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'UNSUPPORTED_MIME_TYPE'
      | 'FILE_TOO_LARGE'
      | 'NOT_FOUND'
      | 'WRITE_FAILED'
      | 'READ_FAILED',
  ) {
    super(message);
    this.name = 'AttachmentError';
  }
}

export type AttachmentServiceOptions = {
  repository: MessageAttachmentsStore;
  /** Directory upload bytes are written into (created on demand). */
  baseDir: string;
};

export class AttachmentService {
  private readonly repo: MessageAttachmentsStore;
  private readonly baseDir: string;

  constructor(options: AttachmentServiceOptions) {
    this.repo = options.repository;
    this.baseDir = resolve(options.baseDir);
  }

  /**
   * Store an uploaded file: validates mime type and size, writes the bytes
   * under the attachments directory, and creates an unlinked metadata row
   * (linked to the user message at submit time).
   */
  async saveUpload(input: {
    sessionId: string;
    mimeType: string;
    /** Base64-encoded bytes (no data: URI prefix). */
    data: string;
    name?: string;
  }): Promise<MessageAttachment> {
    const kind = kindForMimeType(input.mimeType);
    if (!kind) {
      throw new AttachmentError(
        `Unsupported attachment mime type: ${input.mimeType}`,
        'UNSUPPORTED_MIME_TYPE',
      );
    }

    const buffer = Buffer.from(input.data, 'base64');
    if (buffer.length === 0) {
      throw new AttachmentError('Attachment is empty', 'WRITE_FAILED');
    }
    if (buffer.length > MAX_ATTACHMENT_BYTES) {
      throw new AttachmentError(
        `Attachment exceeds the ${Math.floor(MAX_ATTACHMENT_BYTES / (1024 * 1024))}MB limit`,
        'FILE_TOO_LARGE',
      );
    }

    const id = nanoid();
    const ext = EXT_BY_MIME[input.mimeType] ?? 'bin';
    const dir = join(this.baseDir, input.sessionId);
    const storagePath = join(dir, `${id}.${ext}`);

    try {
      await mkdir(dir, { recursive: true });
      await writeFile(storagePath, buffer);
    } catch (error) {
      throw new AttachmentError(
        `Failed to store attachment: ${error instanceof Error ? error.message : String(error)}`,
        'WRITE_FAILED',
      );
    }

    return this.repo.create({
      sessionId: input.sessionId,
      kind,
      source: 'user_upload',
      ...(input.name ? { name: input.name } : {}),
      mimeType: input.mimeType,
      sizeBytes: buffer.length,
      storagePath,
    });
  }

  /**
   * Register media that already exists on disk (e.g. a screenshot a tool
   * persisted into an agent workspace) as an attachment on a message.
   */
  async registerToolOutput(input: {
    sessionId: string;
    messageId: string;
    mimeType: string;
    storagePath: string;
    name?: string;
  }): Promise<MessageAttachment | null> {
    const kind = kindForMimeType(input.mimeType);
    if (!kind) return null;

    let sizeBytes = 0;
    try {
      sizeBytes = (await stat(input.storagePath)).size;
    } catch {
      return null; // file vanished — nothing to register
    }

    return this.repo.create({
      sessionId: input.sessionId,
      messageId: input.messageId,
      kind,
      source: 'tool_output',
      ...(input.name ? { name: input.name } : {}),
      mimeType: input.mimeType,
      sizeBytes,
      storagePath: input.storagePath,
    });
  }

  /** Link pending uploads to the persisted user message. */
  async linkToMessage(
    attachmentIds: string[],
    sessionId: string,
    messageId: string,
  ): Promise<MessageAttachment[]> {
    return this.repo.linkToMessage({ attachmentIds, sessionId, messageId });
  }

  /** All linked attachments for a session, grouped by message id. */
  async listBySessionGrouped(
    sessionId: string,
  ): Promise<Map<string, MessageAttachment[]>> {
    const rows = await this.repo.listBySession(sessionId);
    const grouped = new Map<string, MessageAttachment[]>();
    for (const row of rows) {
      if (!row.messageId) continue;
      const list = grouped.get(row.messageId) ?? [];
      list.push(row);
      grouped.set(row.messageId, list);
    }
    return grouped;
  }

  async findById(id: string): Promise<MessageAttachment | null> {
    return this.repo.findById(id);
  }

  /** Read an attachment's bytes for serving or provider payloads. */
  async readBytes(
    attachment: MessageAttachment,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    try {
      const buffer = await readFile(attachment.storagePath);
      return { buffer, mimeType: attachment.mimeType };
    } catch (error) {
      throw new AttachmentError(
        `Failed to read attachment ${attachment.id}: ${error instanceof Error ? error.message : String(error)}`,
        'READ_FAILED',
      );
    }
  }

  /** Delete an attachment row and its stored bytes (uploads only). */
  async delete(id: string): Promise<boolean> {
    const attachment = await this.repo.findById(id);
    if (!attachment) return false;
    const deleted = await this.repo.delete(id);
    // Only remove bytes we own (uploads live under baseDir; tool output
    // points into an agent workspace the workspace service owns).
    if (deleted && attachment.storagePath.startsWith(this.baseDir)) {
      await unlink(attachment.storagePath).catch(() => {});
    }
    return deleted;
  }
}

export function createAttachmentService(
  options: AttachmentServiceOptions,
): AttachmentService {
  return new AttachmentService(options);
}
