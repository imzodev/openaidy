import type { FastifyPluginAsync } from 'fastify';
import type { AgentRegistry } from '../agents/registry';
import type { AuthMiddleware } from '../websocket/middleware/auth';
import type { CreateAgentInput } from '../types';
import { requireAuth } from '../middleware/require-auth';

/**
 * Agent routes options
 */
export type AgentRoutesOptions = {
  agentRegistry: AgentRegistry;
  authMiddleware: AuthMiddleware;
};

export const agentRoutes: FastifyPluginAsync<AgentRoutesOptions> = async (
  app,
  options,
) => {
  const { agentRegistry, authMiddleware } = options;

  app.addHook(
    'preHandler',
    requireAuth({ authMiddleware, requiredScope: 'agents.list' }),
  );

  /**
   * GET /agents
   * List all enabled agents (summaries)
   */
  app.get('/agents', async () => {
    const agents = agentRegistry.listAgents();
    return { items: agents };
  });

  /**
   * GET /agents/:agentId
   * Get a specific agent by ID
   */
  app.get('/agents/:agentId', async (request, reply) => {
    const { agentId } = request.params as { agentId: string };
    const agent = agentRegistry.getAgent(agentId);

    if (!agent) {
      reply.code(404);
      return { error: 'Agent not found', agentId };
    }

    return agent;
  });

  /**
   * POST /agents
   * Create a new agent.
   * Body: Agent object (id, name, enabled, systemPrompt, model required)
   */
  app.post('/agents', async (request, reply) => {
    const body = request.body as Record<string, unknown>;

    try {
      const agent = agentRegistry.createAgent(body as CreateAgentInput);
      reply.code(201);
      return agent;
    } catch (err) {
      reply.code(400);
      return {
        error: err instanceof Error ? err.message : 'Failed to create agent',
      };
    }
  });

  /**
   * PATCH /agents/:agentId/tools
   * Update the builtin tools list for an agent.
   * Body: { tools: string[] }
   */
  app.patch('/agents/:agentId/tools', async (request, reply) => {
    const { agentId } = request.params as { agentId: string };
    const body = request.body as { tools?: unknown };

    if (
      !Array.isArray(body?.tools) ||
      body.tools.some((t) => typeof t !== 'string')
    ) {
      reply.code(400);
      return { error: 'Invalid request: tools must be an array of strings' };
    }

    const result = agentRegistry.updateAgentTools(
      agentId,
      body.tools as string[],
    );
    if (!result) {
      reply.code(404);
      return { error: 'Agent not found', agentId };
    }

    return result;
  });
};
