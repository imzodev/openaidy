import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppConfigService } from '../config/service';
import type { AuthMiddleware } from '../websocket/middleware/auth';
import { requireAuth } from '../middleware/require-auth';

const putConfigSchema = z.unknown();

export type ConfigRoutesOptions = {
  configService: AppConfigService;
  authMiddleware: AuthMiddleware;
};

export const configRoutes: FastifyPluginAsync<ConfigRoutesOptions> = async (
  app,
  options,
) => {
  const { configService, authMiddleware } = options;

  app.addHook(
    'preHandler',
    requireAuth({ authMiddleware, requiredScope: 'config.read' }),
  );

  app.get('/config', async () => {
    return {
      config: configService.getConfig(),
      status: configService.getStatus(),
    };
  });

  app.put('/config', async (request, reply) => {
    let body: unknown;

    try {
      body = putConfigSchema.parse(request.body);
    } catch (error) {
      reply.code(400);
      return {
        error: 'validation.invalid_request',
        message:
          error instanceof Error ? error.message : 'Invalid request body',
      };
    }

    try {
      const config = await configService.save(body);
      return {
        config,
        status: configService.getStatus(),
      };
    } catch (error) {
      reply.code(400);
      return {
        error: 'config.invalid',
        message:
          error instanceof Error ? error.message : 'Invalid configuration',
      };
    }
  });
};
