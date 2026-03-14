import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { SessionService } from '../sessions/service';

const createSessionSchema = z.object({
  title: z.string().min(1),
});

export const sessionRoutes: FastifyPluginAsync = async (app) => {
  const sessionService = new SessionService();

  app.get('/sessions', async () => ({ items: sessionService.list() }));

  app.post('/sessions', async (request, reply) => {
    const parsed = createSessionSchema.parse(request.body);
    const session = sessionService.create(parsed);
    reply.code(201);
    return session;
  });
};
