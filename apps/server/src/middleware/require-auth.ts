import type { FastifyRequest, FastifyReply } from 'fastify';
import type { AuthMiddleware } from '../websocket/middleware/auth';

export type RequireAuthOptions = {
  authMiddleware: AuthMiddleware;
  requiredScope?: string;
};

/**
 * Fastify preHandler hook that enforces JWT Bearer authentication.
 *
 * Validates the Authorization header, optionally checks for a required scope.
 * Returns 401 for missing/invalid tokens, 403 for insufficient scope.
 */
export function requireAuth(opts: RequireAuthOptions) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers.authorization;
    const token = authHeader
      ? opts.authMiddleware.extractFromHeader(authHeader)
      : null;

    if (!token) {
      return reply
        .code(401)
        .send({ error: 'AUTH_REQUIRED', message: 'Authentication required' });
    }

    const payload = await opts.authMiddleware.validateToken(token);

    if (!payload) {
      return reply
        .code(401)
        .send({ error: 'AUTH_INVALID', message: 'Invalid or expired token' });
    }

    if (
      opts.requiredScope &&
      !opts.authMiddleware.hasCapability(payload.scopes, opts.requiredScope)
    ) {
      return reply.code(403).send({
        error: 'INSUFFICIENT_SCOPE',
        message: `Missing required scope: ${opts.requiredScope}`,
      });
    }
  };
}
