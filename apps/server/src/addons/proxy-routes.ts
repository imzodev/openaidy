import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import type { AuthMiddleware } from '../websocket/middleware/auth';
import type { AddonService } from '../addons/service';
import { createAddonProxyService } from '../addons/proxy';

export type AddonProxyRoutesOptions = {
  addonService: AddonService;
  authMiddleware: AuthMiddleware;
  internalApiBaseUrl: string;
};

interface InvokeAgentBody {
  input: string;
  context?: Record<string, unknown>;
}

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
      const { input, context } = request.body;

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
        return reply
          .code(403)
          .send({
            error: 'AGENT_NOT_ALLOWED',
            message: `Access to agent ${agentId} not allowed`,
          });
      }

      await proxyService.recordUsage(
        request.addonId!,
        `/agents/${agentId}/invoke`,
      );

      return reply.send({
        success: true,
        agentId,
        input,
        context,
        message: 'Agent invocation placeholder',
      });
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

      const authResult = proxyService.authorize(addon, 'sessions.read');
      if (!authResult.authorized) {
        return reply
          .code(403)
          .send({ error: 'PERMISSION_DENIED', message: authResult.error });
      }

      await proxyService.recordUsage(request.addonId!, '/sessions');

      return reply.send({
        sessions: [],
        message: 'Session listing placeholder',
      });
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

      return reply
        .code(201)
        .send({
          id: 'placeholder',
          title: request.body.title ?? 'New Session',
          message: 'Session creation placeholder',
        });
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
