import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { isAbsolute, join, normalize, relative, sep } from 'node:path';
import type { BuiltinTool } from '@openaidy/runtime';
import type { SkillRegistry } from '../../skills/index.js';
import { sanitizeSkillBody } from '../../skills/sanitize.js';
import type { AgentRegistry } from '../../agents/registry.js';
import type { WorkspaceService } from '../../workspace/service.js';
import { skillReadMeta } from '../catalog.js';

const MAX_FILE_CHARS = 50_000;

/**
 * skill_read
 *
 * Loads one assigned skill's instructions on demand, so the system prompt only
 * has to carry the skill index instead of every skill body. Global skills live
 * outside the agent workspace, which is why workspace_read cannot be used.
 * A skill in the agent's own workspace shadows a global one with the same id.
 */
export function createSkillReadTool(
  skillRegistry: SkillRegistry,
  agentRegistry: AgentRegistry,
  workspace: WorkspaceService,
): BuiltinTool {
  return {
    name: skillReadMeta.name,
    description: skillReadMeta.description,
    parameters: {
      type: 'object',
      properties: {
        skill_id: {
          type: 'string',
          description: 'Id of the skill, as listed in [SKILLS_AVAILABLE].',
        },
        file: {
          type: 'string',
          description:
            'Optional companion file inside the skill folder (e.g. "examples.md"). Omit to read SKILL.md.',
        },
      },
      required: ['skill_id'],
    },
    async execute(args, ctx) {
      const skillId =
        typeof args['skill_id'] === 'string' ? args['skill_id'] : '';
      const file = typeof args['file'] === 'string' ? args['file'] : undefined;
      if (!skillId || skillId.includes('/') || skillId.includes('\\')) {
        return { ok: false, error: 'skill_id must be a plain skill id.' };
      }

      const assigned = agentRegistry.getAgent(ctx.agentId)?.skills ?? [];
      if (!assigned.includes(skillId)) {
        return {
          ok: false,
          error: `Skill "${skillId}" is not assigned to you. Assigned skills: ${assigned.join(', ') || 'none'}.`,
        };
      }

      const workspaceDir = join(
        workspace.getWorkspacePath(ctx.agentId),
        'skills',
        skillId,
      );
      const globalDir = join(skillRegistry.getSkillsDir(), skillId);
      const skillDir = existsSync(join(workspaceDir, 'SKILL.md'))
        ? workspaceDir
        : globalDir;

      if (!file) {
        const global = skillRegistry.getSkill(skillId);
        let body: string;
        if (skillDir === globalDir && global) {
          body = global.body;
        } else {
          try {
            body = await readFile(join(skillDir, 'SKILL.md'), 'utf-8');
          } catch (_err) {
            return { ok: false, error: `Skill "${skillId}" was not found.` };
          }
        }
        const companions = await listCompanionFiles(skillDir);
        const footer = companions.length
          ? `\n\n---\nCompanion files (read with skill_read file=...): ${companions.join(', ')}`
          : '';
        return { ok: true, content: sanitizeSkillBody(body) + footer };
      }

      const target = normalize(join(skillDir, file));
      const rel = relative(skillDir, target);
      if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
        return {
          ok: false,
          error: 'file must be a path inside the skill folder.',
        };
      }
      try {
        const content = await readFile(target, 'utf-8');
        return {
          ok: true,
          content:
            content.length > MAX_FILE_CHARS
              ? `${content.slice(0, MAX_FILE_CHARS)}\n[truncated: ${content.length} characters total]`
              : content,
        };
      } catch (_err) {
        return {
          ok: false,
          error: `File "${rel.split(sep).join('/')}" was not found in skill "${skillId}".`,
        };
      }
    },
  };
}

async function listCompanionFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name !== 'SKILL.md')
      .map((e) => e.name);
  } catch (_err) {
    return [];
  }
}
