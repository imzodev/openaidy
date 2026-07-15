import type { FastifyPluginAsync } from 'fastify';
import type { SessionMessageService } from '../sessions/service';
import type { AuthMiddleware } from '../websocket/middleware/auth';
import { requireAuth } from '../middleware/require-auth';
import { aggregateUsage } from '../usage/aggregate';

export type UsageRoutesOptions = {
  sessionService: SessionMessageService;
  authMiddleware: AuthMiddleware;
};

/** Validate an optional ISO date-ish string; returns undefined if absent. */
function parseDateParam(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

export const usageRoutes: FastifyPluginAsync<UsageRoutesOptions> = async (
  app,
  options,
) => {
  const { sessionService, authMiddleware } = options;

  app.addHook(
    'preHandler',
    requireAuth({ authMiddleware, requiredScope: 'sessions.list' }),
  );

  /**
   * GET /sessions/:sessionId/usage
   * Cumulative token usage + estimated cost for a single session.
   */
  app.get('/sessions/:sessionId/usage', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };

    const session = await sessionService.getSession(sessionId);
    if (!session) {
      reply.code(404);
      return { error: 'Session not found', sessionId };
    }

    const usage = await sessionService.getSessionUsage(sessionId);
    return { sessionId, usage };
  });

  /**
   * GET /usage?from=&to=
   * Aggregated usage across all sessions with day / provider / model
   * breakdowns. `from`/`to` are ISO timestamps (`to` exclusive); both
   * optional.
   */
  app.get('/usage', async (request) => {
    const query = request.query as { from?: string; to?: string };
    const from = parseDateParam(query.from);
    const to = parseDateParam(query.to);

    const rows = await sessionService.listUsageRows({
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    });
    const report = aggregateUsage(rows);

    return {
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...report,
    };
  });
};
