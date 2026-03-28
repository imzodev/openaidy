import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { SessionMessageService } from '../sessions/service';

const createSessionSchema = z.object({
  title: z.string().min(1),
});

const submitMessageSchema = z.object({
  role: z.enum(['user', 'system']),
  content: z.string().min(1),
  agentId: z.string().optional(),
  providerId: z.string().optional(),
  modelId: z.string().optional(),
});

/**
 * Session routes options
 */
export type SessionRoutesOptions = {
  sessionService: SessionMessageService;
};

export const sessionRoutes: FastifyPluginAsync<SessionRoutesOptions> = async (
  app,
  options,
) => {
  const { sessionService } = options;

  /**
   * GET /sessions
   * List all sessions
   */
  app.get('/sessions', async () => {
    const items = await sessionService.listSessions();
    return { items };
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
    };

    const result = await sessionService.submitMessage(submitInput);

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
};
