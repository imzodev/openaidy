import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AuthMiddleware } from '../websocket/middleware/auth';
import { requireAuth } from '../middleware/require-auth';
import {
  AttachmentError,
  MAX_ATTACHMENT_BYTES,
  type AttachmentService,
} from '../attachments/service';
import type { SessionMessageService } from '../sessions/service';

/**
 * Exported so the addon-proxy's attachment-create route (which lets an
 * addon upload a file for a session it's posting to) validates against the
 * exact same rules as this human-facing route — one schema, two callers.
 */
export const uploadAttachmentSchema = z.object({
  mimeType: z.string().min(1),
  /** Base64-encoded bytes (no data: URI prefix) */
  data: z.string().min(1),
  name: z.string().max(255).optional(),
});

/**
 * Base64 expands bytes by ~4/3; allow the JSON envelope on top of the
 * decoded-size limit enforced by the service.
 */
const UPLOAD_BODY_LIMIT = Math.ceil(MAX_ATTACHMENT_BYTES * 1.4) + 64 * 1024;

export type AttachmentRoutesOptions = {
  attachmentService: AttachmentService;
  sessionService: SessionMessageService;
  authMiddleware: AuthMiddleware;
};

export const attachmentRoutes: FastifyPluginAsync<
  AttachmentRoutesOptions
> = async (app, options) => {
  const { attachmentService, sessionService, authMiddleware } = options;

  app.addHook(
    'preHandler',
    requireAuth({ authMiddleware, requiredScope: 'sessions.list' }),
  );

  /**
   * POST /sessions/:sessionId/attachments
   * Upload an image/audio/video file for a pending message. The attachment
   * is stored unlinked; submitting a message with its id links it.
   */
  app.post(
    '/sessions/:sessionId/attachments',
    { bodyLimit: UPLOAD_BODY_LIMIT },
    async (request, reply) => {
      const { sessionId } = request.params as { sessionId: string };

      const session = await sessionService.getSession(sessionId);
      if (!session) {
        reply.code(404);
        return { error: 'Session not found', sessionId };
      }

      let body;
      try {
        body = uploadAttachmentSchema.parse(request.body);
      } catch (error) {
        reply.code(400);
        return {
          error: 'validation.invalid_request',
          message:
            error instanceof Error ? error.message : 'Invalid request body',
        };
      }

      try {
        const attachment = await attachmentService.saveUpload({
          sessionId,
          mimeType: body.mimeType,
          data: body.data,
          ...(body.name ? { name: body.name } : {}),
        });
        reply.code(201);
        return {
          id: attachment.id,
          sessionId: attachment.sessionId,
          kind: attachment.kind,
          source: attachment.source,
          name: attachment.name,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes,
          createdAt: attachment.createdAt,
        };
      } catch (error) {
        if (error instanceof AttachmentError) {
          reply.code(
            error.code === 'FILE_TOO_LARGE'
              ? 413
              : error.code === 'UNSUPPORTED_MIME_TYPE'
                ? 415
                : 500,
          );
          return { error: error.code, message: error.message };
        }
        throw error;
      }
    },
  );

  /**
   * GET /attachments/:attachmentId/raw
   * Serve an attachment's raw bytes with its media type. Fetched by the
   * client through the authenticated fetch wrapper, so an <img src> points
   * at an object URL, not here (same pattern as /workspace/:agentId/raw/*).
   */
  app.get('/attachments/:attachmentId/raw', async (request, reply) => {
    const { attachmentId } = request.params as { attachmentId: string };

    const attachment = await attachmentService.findById(attachmentId);
    if (!attachment) {
      reply.code(404);
      return { error: 'Attachment not found', attachmentId };
    }

    try {
      const { buffer, mimeType } =
        await attachmentService.readBytes(attachment);
      reply.header('Content-Type', mimeType);
      reply.header('Content-Length', buffer.length);
      reply.header('Cache-Control', 'private, max-age=3600');
      return reply.send(buffer);
    } catch {
      reply.code(404);
      return { error: 'Attachment bytes not found', attachmentId };
    }
  });
};
