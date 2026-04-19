import type { FastifyPluginAsync } from 'fastify';
import type { ApiKeyService } from '../api-keys/service';
import type {
  CreateApiKeyRequest,
  CreateApiKeyResponse,
  ApiKeyRecord,
} from '@openaidy/shared-types';

export type ApiKeyRoutesOptions = {
  apiKeyService: ApiKeyService;
};

export const apiKeyRoutes: FastifyPluginAsync<ApiKeyRoutesOptions> = async (
  app,
  opts,
) => {
  app.post<{ Body: CreateApiKeyRequest; Reply: CreateApiKeyResponse }>(
    '/api/keys',
    async (request, reply) => {
      const { name, scopes, expiresAt } = request.body;

      if (!name || typeof name !== 'string' || !name.trim()) {
        return reply.code(400).send({ error: 'name is required' } as never);
      }
      if (!Array.isArray(scopes) || scopes.length === 0) {
        return reply
          .code(400)
          .send({ error: 'scopes must be a non-empty array' } as never);
      }

      const { record, rawKey } = await opts.apiKeyService.create({
        name: name.trim(),
        scopes,
        createdBy: 'admin',
        ...(expiresAt ? { expiresAt: new Date(expiresAt) } : {}),
      });

      return reply.code(201).send({ key: record, rawKey });
    },
  );

  app.get<{ Reply: { keys: ApiKeyRecord[] } }>(
    '/api/keys',
    async (_, reply) => {
      const keys = await opts.apiKeyService.list();
      return reply.send({ keys });
    },
  );

  app.delete<{
    Params: { id: string };
    Reply: { key: ApiKeyRecord } | { error: string };
  }>('/api/keys/:id', async (request, reply) => {
    const revoked = await opts.apiKeyService.revoke(request.params.id);
    if (!revoked) {
      return reply.code(404).send({ error: 'API key not found' });
    }
    return reply.send({ key: revoked });
  });
};
