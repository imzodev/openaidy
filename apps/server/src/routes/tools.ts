import type { FastifyPluginAsync } from 'fastify';
import type { BuiltinToolRegistry } from '../tools/registry';
import type { AuthMiddleware } from '../websocket/middleware/auth';
import { requireAuth } from '../middleware/require-auth';

export type ToolRoutesOptions = {
  builtinTools: BuiltinToolRegistry;
  authMiddleware: AuthMiddleware;
};

export const toolRoutes: FastifyPluginAsync<ToolRoutesOptions> = async (
  app,
  options,
) => {
  const { builtinTools, authMiddleware } = options;

  app.addHook(
    'preHandler',
    requireAuth({ authMiddleware, requiredScope: 'agents.list' }),
  );

  /**
   * GET /tools
   * List all available builtin (native) tools with name and description.
   */
  app.get('/tools', async () => {
    const items = builtinTools.getAllDefinitions().map((t) => ({
      name: t.name,
      description: t.description,
    }));
    return { items };
  });
};
