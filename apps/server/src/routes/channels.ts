import type { FastifyPluginAsync } from 'fastify';
import { requireAuth } from '../middleware/require-auth.js';
import type { IChannel } from '../channels/interface.js';
import type { ChannelStatusResponse } from '@openaidy/shared-types';
import type { ChannelRoutesOptions } from '../types.js';

function toStatusResponse(channel: IChannel): ChannelStatusResponse {
  return {
    id: channel.id,
    type: channel.type,
    status: channel.getStatus(),
    agentId: channel.agentId,
  };
}

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
          app.log.error(
            { err, channelId: req.params.id },
            'channel connect error',
          ),
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

  // GET /channels/:id/qr/stream — SSE stream for QR code and status updates
  app.get<{ Params: { id: string } }>(
    '/channels/:id/qr/stream',
    { preHandler: auth },
    async (req, reply) => {
      const channel = channelRegistry.get(req.params.id);
      if (!channel) return reply.notFound('Channel not found');

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no', // disable nginx buffering if behind a proxy
      });

      const sendEvent = (data: object) => {
        if (!reply.raw.writableEnded) {
          reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
        }
      };

      // Push current state immediately so the client doesn't wait
      if (channel.getStatus() === 'qr' && channel.getQr()) {
        sendEvent({ type: 'qr', qr: channel.getQr() });
      } else {
        sendEvent({ type: 'status', status: channel.getStatus() });
      }

      const onQr = (qr: string) => sendEvent({ type: 'qr', qr });
      const onStatus = (status: string) => {
        sendEvent({ type: 'status', status });
        if (status === 'connected' || status === 'error') {
          reply.raw.end();
        }
      };

      channel.onQrUpdate(onQr);
      channel.onStatusChange(onStatus);

      // Cleanup listeners when client disconnects
      req.raw.on('close', () => {
        channel.removeListener('qr', onQr);
        channel.removeListener('status', onStatus);
      });

      // Keep the connection open — do not return
      await new Promise<void>((resolve) => {
        reply.raw.on('close', resolve);
        reply.raw.on('finish', resolve);
      });
    },
  );
};
