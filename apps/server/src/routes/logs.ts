import type { FastifyPluginAsync } from 'fastify';
import {
  getLogBuffer,
  type LogLevel,
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

    // Build filter object conditionally to avoid undefined assignment issues with exactOptionalPropertyTypes
    const filter: LogFilter = {
      limit: query.limit ? Math.min(query.limit, 100) : 100,
      offset: query.offset ? Math.max(0, query.offset) : 0,
    };

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
