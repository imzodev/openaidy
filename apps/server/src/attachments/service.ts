/**
 * Attachment service
 *
 * Stores and serves image/audio/video media attached to session messages.
 * Bytes live on local disk under a dedicated attachments directory
 * (`<baseDir>/<sessionId>/<id>.<ext>`); only metadata goes to the DB
 * (`message_attachments` table). Tool-produced media (e.g. screenshots
 * persisted into an agent workspace, or files shared via media_share) is
 * registered here too, pointing at its existing on-disk location.
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

/**
 * Max size for agent-shared media (tool_output registrations). Higher
 * than the upload cap because videos are the common case here; still
 * bounded so a runaway generation can't push a multi-GB file into chat.
 */
export const MAX_TOOL_OUTPUT_BYTES = 100 * 1024 * 1024;

/** Max attachments a single message (human or addon-submitted) may reference. */
export const MAX_ATTACHMENT_IDS_PER_MESSAGE = 10;

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
  // Browser-playable formats only — the UI promise is that shared media
  // can be viewed or played inline.
  video: ['video/mp4', 'video/webm', 'video/ogg'],
};

/**
 * Supported media types. The source of truth for both lookup tables
 * below. Each row is one mime with its canonical extension (written
 * to disk when an upload arrives) and any extension aliases that
 * resolve to the same mime when shared from the workspace (e.g. `jpeg`
 * is the same as `jpg`).
 *
 * Where two mimes share an extension (audio/wav/x-wav, audio/mpeg/mp3,
 * audio/webm/video/webm), both rows are listed and the first one
 * wins as the canonical mime for {@link MIME_BY_EXT}. The `.webm`
 * override at the bottom bends that rule: a <video> element plays
 * both audio and video webm files, while an <audio> element can't
 * show the picture of a video webm.
 */
const MEDIA_TYPES: ReadonlyArray<
  readonly [mime: string, ext: string, ...aliases: string[]]
> = [
  ['image/png', 'png'],
  ['image/jpeg', 'jpg', 'jpeg'],
  ['image/gif', 'gif'],
  ['image/webp', 'webp'],
  ['audio/wav', 'wav'],
  ['audio/x-wav', 'wav'],
  ['audio/mpeg', 'mp3'],
  ['audio/mp3', 'mp3'],
  ['audio/mp4', 'm4a'],
  ['audio/ogg', 'ogg'],
  ['audio/webm', 'webm'],
  ['audio/flac', 'flac'],
  ['audio/aac', 'aac'],
  ['video/mp4', 'mp4'],
  ['video/webm', 'webm'],
  ['video/ogg', 'ogv'],
];

const MIME_BY_EXT: Record<string, string> = {};
const EXT_BY_MIME: Record<string, string> = {};
for (const [mime, ext, ...aliases] of MEDIA_TYPES) {
  if (!(ext in MIME_BY_EXT)) {
    MIME_BY_EXT[ext] = mime;
  }
  for (const alias of aliases) {
    MIME_BY_EXT[alias] = mime;
  }
  if (!(mime in EXT_BY_MIME)) {
    EXT_BY_MIME[mime] = ext;
  }
}
MIME_BY_EXT['webm'] = 'video/webm';

/** Derive the attachment kind from a mime type, or null if unsupported. */
export function kindForMimeType(mimeType: string): AttachmentKind | null {
  if (ALLOWED_MIME_TYPES.image.includes(mimeType)) return 'image';
  if (ALLOWED_MIME_TYPES.audio.includes(mimeType)) return 'audio';
  if (ALLOWED_MIME_TYPES.video.includes(mimeType)) return 'video';
  return null;
}

/**
 * Best-effort mime type for a file path, from its extension. Returns null
 * for unknown/unsupported extensions. Used by the media_share tool, where
 * the agent names the file it created — extension is the honest contract.
 */
export function mimeTypeForPath(filePath: string): string | null {
  const ext = filePath.split('.').pop()?.toLowerCase();
  if (!ext || ext === filePath.toLowerCase()) return null;
  return MIME_BY_EXT[ext] ?? null;
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
   *
   * Returns null when the file can't be registered: unsupported mime
   * type, vanished file, or over {@link MAX_TOOL_OUTPUT_BYTES}. Callers
   * that need to surface *why* (like the media_share tool) validate
   * before calling so they can return an actionable error themselves.
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
    if (sizeBytes > MAX_TOOL_OUTPUT_BYTES) {
      return null; // backstop — the media_share tool checks this first
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
