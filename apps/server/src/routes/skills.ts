import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyPluginAsync } from 'fastify';
import type { SkillLoadError } from '@openaidy/shared-types';
import type { AgentRegistry } from '../agents/registry';
import type { AuthMiddleware } from '../websocket/middleware/auth';
import type { SkillRegistry } from '../skills';
import type { WorkspaceService } from '../workspace/service';
import type { SkillSource, EnrichedSkillInfo } from '../types';
import { parseSkillMd } from '../skills/parser';
import { readSeedManifest } from '../skills/seed';
import { requireAuth } from '../middleware/require-auth';

/**
 * Skill routes options
 */
export type SkillRoutesOptions = {
  skillRegistry: SkillRegistry;
  agentRegistry: AgentRegistry;
  authMiddleware: AuthMiddleware;
  workspace: WorkspaceService;
  skillsDir: string;
};

/**
 * Return skill IDs present in an agent's workspace skills directory.
 */
function readAgentWorkspaceSkillIds(agentSkillsDir: string): Set<string> {
  const ids = new Set<string>();
  if (!existsSync(agentSkillsDir)) return ids;
  try {
    for (const id of readdirSync(agentSkillsDir)) {
      if (existsSync(join(agentSkillsDir, id, 'SKILL.md'))) {
        ids.add(id);
      }
    }
  } catch {
    // ignore unreadable directory
  }
  return ids;
}

/**
 * Parse all SKILL.md files in an agent's workspace skills directory.
 *
 * Returns BOTH the skills that parsed cleanly and the validation errors
 * for the ones that did not. Callers must surface the errors — silently
 * dropping them is what hid the broken `minimax-image-gen` skill from the
 * UI for so long.
 */
function scanAgentWorkspaceSkills(agentSkillsDir: string): {
  skills: Array<{ id: string; name: string; description: string }>;
  errors: SkillLoadError[];
} {
  const skills: Array<{ id: string; name: string; description: string }> = [];
  // `agentId` is filled in by the caller, which knows which agent this
  // directory belongs to.
  const errors: SkillLoadError[] = [];
  if (!existsSync(agentSkillsDir)) return { skills, errors };
  let subdirs: string[];
  try {
    subdirs = readdirSync(agentSkillsDir);
  } catch {
    return { skills, errors };
  }
  for (const id of subdirs) {
    const skillFile = join(agentSkillsDir, id, 'SKILL.md');
    if (!existsSync(skillFile)) continue;
    let content: string;
    try {
      content = readFileSync(skillFile, 'utf-8');
    } catch {
      // Unreadable file — record as an error rather than silently dropping it.
      errors.push({
        id,
        filePath: skillFile,
        messages: ['Failed to read SKILL.md'],
      });
      continue;
    }
    const result = parseSkillMd(content, id, skillFile);
    if ('errors' in result) {
      errors.push({
        id,
        filePath: skillFile,
        messages: result.errors.map((e) => e.message),
      });
      continue;
    }
    skills.push({
      id: result.id,
      name: result.name,
      description: result.description,
    });
  }
  return { skills, errors };
}

export const skillRoutes: FastifyPluginAsync<SkillRoutesOptions> = async (
  app,
  options,
) => {
  const { skillRegistry, agentRegistry, authMiddleware, workspace, skillsDir } =
    options;

  /**
   * GET /skills
   * List all skills: global (with source tags) + all agent workspace skills.
   */
  app.get('/skills', async () => {
    const manifest = readSeedManifest(skillsDir);
    const items: EnrichedSkillInfo[] = [];
    const loadErrors: SkillLoadError[] = [];

    // Global skills with source tags
    for (const skill of skillRegistry.listSkills()) {
      const skillFile = join(skillsDir, skill.id, 'SKILL.md');
      const manifestKey = `${skill.id}/SKILL.md`;
      const entry = manifest[manifestKey];
      let source: SkillSource;
      if (entry === undefined) {
        source = 'user-global';
      } else {
        let currentHash: string;
        try {
          currentHash = createHash('sha256')
            .update(readFileSync(skillFile))
            .digest('hex');
        } catch {
          currentHash = '';
        }
        source = currentHash === entry.hash ? 'preinstalled' : 'modified';
      }
      items.push({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        source,
      });
    }

    // Skills whose SKILL.md failed validation in the GLOBAL registry.
    for (const err of skillRegistry.getLoadErrors()) {
      loadErrors.push(err);
    }

    // Agent workspace skills — both the valid ones (added to items) and
    // the ones that failed validation (added to loadErrors with agentId).
    // Walking both per-agent keeps the data model simple and ensures that
    // a broken workspace SKILL.md is never silently invisible.
    for (const agent of agentRegistry.listAllAgents()) {
      const agentSkillsDir = join(
        workspace.getWorkspacePath(agent.id),
        'skills',
      );
      const { skills, errors } = scanAgentWorkspaceSkills(agentSkillsDir);
      for (const skill of skills) {
        items.push({ ...skill, source: 'agent', agentId: agent.id });
      }
      for (const err of errors) {
        loadErrors.push({ ...err, agentId: agent.id });
      }
    }

    return { items, loadErrors };
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
    const merged = new Map<
      string,
      { id: string; name: string; description: string }
    >(globalSkills.map((s) => [s.id, s]));

    const agentSkillsDir = join(workspace.getWorkspacePath(agentId), 'skills');
    const { skills: agentSkills } = scanAgentWorkspaceSkills(agentSkillsDir);
    for (const skill of agentSkills) {
      merged.set(skill.id, skill);
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
      const workspaceSkillIds = readAgentWorkspaceSkillIds(agentSkillsDir);
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
