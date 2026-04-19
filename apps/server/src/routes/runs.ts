import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import type { RunEventEmitter, RunEvent } from '../dispatch/events';
import { formatSSE } from '../dispatch/events';
import type { AuthMiddleware } from '../websocket/middleware/auth';
import { requireAuth } from '../middleware/require-auth';

/**
 * Run stream routes options
 */
export type RunStreamRoutesOptions = {
  runEvents: RunEventEmitter;
  authMiddleware: AuthMiddleware;
};

/**
 * SSE headers
 */
const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no', // Disable nginx buffering
};

export const runStreamRoutes: FastifyPluginAsync<
  RunStreamRoutesOptions
> = async (app, options) => {
  const { runEvents, authMiddleware } = options;

  app.addHook(
    'preHandler',
    requireAuth({ authMiddleware, requiredScope: 'sessions.stream' }),
  );

  /**
   * GET /sessions/:sessionId/runs/:runId/stream
   * SSE endpoint for streaming run events
   */
  app.get(
    '/sessions/:sessionId/runs/:runId/stream',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { sessionId, runId } = request.params as {
        sessionId: string;
        runId: string;
      };

      // Set SSE headers
      reply.raw.writeHead(200, SSE_HEADERS);

      // Send initial connection message
      reply.raw.write(`: connected\n\n`);

      // Subscribe to run events
      const unsubscribe = runEvents.subscribe(runId, (event: RunEvent) => {
        // Verify event belongs to the requested session
        if (event.sessionId !== sessionId) {
          return; // Ignore events from other sessions
        }

        // Format and send the event
        reply.raw.write(formatSSE(event));

        // Close connection on completion or failure
        if (event.type === 'run.completed' || event.type === 'run.failed') {
          reply.raw.end();
        }
      });

      // Handle client disconnect
      request.raw.on('close', () => {
        unsubscribe();
      });

      // Keep the connection alive
      // The connection will be closed when:
      // 1. The run completes or fails
      // 2. The client disconnects
      // 3. The server shuts down

      // Return a promise that never resolves (keeps connection open)
      // This is resolved when the connection is closed
      return new Promise<void>((resolve) => {
        request.raw.on('end', () => {
          unsubscribe();
          resolve();
        });
      });
    },
  );
};
