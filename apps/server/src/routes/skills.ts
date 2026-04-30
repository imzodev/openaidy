import type { FastifyPluginAsync } from 'fastify';
import type { AgentRegistry } from '../agents/registry';
import type { AuthMiddleware } from '../websocket/middleware/auth';
import type { SkillRegistry } from '../skills';
import { requireAuth } from '../middleware/require-auth';

/**
 * Skill routes options
 */
export type SkillRoutesOptions = {
  skillRegistry: SkillRegistry;
  agentRegistry: AgentRegistry;
  authMiddleware: AuthMiddleware;
};

export const skillRoutes: FastifyPluginAsync<SkillRoutesOptions> = async (
  app,
  options,
) => {
  const { skillRegistry, agentRegistry, authMiddleware } = options;

  /**
   * GET /skills
   * List all installed skills.
   */
  app.get('/skills', async () => {
    const skills = skillRegistry.listSkills();
    return { items: skills };
  });

  app.addHook(
    'preHandler',
    requireAuth({ authMiddleware, requiredScope: 'agents.list' }),
  );

  /**
   * PATCH /agents/:agentId/skills
   * Assign (or clear) skills for an agent.
   * Body: { skills: string[] }
   */
  app.patch('/agents/:agentId/skills', async (request, reply) => {
    const { agentId } = request.params as { agentId: string };
    const body = request.body as { skills?: unknown };

    if (
      !Array.isArray(body?.skills) ||
      body.skills.some((t) => typeof t !== 'string')
    ) {
      reply.code(400);
      return {
        error: 'Invalid request: skills must be an array of strings',
      };
    }

    const skillIds = body.skills as string[];

    // Validate that all skill IDs actually exist in the registry
    if (skillIds.length > 0) {
      const validSkillIds = new Set(
        skillRegistry.listSkills().map((s) => s.id),
      );
      const invalidSkills = skillIds.filter((id) => !validSkillIds.has(id));
      if (invalidSkills.length > 0) {
        reply.code(400);
        return {
          error: 'Unknown skill(s)',
          invalidSkills,
          hint: 'Use GET /skills to list all available skills',
        };
      }
    }

    const result = agentRegistry.updateAgentSkills(agentId, skillIds);
    if (!result) {
      reply.code(404);
      return { error: 'Agent not found', agentId };
    }

    return result;
  });
};
