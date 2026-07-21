import type { FastifyPluginAsync } from 'fastify';
import type { AgentRegistry } from '../agents/registry';
import type { AuthMiddleware } from '../websocket/middleware/auth';
import type { CreateAgentInput } from '../types';
import type { McpServerRef, PersonalityFileId } from '@openaidy/shared-types';
import type { AgentPersonalityService } from '../agents/personality-service';
import { PERSONALITY_FILES } from '../agents/personality-service';
import { requireAuth } from '../middleware/require-auth';

/**
 * Agent routes options
 */
export type AgentRoutesOptions = {
  agentRegistry: AgentRegistry;
  personalityService: AgentPersonalityService;
  authMiddleware: AuthMiddleware;
};

export const agentRoutes: FastifyPluginAsync<AgentRoutesOptions> = async (
  app,
  options,
) => {
  const { agentRegistry, personalityService, authMiddleware } = options;

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
      // Scaffold personality files for the new agent (fire and forget — non-fatal)
      personalityService.scaffold(agent.id).catch(() => {});
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
   * Delete an agent by ID. Also removes the agent's workspace directory.
   */
  app.delete('/agents/:agentId', async (request, reply) => {
    const { agentId } = request.params as { agentId: string };
    const deleted = agentRegistry.deleteAgent(agentId);
    if (!deleted) {
      reply.code(404);
      return { error: 'Agent not found', agentId };
    }
    await personalityService?.deleteWorkspace(agentId).catch(() => {});
    return { deleted };
  });

  /**
   * GET /agents/:agentId/personality
   * List all personality file metadata for an agent.
   */
  app.get('/agents/:agentId/personality', async (request, reply) => {
    const { agentId } = request.params as { agentId: string };
    if (!agentRegistry.hasAgent(agentId)) {
      reply.code(404);
      return { error: 'Agent not found', agentId };
    }
    return { files: PERSONALITY_FILES };
  });

  /**
   * GET /agents/:agentId/personality/:fileId
   * Read a specific personality file (AGENT, USER, MISSION, RULES).
   */
  app.get('/agents/:agentId/personality/:fileId', async (request, reply) => {
    const { agentId, fileId } = request.params as {
      agentId: string;
      fileId: string;
    };
    if (!agentRegistry.hasAgent(agentId)) {
      reply.code(404);
      return { error: 'Agent not found', agentId };
    }
    const valid = PERSONALITY_FILES.find((f) => f.id === fileId);
    if (!valid) {
      reply.code(400);
      return { error: `Unknown personality file: ${fileId}` };
    }
    const file = await personalityService.readFile(
      agentId,
      fileId as PersonalityFileId,
    );
    return file;
  });

  /**
   * PUT /agents/:agentId/personality/:fileId
   * Write (create or overwrite) a personality file.
   * Body: { content: string }
   */
  app.put('/agents/:agentId/personality/:fileId', async (request, reply) => {
    const { agentId, fileId } = request.params as {
      agentId: string;
      fileId: string;
    };
    if (!agentRegistry.hasAgent(agentId)) {
      reply.code(404);
      return { error: 'Agent not found', agentId };
    }
    const valid = PERSONALITY_FILES.find((f) => f.id === fileId);
    if (!valid) {
      reply.code(400);
      return { error: `Unknown personality file: ${fileId}` };
    }
    const body = request.body as { content?: unknown };
    if (typeof body?.content !== 'string') {
      reply.code(400);
      return { error: 'Invalid request: content must be a string' };
    }
    await personalityService.writeFile(
      agentId,
      fileId as PersonalityFileId,
      body.content,
    );
    return { ok: true };
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
