import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import type { AddonProxyRoutesOptions, InvokeAgentBody } from './types';
import { createAddonProxyService } from '../addons/proxy';
import { AddonProxyAgentService } from './proxy-agent-service';

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
    '/api/addon-proxy/agents/:agentId/invoke',
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
    '/api/addon-proxy/agents',
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
    '/api/addon-proxy/sessions',
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

  // POST /api/addon-proxy/sessions
  app.post<{ Body: { title?: string } }>(
    '/api/addon-proxy/sessions',
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

      await proxyService.recordUsage(request.addonId!, '/sessions');

      if (!opts.sessionService) {
        return reply.code(503).send({
          error: 'SERVICE_UNAVAILABLE',
          message: 'Session service not available',
        });
      }

      const session = await opts.sessionService.createSession(
        request.body.title ?? 'New Session',
      );
      return reply.code(201).send(session);
    },
  );

  // GET /api/addon-proxy/config/:namespace
  app.get<{ Params: { namespace: string } }>(
    '/api/addon-proxy/config/:namespace',
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

  // Health check
  app.get('/api/addon-proxy/health', async (_, reply) => {
    return reply.send({ status: 'ok' });
  });
};
