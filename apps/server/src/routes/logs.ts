import type { FastifyPluginAsync } from 'fastify';
import { getLogBuffer } from '../lib/log-buffer';
import type { AuthMiddleware } from '../websocket/middleware/auth';
import { requireAuth } from '../middleware/require-auth';
import type {
  LogLevel,
  LogFilter,
  LogQueryResult,
  LogStats,
} from '@openaidy/shared-types';

export type LogRoutesOptions = {
  authMiddleware: AuthMiddleware;
};

interface LogsQuerystring {
  levels?: string;
  contexts?: string;
  since?: string;
  until?: string;
  search?: string;
  limit?: number;
  offset?: number;
  requestId?: string;
  sessionId?: string;
  runId?: string;
}

export const logRoutes: FastifyPluginAsync<LogRoutesOptions> = async (
  app,
  options,
) => {
  const buffer = getLogBuffer();

  // Logs can contain sensitive operational data (session/run ids, error
  // detail), so every log route requires a valid token. Reads need
  // authentication; clearing (destructive) additionally requires admin scope.
  const requireAuthenticated = requireAuth({
    authMiddleware: options.authMiddleware,
  });
  const requireAdmin = requireAuth({
    authMiddleware: options.authMiddleware,
    requiredScope: '*',
  });

  // GET /api/logs - Query logs with filters
  app.get<{ Querystring: LogsQuerystring }>(
    '/logs',
    { preHandler: requireAuthenticated },
    async (request, reply) => {
      const query = request.query;

      // Build filter object
      const filter: LogFilter = {};

      if (query.levels) {
        filter.levels = query.levels.split(',').filter(Boolean) as LogLevel[];
      }
      if (query.contexts) {
        filter.contexts = query.contexts.split(',').filter(Boolean);
      }
      if (query.search) {
        filter.search = query.search;
      }
      if (query.since) {
        filter.since = query.since;
      }
      if (query.until) {
        filter.until = query.until;
      }
      if (query.limit !== undefined) {
        filter.limit = Math.min(query.limit, 100);
      }
      if (query.offset !== undefined) {
        filter.offset = Math.max(0, query.offset);
      }
      if (query.requestId) {
        filter.requestId = query.requestId;
      }
      if (query.sessionId) {
        filter.sessionId = query.sessionId;
      }
      if (query.runId) {
        filter.runId = query.runId;
      }

      const result: LogQueryResult = buffer.query(filter);
      return reply.send(result);
    },
  );

  // GET /api/logs/stats - Get log statistics
  app.get(
    '/logs/stats',
    { preHandler: requireAuthenticated },
    async (_request, reply) => {
      const stats: LogStats = buffer.getStats();
      return reply.send(stats);
    },
  );

  // DELETE /api/logs - Clear log buffer (destructive → admin scope)
  app.delete('/logs', { preHandler: requireAdmin }, async (_request, reply) => {
    buffer.clear();
    return reply.send({ success: true, cleared: true });
  });
};
