import type { FastifyPluginAsync } from 'fastify';
import type { AgentRegistry } from '../agents/registry';

/**
 * Agent routes options
 */
export type AgentRoutesOptions = {
  agentRegistry: AgentRegistry;
};

export const agentRoutes: FastifyPluginAsync<AgentRoutesOptions> = async (app, options) => {
  const { agentRegistry } = options;

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
};
