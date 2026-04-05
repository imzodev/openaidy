import type { FastifyPluginAsync } from 'fastify';
import {
  getLogBuffer,
  type LogFilter,
  type LogQueryResult,
  type LogStats,
} from '../lib/logger';

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
  app.get<{ Querystring: LogsQuerystring }>('/api/logs', async (request, reply) => {
    const query = request.query;

    const filter: LogFilter = {
      levels: query.levels ? query.levels.split(',').filter(Boolean) as LogFilter['levels'] : undefined,
      contexts: query.contexts ? query.contexts.split(',').filter(Boolean) : undefined,
      search: query.search,
      since: query.since ? new Date(query.since).getTime() : undefined,
      until: query.until ? new Date(query.until).getTime() : undefined,
      requestId: query.requestId,
      sessionId: query.sessionId,
      runId: query.runId,
      limit: query.limit ? Math.min(query.limit, 100) : 100,
      offset: query.offset ? Math.max(0, query.offset) : 0,
    };

    const result: LogQueryResult = buffer.query(filter);
    return reply.send(result);
  });

  // GET /api/logs/stats - Get log statistics
  app.get('/api/logs/stats', async (_request, reply) => {
    const stats: LogStats = buffer.getStats();
    return reply.send(stats);
  });

  // DELETE /api/logs - Clear log buffer
  app.delete('/api/logs', async (_request, reply) => {
    buffer.clear();
    return reply.send({ success: true });
  });
};
