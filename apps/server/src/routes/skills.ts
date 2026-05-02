import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyPluginAsync } from 'fastify';
import type { AgentRegistry } from '../agents/registry';
import type { AuthMiddleware } from '../websocket/middleware/auth';
import type { SkillRegistry, SkillSummary } from '../skills';
import type { WorkspaceService } from '../workspace/service';
import { parseSkillMd } from '../skills/parser';
import { requireAuth } from '../middleware/require-auth';

/**
 * Skill routes options
 */
export type SkillRoutesOptions = {
  skillRegistry: SkillRegistry;
  agentRegistry: AgentRegistry;
  authMiddleware: AuthMiddleware;
  workspace: WorkspaceService;
};

export const skillRoutes: FastifyPluginAsync<SkillRoutesOptions> = async (
  app,
  options,
) => {
  const { skillRegistry, agentRegistry, authMiddleware, workspace } = options;

  /**
   * GET /skills
   * List all installed skills.
   */
  app.get('/skills', async () => {
    const skills = skillRegistry.listSkills();
    return { items: skills };
  });

  /**
   * GET /agents/:agentId/skills
   * List global skills merged with skills created in the agent's workspace.
   * Workspace skills override global skills with the same ID.
   */
  app.get('/agents/:agentId/skills', async (request, reply) => {
    const { agentId } = request.params as { agentId: string };

    if (!agentRegistry.hasAgent(agentId)) {
      reply.code(404);
      return { error: 'Agent not found', agentId };
    }

    const globalSkills = skillRegistry.listSkills();
    const merged = new Map<string, SkillSummary>(
      globalSkills.map((s) => [s.id, s]),
    );

    const agentSkillsDir = join(workspace.getWorkspacePath(agentId), 'skills');
    if (existsSync(agentSkillsDir)) {
      let subdirs: string[];
      try {
        subdirs = readdirSync(agentSkillsDir);
      } catch {
        subdirs = [];
      }
      for (const id of subdirs) {
        const skillFile = join(agentSkillsDir, id, 'SKILL.md');
        if (!existsSync(skillFile)) continue;
        try {
          const content = readFileSync(skillFile, 'utf-8');
          const result = parseSkillMd(content, id, skillFile);
          if ('errors' in result) continue;
          merged.set(id, {
            id: result.id,
            name: result.name,
            description: result.description,
          });
        } catch {
          // skip unreadable files
        }
      }
    }

    return { items: Array.from(merged.values()) };
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

    // Validate that all skill IDs actually exist (global or agent workspace)
    if (skillIds.length > 0) {
      const globalSkillIds = new Set(
        skillRegistry.listSkills().map((s) => s.id),
      );
      const agentSkillsDir = join(
        workspace.getWorkspacePath(agentId),
        'skills',
      );
      const workspaceSkillIds = new Set<string>();
      if (existsSync(agentSkillsDir)) {
        try {
          for (const id of readdirSync(agentSkillsDir)) {
            if (existsSync(join(agentSkillsDir, id, 'SKILL.md'))) {
              workspaceSkillIds.add(id);
            }
          }
        } catch {
          // ignore
        }
      }
      const invalidSkills = skillIds.filter(
        (id) => !globalSkillIds.has(id) && !workspaceSkillIds.has(id),
      );
      if (invalidSkills.length > 0) {
        reply.code(400);
        return {
          error: 'Unknown skill(s)',
          invalidSkills,
          hint: `Use GET /agents/${agentId}/skills to list all available skills`,
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
