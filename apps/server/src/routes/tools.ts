import type { FastifyPluginAsync } from 'fastify';
import type { BuiltinToolRegistry } from '../tools/registry';
import type { AuthMiddleware } from '../websocket/middleware/auth';
import { requireAuth } from '../middleware/require-auth';
import { TOOL_CATEGORY_MAP } from '../tools/catalog.js';

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
      category: TOOL_CATEGORY_MAP[t.name] ?? 'Other',
    }));
    return { items };
  });
};
