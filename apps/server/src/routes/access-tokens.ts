import type { FastifyPluginAsync } from 'fastify';
import type { AccessTokenService } from '../access-tokens/service';
import type { AuthMiddleware } from '../websocket/middleware/auth';
import { requireAuth } from '../middleware/require-auth';
import type {
  CreateAccessTokenRequest,
  CreateAccessTokenResponse,
  AccessTokenRecord,
} from '@openaidy/shared-types';

const ADMIN_SCOPE = '*';

export type AccessTokenRoutesOptions = {
  accessTokenService: AccessTokenService;
  authMiddleware: AuthMiddleware;
};

export const accessTokenRoutes: FastifyPluginAsync<
  AccessTokenRoutesOptions
> = async (app, opts) => {
  const adminAuth = requireAuth({
    authMiddleware: opts.authMiddleware,
    requiredScope: ADMIN_SCOPE,
  });

  app.post<{
    Body: CreateAccessTokenRequest;
    Reply: CreateAccessTokenResponse;
  }>('/access-tokens', { preHandler: adminAuth }, async (request, reply) => {
    const { name, scopes, expiresAt } = request.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return reply.code(400).send({ error: 'name is required' } as never);
    }
    if (!Array.isArray(scopes) || scopes.length === 0) {
      return reply
        .code(400)
        .send({ error: 'scopes must be a non-empty array' } as never);
    }

    const { record, rawToken } = await opts.accessTokenService.create({
      name: name.trim(),
      scopes,
      createdBy: 'admin',
      ...(expiresAt ? { expiresAt: new Date(expiresAt) } : {}),
    });

    return reply.code(201).send({ key: record, rawKey: rawToken });
  });

  app.get<{ Reply: { keys: AccessTokenRecord[] } }>(
    '/access-tokens',
    { preHandler: adminAuth },
    async (_, reply) => {
      const keys = await opts.accessTokenService.list();
      return reply.send({ keys });
    },
  );

  app.delete<{
    Params: { id: string };
    Reply: { key: AccessTokenRecord } | { error: string };
  }>(
    '/access-tokens/:id',
    { preHandler: adminAuth },
    async (request, reply) => {
      const revoked = await opts.accessTokenService.revoke(request.params.id);
      if (!revoked) {
        return reply.code(404).send({ error: 'Access token not found' });
      }
      return reply.send({ key: revoked });
    },
  );
};
