import { stat } from 'node:fs/promises';
import { basename } from 'node:path';
import type { BuiltinTool } from '@openaidy/runtime';
import type { WorkspaceService } from '../../workspace/service';
import { WorkspaceError } from '../../workspace/service';
import {
  MAX_TOOL_OUTPUT_BYTES,
  kindForMimeType,
  mimeTypeForPath,
} from '../../attachments/service';
import { mediaShareMeta } from '../catalog';

/**
 * Payload the session service reads off the tool result to register the
 * shared file as a message attachment (the tool itself can't — the tool
 * result message doesn't exist until after execution).
 */
export type MediaShareResult = {
  /** Absolute path of the file on disk (stays in place, never copied). */
  absolutePath: string;
  mimeType: string;
  /** Display name shown in the chat (defaults to the file basename). */
  name: string;
};

/**
 * media_share
 *
 * Shares an existing workspace media file (image, audio, or video) in the
 * chat so the user can see or play it inline. The tool validates the file
 * (exists, is a file, is a supported media type, fits the size cap) and
 * returns a {@link MediaShareResult} payload; the session service then
 * registers the attachment on the tool result message.
 *
 * Validation lives here (not in the attachment service) so failures come
 * back as tool errors the agent can read and act on.
 */
export function createMediaShareTool(workspace: WorkspaceService): BuiltinTool {
  return {
    name: mediaShareMeta.name,
    description: mediaShareMeta.description,
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Relative path of the media file within the workspace, e.g. "media/chart.png"',
        },
        name: {
          type: 'string',
          description:
            'Optional display name for the chat attachment. Defaults to the file name.',
        },
      },
      required: ['path'],
    },
    async execute(args, ctx) {
      const filePath = args['path'];
      const displayName = args['name'];

      if (typeof filePath !== 'string' || !filePath) {
        return { ok: false, error: 'path is required and must be a string' };
      }
      if (displayName !== undefined && typeof displayName !== 'string') {
        return { ok: false, error: 'name must be a string when provided' };
      }

      // Resolve inside the workspace (blocks ../ traversal).
      let absolutePath: string;
      try {
        absolutePath = workspace.validatePath(ctx.agentId, filePath);
      } catch (err) {
        if (err instanceof WorkspaceError) {
          return { ok: false, error: err.message };
        }
        throw err;
      }

      // Must exist and be a regular file.
      let sizeBytes: number;
      try {
        const stats = await stat(absolutePath);
        if (!stats.isFile()) {
          return { ok: false, error: `"${filePath}" is not a file` };
        }
        sizeBytes = stats.size;
      } catch {
        return { ok: false, error: `File not found: "${filePath}"` };
      }

      if (sizeBytes > MAX_TOOL_OUTPUT_BYTES) {
        const limitMb = Math.floor(MAX_TOOL_OUTPUT_BYTES / (1024 * 1024));
        const sizeMb = (sizeBytes / (1024 * 1024)).toFixed(1);
        return {
          ok: false,
          error: `"${filePath}" is ${sizeMb}MB — over the ${limitMb}MB limit for chat media. Compress or trim it, then try again.`,
        };
      }

      // Must be a media type the chat can render.
      const mimeType = mimeTypeForPath(filePath);
      const kind = mimeType ? kindForMimeType(mimeType) : null;
      if (!mimeType || !kind) {
        return {
          ok: false,
          error:
            `"${filePath}" is not a supported media file. ` +
            'Supported: png/jpg/gif/webp images, wav/mp3/m4a/ogg/webm/flac/aac audio, mp4/webm/ogv video.',
        };
      }

      const name = displayName?.trim() || basename(filePath);
      const media: MediaShareResult = { absolutePath, mimeType, name };
      return {
        ok: true,
        content: `Shared ${kind} "${name}" in chat.`,
        media,
      };
    },
  };
}
