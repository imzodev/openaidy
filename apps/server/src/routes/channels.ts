import type { FastifyPluginAsync } from 'fastify';
import { requireAuth } from '../middleware/require-auth.js';
import type { ChannelRoutesOptions } from '../types.js';
import { createLogger } from '../lib/logger.js';
import { toStatusResponse } from '../channels/status.js';

const log = createLogger('channel-routes');

export const channelRoutes: FastifyPluginAsync<ChannelRoutesOptions> = async (
  app,
  { channelRegistry, authMiddleware },
) => {
  const auth = requireAuth({ authMiddleware });

  // GET /channels — list all channels
  app.get('/channels', { preHandler: auth }, async (_req, reply) => {
    const channels = channelRegistry.getAll().map(toStatusResponse);
    return reply.send(channels);
  });

  // GET /channels/:id/status
  app.get<{ Params: { id: string } }>(
    '/channels/:id/status',
    { preHandler: auth },
    async (req, reply) => {
      const channel = channelRegistry.get(req.params.id);
      if (!channel) return reply.notFound('Channel not found');
      return reply.send(toStatusResponse(channel));
    },
  );

  // POST /channels/:id/connect
  app.post<{ Params: { id: string } }>(
    '/channels/:id/connect',
    { preHandler: auth },
    async (req, reply) => {
      const channel = channelRegistry.get(req.params.id);
      if (!channel) return reply.notFound('Channel not found');
      // Fire-and-forget — connect() is async and may take time (QR flow)
      channel
        .connect()
        .catch((err) =>
          log.error('channel connect error', { err, channelId: req.params.id }),
        );
      return reply.status(204).send();
    },
  );

  // POST /channels/:id/disconnect
  app.post<{ Params: { id: string } }>(
    '/channels/:id/disconnect',
    { preHandler: auth },
    async (req, reply) => {
      const channel = channelRegistry.get(req.params.id);
      if (!channel) return reply.notFound('Channel not found');
      await channel.disconnect();
      return reply.status(204).send();
    },
  );
};
