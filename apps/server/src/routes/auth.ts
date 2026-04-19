import type { FastifyPluginAsync } from 'fastify';
import type { AuthMiddleware } from '../websocket/middleware/auth';
import type {
  AuthVerifyRequest,
  AuthVerifyResponse,
} from '@openaidy/shared-types';

export type AuthRoutesOptions = {
  authMiddleware: AuthMiddleware;
};

export const authRoutes: FastifyPluginAsync<AuthRoutesOptions> = async (
  app,
  opts,
) => {
  app.post<{ Body: AuthVerifyRequest; Reply: AuthVerifyResponse }>(
    '/api/auth/verify',
    async (request, reply) => {
      const { token } = request.body;

      if (!token || typeof token !== 'string') {
        return reply
          .code(400)
          .send({ valid: false, error: 'Token is required' });
      }

      const payload = await opts.authMiddleware.validateToken(token);

      if (!payload) {
        return reply
          .code(401)
          .send({ valid: false, error: 'Invalid or expired token' });
      }

      return reply.send({
        valid: true,
        clientId: payload.sub,
        scopes: payload.scopes,
        expiresAt: new Date(payload.exp * 1000).toISOString(),
      });
    },
  );
};
