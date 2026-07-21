import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import type { AddonProxyRoutesOptions, InvokeAgentBody } from './types';
import { createAddonProxyService } from '../addons/proxy';
import { AddonProxyAgentService } from './proxy-agent-service';
import { AddonStorageError } from './storage/engine';
import type { StorageParams } from './storage/engine';

// Extend FastifyRequest to include addon context
declare module 'fastify' {
  interface FastifyRequest {
    addonId: string | undefined;
    addonPermissions: string[] | undefined;
  }
}

/**
 * Addon proxy routes plugin
 */
export const addonProxyRoutes: FastifyPluginAsync<
  AddonProxyRoutesOptions
> = async (app, opts) => {
  const proxyService = createAddonProxyService(
    opts.addonService,
    opts.internalApiBaseUrl,
  );

  const addonAgentService = opts.sessionService
    ? new AddonProxyAgentService(opts.sessionService)
    : undefined;

  // Middleware to validate addon token
  const validateAddonToken = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => {
    const authHeader = request.headers.authorization ?? '';

    if (!authHeader.startsWith('Bearer ')) {
      return reply.code(401).send({
        error: 'UNAUTHORIZED',
        message: 'Missing or invalid authorization header',
      });
    }

    const token = authHeader.slice(7);
    const tokenResult = await proxyService.validateToken(token);

    if (!tokenResult.valid) {
      return reply.code(401).send({
        error: 'INVALID_TOKEN',
        message: tokenResult.error ?? 'Invalid token',
      });
    }

    request.addonId = tokenResult.addonId;
    request.addonPermissions = tokenResult.permissions;
  };

  // POST /api/addon-proxy/agents/:agentId/invoke
  app.post<{
    Params: { agentId: string };
    Body: InvokeAgentBody;
  }>(
    '/addon-proxy/agents/:agentId/invoke',
    { preHandler: validateAddonToken },
    async (request, reply) => {
      const { agentId } = request.params;
      const { input, context: _context } = request.body;

      const addon = await opts.addonService.getAddon(request.addonId!);

      if (!addon) {
        return reply
          .code(404)
          .send({ error: 'ADDON_NOT_FOUND', message: 'Addon not found' });
      }

      const authResult = proxyService.authorize(addon, 'agents.invoke');
      if (!authResult.authorized) {
        return reply
          .code(403)
          .send({ error: 'PERMISSION_DENIED', message: authResult.error });
      }

      if (!proxyService.hasAgentAccess(addon, agentId)) {
        return reply.code(403).send({
          error: 'AGENT_NOT_ALLOWED',
          message: `Access to agent ${agentId} not allowed`,
        });
      }

      await proxyService.recordUsage(
        request.addonId!,
        `/agents/${agentId}/invoke`,
      );

      if (!addonAgentService) {
        return reply.send({
          success: true,
          agentId,
          input,
          message: 'Agent invocation not available (no session service)',
        });
      }

      try {
        const result = await addonAgentService.invoke(
          request.addonId!,
          agentId,
          input,
        );

        if (!result.ok) {
          return reply.code(502).send({
            error: 'AGENT_ERROR',
            message: result.error.message,
            code: result.error.code,
          });
        }

        return reply.send({
          success: true,
          agentId,
          sessionId: result.sessionId,
          message: result.message,
        });
      } catch (err) {
        return reply.code(502).send({
          error: 'AGENT_INVOCATION_FAILED',
          message:
            err instanceof Error ? err.message : 'Agent invocation failed',
        });
      }
    },
  );

  // GET /api/addon-proxy/agents
  app.get(
    '/addon-proxy/agents',
    { preHandler: validateAddonToken },
    async (request, reply) => {
      const addon = await opts.addonService.getAddon(request.addonId!);

      if (!addon) {
        return reply
          .code(404)
          .send({ error: 'ADDON_NOT_FOUND', message: 'Addon not found' });
      }

      const authResult = proxyService.authorize(addon, 'agents.list');
      if (!authResult.authorized) {
        return reply
          .code(403)
          .send({ error: 'PERMISSION_DENIED', message: authResult.error });
      }

      await proxyService.recordUsage(request.addonId!, '/agents');

      if (!opts.agentRegistry) {
        return reply.send({ items: [] });
      }

      return reply.send({ items: opts.agentRegistry.listAgents() });
    },
  );

  // GET /api/addon-proxy/sessions
  app.get(
    '/addon-proxy/sessions',
    { preHandler: validateAddonToken },
    async (request, reply) => {
      const addon = await opts.addonService.getAddon(request.addonId!);

      if (!addon) {
        return reply
          .code(404)
          .send({ error: 'ADDON_NOT_FOUND', message: 'Addon not found' });
      }

      const authResult = proxyService.authorize(addon, 'sessions.list');
      if (!authResult.authorized) {
        return reply
          .code(403)
          .send({ error: 'PERMISSION_DENIED', message: authResult.error });
      }

      await proxyService.recordUsage(request.addonId!, '/sessions');

      if (!opts.sessionService) {
        return reply.send({ sessions: [] });
      }

      const sessions = await opts.sessionService.listSessions();
      return reply.send({ sessions });
    },
  );

  // POST /api/addon-proxy/sessions/:sessionId/messages
  app.post<{
    Params: { sessionId: string };
    Body: { content: string; agentId: string };
  }>(
    '/addon-proxy/sessions/:sessionId/messages',
    { preHandler: validateAddonToken },
    async (request, reply) => {
      const addon = await opts.addonService.getAddon(request.addonId!);

      if (!addon) {
        return reply
          .code(404)
          .send({ error: 'ADDON_NOT_FOUND', message: 'Addon not found' });
      }

      const authResult = proxyService.authorize(addon, 'sessions.write');
      if (!authResult.authorized) {
        return reply
          .code(403)
          .send({ error: 'PERMISSION_DENIED', message: authResult.error });
      }

      const { sessionId } = request.params;
      const { content, agentId } = request.body;

      if (!content || !agentId) {
        return reply.code(400).send({
          error: 'INVALID_REQUEST',
          message: 'content and agentId are required',
        });
      }

      await proxyService.recordUsage(
        request.addonId!,
        `/sessions/${sessionId}/messages`,
      );

      if (!opts.sessionService) {
        return reply.code(503).send({
          error: 'SERVICE_UNAVAILABLE',
          message: 'Session service not available',
        });
      }

      const result = await opts.sessionService.submitMessageStreaming({
        sessionId,
        role: 'user',
        content,
        agentId,
        onStreamEvent: () => {},
      });

      if (!result.ok) {
        return reply.code(502).send({
          error: 'INVOKE_FAILED',
          message: result.error.message,
        });
      }

      return reply.code(201).send({
        message: result.assistantMessage.content,
        sessionId,
      });
    },
  );

  // GET /api/addon-proxy/config/:namespace
  app.get<{ Params: { namespace: string } }>(
    '/addon-proxy/config/:namespace',
    { preHandler: validateAddonToken },
    async (request, reply) => {
      const { namespace } = request.params;
      const addon = await opts.addonService.getAddon(request.addonId!);

      if (!addon) {
        return reply
          .code(404)
          .send({ error: 'ADDON_NOT_FOUND', message: 'Addon not found' });
      }

      const authResult = proxyService.authorize(addon, 'config.read');
      if (!authResult.authorized) {
        return reply
          .code(403)
          .send({ error: 'PERMISSION_DENIED', message: authResult.error });
      }

      await proxyService.recordUsage(request.addonId!, `/config/${namespace}`);

      return reply.send({
        namespace,
        config: {},
        message: 'Config retrieval placeholder',
      });
    },
  );

  // ==========================================================================
  // Storage (per-addon SQLite) — /addon-proxy/storage/*
  // ==========================================================================
  //
  // The addon's own iframe reaches its private SQLite file through these
  // routes. Reads require `storage.read`, writes require `storage.write`. The
  // schema (manifest.storage.migrations) is applied lazily by the engine on
  // first open, so tables exist even if the UI has never run.

  const getMigrations = (manifest: unknown): string[] => {
    const m = manifest as { storage?: { migrations?: string[] } } | null;
    return m?.storage?.migrations ?? [];
  };

  /**
   * Resolve the addon + authorize a storage permission. Returns the addon's
   * migrations on success, or null after having sent the error response.
   */
  const forStorage = async (
    request: FastifyRequest,
    reply: FastifyReply,
    permission: 'storage.read' | 'storage.write',
  ): Promise<{ migrations: string[] } | null> => {
    if (!opts.storageEngine) {
      reply
        .code(503)
        .send({
          error: 'SERVICE_UNAVAILABLE',
          message: 'Storage not available',
        });
      return null;
    }
    const addon = await opts.addonService.getAddon(request.addonId!);
    if (!addon) {
      reply
        .code(404)
        .send({ error: 'ADDON_NOT_FOUND', message: 'Addon not found' });
      return null;
    }
    const auth = proxyService.authorize(addon, permission);
    if (!auth.authorized) {
      reply.code(403).send({ error: 'PERMISSION_DENIED', message: auth.error });
      return null;
    }
    return { migrations: getMigrations(addon.manifest) };
  };

  /** Run a (synchronous) storage operation, mapping engine errors to HTTP. */
  const runStorage = (reply: FastifyReply, fn: () => unknown) => {
    try {
      return reply.send(fn());
    } catch (err) {
      if (err instanceof AddonStorageError) {
        return reply.code(400).send({ error: err.code, message: err.message });
      }
      return reply.code(500).send({
        error: 'STORAGE_ERROR',
        message: err instanceof Error ? err.message : 'Storage error',
      });
    }
  };

  // KV — list / get / set / delete
  app.get<{ Querystring: { prefix?: string } }>(
    '/addon-proxy/storage/kv',
    { preHandler: validateAddonToken },
    async (request, reply) => {
      const ctx = await forStorage(request, reply, 'storage.read');
      if (!ctx) return;
      await proxyService.recordUsage(request.addonId!, '/storage/kv');
      return runStorage(reply, () => ({
        items: opts.storageEngine!.kvList(
          request.addonId!,
          ctx.migrations,
          request.query.prefix,
        ),
      }));
    },
  );

  app.get<{ Params: { key: string } }>(
    '/addon-proxy/storage/kv/:key',
    { preHandler: validateAddonToken },
    async (request, reply) => {
      const ctx = await forStorage(request, reply, 'storage.read');
      if (!ctx) return;
      await proxyService.recordUsage(request.addonId!, '/storage/kv/:key');
      return runStorage(reply, () => ({
        value: opts.storageEngine!.kvGet(
          request.addonId!,
          ctx.migrations,
          request.params.key,
        ),
      }));
    },
  );

  app.put<{ Params: { key: string }; Body: { value: unknown } }>(
    '/addon-proxy/storage/kv/:key',
    { preHandler: validateAddonToken },
    async (request, reply) => {
      const ctx = await forStorage(request, reply, 'storage.write');
      if (!ctx) return;
      await proxyService.recordUsage(request.addonId!, '/storage/kv/:key');
      return runStorage(reply, () => {
        opts.storageEngine!.kvSet(
          request.addonId!,
          ctx.migrations,
          request.params.key,
          request.body?.value,
        );
        return { ok: true };
      });
    },
  );

  app.delete<{ Params: { key: string } }>(
    '/addon-proxy/storage/kv/:key',
    { preHandler: validateAddonToken },
    async (request, reply) => {
      const ctx = await forStorage(request, reply, 'storage.write');
      if (!ctx) return;
      await proxyService.recordUsage(request.addonId!, '/storage/kv/:key');
      return runStorage(reply, () => ({
        deleted: opts.storageEngine!.kvDelete(
          request.addonId!,
          ctx.migrations,
          request.params.key,
        ),
      }));
    },
  );

  // Raw SQL — query (read) / exec (write)
  app.post<{ Body: { sql: string; params?: StorageParams } }>(
    '/addon-proxy/storage/query',
    { preHandler: validateAddonToken },
    async (request, reply) => {
      const ctx = await forStorage(request, reply, 'storage.read');
      if (!ctx) return;
      const { sql, params } = request.body ?? {};
      if (typeof sql !== 'string') {
        return reply
          .code(400)
          .send({ error: 'INVALID_REQUEST', message: 'sql is required' });
      }
      await proxyService.recordUsage(request.addonId!, '/storage/query');
      return runStorage(reply, () => ({
        rows: opts.storageEngine!.query(
          request.addonId!,
          ctx.migrations,
          sql,
          params,
        ),
      }));
    },
  );

  app.post<{ Body: { sql: string; params?: StorageParams } }>(
    '/addon-proxy/storage/exec',
    { preHandler: validateAddonToken },
    async (request, reply) => {
      const ctx = await forStorage(request, reply, 'storage.write');
      if (!ctx) return;
      const { sql, params } = request.body ?? {};
      if (typeof sql !== 'string') {
        return reply
          .code(400)
          .send({ error: 'INVALID_REQUEST', message: 'sql is required' });
      }
      await proxyService.recordUsage(request.addonId!, '/storage/exec');
      return runStorage(reply, () =>
        opts.storageEngine!.exec(request.addonId!, ctx.migrations, sql, params),
      );
    },
  );

  // Full-text search over a declared FTS5 table
  app.post<{ Body: { table: string; match: string; limit?: number } }>(
    '/addon-proxy/storage/search',
    { preHandler: validateAddonToken },
    async (request, reply) => {
      const ctx = await forStorage(request, reply, 'storage.read');
      if (!ctx) return;
      const { table, match, limit } = request.body ?? {};
      if (typeof table !== 'string' || typeof match !== 'string') {
        return reply.code(400).send({
          error: 'INVALID_REQUEST',
          message: 'table and match are required',
        });
      }
      await proxyService.recordUsage(request.addonId!, '/storage/search');
      return runStorage(reply, () => ({
        rows: opts.storageEngine!.search(
          request.addonId!,
          ctx.migrations,
          table,
          match,
          limit,
        ),
      }));
    },
  );

  // Health check
  app.get('/addon-proxy/health', async (_, reply) => {
    return reply.send({ status: 'ok' });
  });
};
