import type { FastifyPluginAsync } from 'fastify';
import type { AgentRegistry } from '../agents/registry';
import type { AuthMiddleware } from '../websocket/middleware/auth';
import type { CreateAgentInput } from '../types';
import type { McpServerRef } from '@openaidy/shared-types';
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
   * DELETE /agents/:agentId
   * Delete an agent by ID.
   */
  app.delete('/agents/:agentId', async (request, reply) => {
    const { agentId } = request.params as { agentId: string };
    const deleted = agentRegistry.deleteAgent(agentId);
    if (!deleted) {
      reply.code(404);
      return { error: 'Agent not found', agentId };
    }
    return { deleted };
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

  /**
   * PATCH /agents/:agentId/mcp-servers
   * Update the MCP server references for an agent.
   * Body: { mcpServers: Array<{ id: string; tools?: string[] }> }
   */
  app.patch('/agents/:agentId/mcp-servers', async (request, reply) => {
    const { agentId } = request.params as { agentId: string };
    const body = request.body as { mcpServers?: unknown };

    if (!Array.isArray(body?.mcpServers)) {
      reply.code(400);
      return {
        error: 'Invalid request: mcpServers must be an array',
      };
    }

    const isValidRef = (ref: unknown): ref is McpServerRef => {
      if (!ref || typeof ref !== 'object') return false;
      const r = ref as Record<string, unknown>;
      if (typeof r['id'] !== 'string' || r['id'].length === 0) return false;
      if (r['tools'] !== undefined) {
        if (
          !Array.isArray(r['tools']) ||
          r['tools'].some((t) => typeof t !== 'string')
        )
          return false;
      }
      return true;
    };

    if (!body.mcpServers.every(isValidRef)) {
      reply.code(400);
      return {
        error:
          'Invalid request: each mcpServer must have a string id and an optional tools string array',
      };
    }

    const result = agentRegistry.updateAgentMcpServers(
      agentId,
      body.mcpServers as McpServerRef[],
    );
    if (!result) {
      reply.code(404);
      return { error: 'Agent not found', agentId };
    }

    return result;
  });
};
