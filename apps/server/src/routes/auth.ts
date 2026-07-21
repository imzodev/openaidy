import type { FastifyPluginAsync } from 'fastify';
import type { AuthMiddleware } from '../websocket/middleware/auth';
import type { AccessTokenService } from '../access-tokens/service';
import type {
  AuthVerifyRequest,
  AuthVerifyResponse,
} from '@openaidy/shared-types';

const ACCESS_TOKEN_PREFIX = 'oat_';
const ACCESS_TOKEN_SESSION_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24h

export type AuthRoutesOptions = {
  authMiddleware: AuthMiddleware;
  accessTokenService?: AccessTokenService;
};

export const authRoutes: FastifyPluginAsync<AuthRoutesOptions> = async (
  app,
  opts,
) => {
  app.post<{ Body: AuthVerifyRequest; Reply: AuthVerifyResponse }>(
    '/auth/verify',
    async (request, reply) => {
      const { token } = request.body;

      if (!token || typeof token !== 'string') {
        return reply
          .code(400)
          .send({ valid: false, error: 'Token is required' });
      }

      if (token.startsWith(ACCESS_TOKEN_PREFIX)) {
        if (!opts.accessTokenService) {
          return reply
            .code(503)
            .send({ valid: false, error: 'Access token auth not available' });
        }

        const tokenRecord = await opts.accessTokenService.verifyToken(token);

        if (!tokenRecord) {
          return reply.code(401).send({
            valid: false,
            error: 'Invalid, revoked, or expired access token',
          });
        }

        const jwt = await opts.authMiddleware.generateToken({
          clientId: tokenRecord.id,
          type: 'access',
          scopes: tokenRecord.scopes,
          expiresIn: ACCESS_TOKEN_SESSION_EXPIRY_MS,
        });

        const expiresAt = new Date(
          Date.now() + ACCESS_TOKEN_SESSION_EXPIRY_MS,
        ).toISOString();

        return reply.send({
          valid: true,
          clientId: tokenRecord.id,
          scopes: tokenRecord.scopes,
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
