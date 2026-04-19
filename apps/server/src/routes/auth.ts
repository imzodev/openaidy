import type { FastifyPluginAsync } from 'fastify';
import type { AuthMiddleware } from '../websocket/middleware/auth';
import type { ApiKeyService } from '../api-keys/service';
import type {
  AuthVerifyRequest,
  AuthVerifyResponse,
} from '@openaidy/shared-types';

const API_KEY_PREFIX = 'oak_';
const API_KEY_SESSION_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24h

export type AuthRoutesOptions = {
  authMiddleware: AuthMiddleware;
  apiKeyService?: ApiKeyService;
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

      if (token.startsWith(API_KEY_PREFIX)) {
        if (!opts.apiKeyService) {
          return reply
            .code(503)
            .send({ valid: false, error: 'API key auth not available' });
        }

        const keyRecord = await opts.apiKeyService.verifyKey(token);

        if (!keyRecord) {
          return reply
            .code(401)
            .send({ valid: false, error: 'Invalid or revoked API key' });
        }

        const jwt = await opts.authMiddleware.generateToken({
          clientId: keyRecord.id,
          type: 'access',
          scopes: keyRecord.scopes,
          expiresIn: API_KEY_SESSION_EXPIRY_MS,
        });

        const expiresAt = new Date(
          Date.now() + API_KEY_SESSION_EXPIRY_MS,
        ).toISOString();

        return reply.send({
          valid: true,
          clientId: keyRecord.id,
          scopes: keyRecord.scopes,
          expiresAt,
          token: jwt,
        });
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
