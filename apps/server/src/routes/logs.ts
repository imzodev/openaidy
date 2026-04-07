import type { FastifyPluginAsync } from 'fastify';
import { getLogBuffer } from '../lib/logger';
import type {
  LogLevel,
  LogFilter,
  LogQueryResult,
  LogStats,
} from '@openaidy/shared-types';

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

export const logRoutes: FastifyPluginAsync = async (app) => {
  const buffer = getLogBuffer();

  // GET /api/logs - Query logs with filters
  app.get<{ Querystring: LogsQuerystring }>(
    '/api/logs',
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
  app.get('/api/logs/stats', async (_request, reply) => {
    const stats: LogStats = buffer.getStats();
    return reply.send(stats);
  });

  // DELETE /api/logs - Clear log buffer
  // NOTE: This endpoint requires authentication in production deployments.
  // For now, we require either:
  //   - A Bearer token in Authorization header (indicating authenticated user)
  //   - An X-Admin-Secret header (for internal/development use)
  // TODO: Integrate with proper auth middleware when available
  app.delete('/api/logs', async (request, reply) => {
    const authHeader = request.headers.authorization;
    const adminSecret = request.headers['x-admin-secret'];

    // Require some form of authentication
    const hasAuth =
      (authHeader && typeof authHeader === 'string' && authHeader.length > 0) ||
      (adminSecret &&
        typeof adminSecret === 'string' &&
        adminSecret.length > 0);

    if (!hasAuth) {
      return reply.code(401).send({
        error: 'unauthorized',
        message:
          'Authentication required to clear logs. Provide Authorization: Bearer <token> or X-Admin-Secret header.',
      });
    }

    buffer.clear();
    return reply.send({ success: true, cleared: true });
  });
};
