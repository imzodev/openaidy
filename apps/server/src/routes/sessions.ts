import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { SessionMessageService } from '../sessions/service';
import type { AuthMiddleware } from '../websocket/middleware/auth';
import { requireAuth } from '../middleware/require-auth';

const createSessionSchema = z.object({
  title: z.string().min(1),
});

// PATCH /sessions/:id — partial update. Any subset of fields may be provided;
// `status` is limited to active/archived (delete has its own endpoint).
const updateSessionSchema = z
  .object({
    title: z.string().min(1).optional(),
    status: z.enum(['active', 'archived']).optional(),
    favorited: z.boolean().optional(),
  })
  .refine(
    (body) =>
      body.title !== undefined ||
      body.status !== undefined ||
      body.favorited !== undefined,
    { message: 'At least one of title, status, or favorited is required' },
  );

const submitMessageSchema = z
  .object({
    role: z.enum(['user', 'system']),
    content: z.string(),
    agentId: z.string().optional(),
    providerId: z.string().optional(),
    modelId: z.string().optional(),
    attachmentIds: z.array(z.string()).max(10).optional(),
  })
  .refine((body) => body.content.length > 0 || body.attachmentIds?.length, {
    message: 'content is required unless attachments are provided',
    path: ['content'],
  });

/**
 * Session routes options
 */
export type SessionRoutesOptions = {
  sessionService: SessionMessageService;
  authMiddleware: AuthMiddleware;
};

export const sessionRoutes: FastifyPluginAsync<SessionRoutesOptions> = async (
  app,
  options,
) => {
  const { sessionService, authMiddleware } = options;

  app.addHook(
    'preHandler',
    requireAuth({ authMiddleware, requiredScope: 'sessions.list' }),
  );

  /**
   * GET /sessions
   * List sessions, optionally filtered by status (?status=active|archived).
   * Defaults to active so archived sessions stay out of the main list.
   */
  app.get('/sessions', async (request, reply) => {
    const { status } = request.query as { status?: string };
    if (status !== undefined && status !== 'active' && status !== 'archived') {
      reply.code(400);
      return {
        error: 'validation.invalid_request',
        message: 'status must be "active" or "archived"',
      };
    }
    const items = await sessionService.listSessions(status ?? 'active');
    return { items };
  });

  /**
   * GET /sessions/search
   * Search sessions by title or message content using FTS5
   */
  app.get('/sessions/search', async (request, reply) => {
    const { q, limit, currentSessionId } = request.query as {
      q?: string;
      limit?: string;
      currentSessionId?: string;
    };

    if (!q || typeof q !== 'string' || !q.trim()) {
      reply.code(400);
      return {
        error: 'validation.invalid_request',
        message:
          'Query parameter "q" is required and must be a non-empty string',
      };
    }

    const searchOptions: Record<string, string | number> = {};
    if (limit) searchOptions['limit'] = parseInt(limit, 10);
    if (currentSessionId) searchOptions['currentSessionId'] = currentSessionId;

    const results = await sessionService.searchSessions(
      q.trim(),
      searchOptions as { limit?: number; currentSessionId?: string },
    );

    return { items: results };
  });

  /**
   * POST /sessions
   * Create a new session
   */
  app.post('/sessions', async (request, reply) => {
    let parsed;
    try {
      parsed = createSessionSchema.parse(request.body);
    } catch (error) {
      reply.code(400);
      return {
        error: 'validation.invalid_request',
        message:
          error instanceof Error ? error.message : 'Invalid request body',
      };
    }
    const session = await sessionService.createSession(parsed.title);
    reply.code(201);
    return session;
  });

  /**
   * PATCH /sessions/:sessionId
   * Update a session's title (rename), status (archive/unarchive), and/or
   * favorite (pin) flag. Any subset of fields may be provided.
   *
   * Requires the `sessions.write` capability.
   */
  app.patch<{ Params: { sessionId: string } }>(
    '/sessions/:sessionId',
    {
      preHandler: requireAuth({
        authMiddleware,
        requiredScope: 'sessions.write',
      }),
    },
    async (request, reply) => {
      const { sessionId } = request.params;

      let patch;
      try {
        patch = updateSessionSchema.parse(request.body);
      } catch (error) {
        reply.code(400);
        return {
          error: 'validation.invalid_request',
          message:
            error instanceof Error ? error.message : 'Invalid request body',
        };
      }

      const existing = await sessionService.getSession(sessionId);
      if (!existing) {
        reply.code(404);
        return { error: 'Session not found', sessionId };
      }

      // Apply the provided fields. Each maps to a dedicated service method so
      // the ordering (title → status → favorite) is deterministic; the final
      // read returns the fully-updated row.
      if (patch.title !== undefined) {
        await sessionService.updateSessionTitle(sessionId, patch.title);
      }
      if (patch.status !== undefined) {
        await sessionService.updateSessionStatus(sessionId, patch.status);
      }
      if (patch.favorited !== undefined) {
        await sessionService.updateSessionFavorite(sessionId, patch.favorited);
      }

      const updated = await sessionService.getSession(sessionId);
      return updated;
    },
  );

  /**
   * GET /sessions/:sessionId
   * Get a session by ID
   */
  app.get('/sessions/:sessionId', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const session = await sessionService.getSession(sessionId);

    if (!session) {
      reply.code(404);
      return { error: 'Session not found', sessionId };
    }

    return session;
  });

  /**
   * GET /sessions/:sessionId/messages
   * List all messages for a session
   */
  app.get('/sessions/:sessionId/messages', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };

    const session = await sessionService.getSession(sessionId);
    if (!session) {
      reply.code(404);
      return { error: 'Session not found', sessionId };
    }

    const messages = await sessionService.listMessages(sessionId);
    return { items: messages };
  });

  /**
   * POST /sessions/:sessionId/messages
   * Submit a message to a session
   *
   * This endpoint:
   * 1. Persists the user message
   * 2. Creates a run record
   * 3. Invokes the provider
   * 4. Persists the assistant response
   * 5. Updates run metadata
   */
  app.post('/sessions/:sessionId/messages', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };

    // Validate request body
    let body;
    try {
      body = submitMessageSchema.parse(request.body);
    } catch (error) {
      reply.code(400);
      return {
        ok: false,
        error: {
          code: 'validation.invalid_request',
          message:
            error instanceof Error ? error.message : 'Invalid request body',
        },
      };
    }

    // Submit message through service
    const submitInput = {
      sessionId,
      role: body.role,
      content: body.content,
      ...(body.agentId !== undefined && { agentId: body.agentId }),
      ...(body.providerId !== undefined && { providerId: body.providerId }),
      ...(body.modelId !== undefined && { modelId: body.modelId }),
      ...(body.attachmentIds !== undefined && {
        attachmentIds: body.attachmentIds,
      }),
    };

    const result = await sessionService.submitMessageStreaming({
      ...submitInput,
      onStreamEvent: () => {},
    });

    if (result.ok) {
      reply.code(201);
      return {
        ok: true,
        userMessage: result.userMessage,
        assistantMessage: result.assistantMessage,
        run: result.run,
      };
    } else {
      // Map error codes to HTTP status codes
      if (result.error.code === 'session.not_found') {
        reply.code(404);
      } else if (result.error.code.startsWith('provider.config_invalid')) {
        reply.code(400);
      } else if (result.error.code.startsWith('provider.unavailable')) {
        reply.code(503);
      } else {
        reply.code(500);
      }

      return {
        ok: false,
        error: result.error,
      };
    }
  });

  /**
   * GET /sessions/:sessionId/runs
   * List all runs for a session
   */
  app.get('/sessions/:sessionId/runs', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };

    const session = await sessionService.getSession(sessionId);
    if (!session) {
      reply.code(404);
      return { error: 'Session not found', sessionId };
    }

    const runs = await sessionService.listRuns(sessionId);
    return { items: runs };
  });

  /**
   * DELETE /sessions/:sessionId
   * Delete a session and its messages/runs (cascaded by the DB).
   *
   * Requires the `sessions.delete` capability. The bootstrap admin token
   * has `*` and is permitted; per-session tokens must be granted
   * `sessions.delete` explicitly.
   */
  app.delete<{
    Params: { sessionId: string };
  }>(
    '/sessions/:sessionId',
    {
      preHandler: requireAuth({
        authMiddleware,
        requiredScope: 'sessions.delete',
      }),
    },
    async (request, reply) => {
      const { sessionId } = request.params;

      const deleted = await sessionService.deleteSession(sessionId);
      if (!deleted) {
        return reply.code(404).send({ error: 'Session not found', sessionId });
      }

      return reply.code(204).send();
    },
  );
};
