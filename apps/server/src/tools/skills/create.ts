import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BuiltinTool } from '@openaidy/runtime';
import { parseSkillMd } from '../../skills/parser.js';
import type { SkillRegistry } from '../../skills/index.js';

/**
 * skill_create
 *
 * Lets an agent create a new skill in the shared skills directory.
 * The skill is written as a properly formatted SKILL.md file and
 * immediately registered in the SkillRegistry so it is available
 * without a server restart.
 */
export function createSkillCreateTool(
  skillRegistry: SkillRegistry,
  skillsDir: string,
): BuiltinTool {
  return {
    name: 'skill_create',
    description:
      'Create a new skill and save it to the skills directory. ' +
      'A skill is a reusable set of instructions that can be assigned to agents. ' +
      'The skill is immediately available after creation.',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description:
            'Unique identifier for the skill (lowercase, hyphens allowed, e.g. "summarize-text"). ' +
            'Must not already exist.',
        },
        name: {
          type: 'string',
          description: 'Human-readable display name for the skill.',
        },
        description: {
          type: 'string',
          description:
            'One-line description of what this skill instructs the agent to do.',
        },
        version: {
          type: 'string',
          description:
            'Semver version string (e.g. "1.0.0"). Defaults to "1.0.0" if omitted.',
        },
        body: {
          type: 'string',
          description:
            'The skill instructions — written as plain text or Markdown. ' +
            'This text will be appended to the agent system prompt when the skill is active.',
        },
      },
      required: ['id', 'name', 'description', 'body'],
    },

    async execute(args, ctx) {
      const id = args['id'];
      const name = args['name'];
      const description = args['description'];
      const version =
        typeof args['version'] === 'string' && args['version']
          ? args['version']
          : '1.0.0';
      const body = args['body'];

      if (typeof id !== 'string' || !id) {
        return {
          ok: false,
          error: 'id is required and must be a non-empty string',
        };
      }
      if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
        return {
          ok: false,
          error:
            'id must be lowercase alphanumeric with hyphens only (e.g. "my-skill")',
        };
      }
      if (typeof name !== 'string' || !name) {
        return {
          ok: false,
          error: 'name is required and must be a non-empty string',
        };
      }
      if (typeof description !== 'string' || !description) {
        return {
          ok: false,
          error: 'description is required and must be a non-empty string',
        };
      }
      if (typeof body !== 'string' || !body) {
        return {
          ok: false,
          error: 'body is required and must be a non-empty string',
        };
      }

      if (skillRegistry.getSkill(id)) {
        return { ok: false, error: `Skill "${id}" already exists` };
      }

      const content = `---\nname: ${name}\ndescription: ${description}\nversion: ${version}\ncreated_by: ${ctx.agentId}\n---\n\n${body}\n`;

      const skillFilePath = join(skillsDir, id, 'SKILL.md');
      const skillDirPath = join(skillsDir, id);

      const parsed = parseSkillMd(content, id, skillFilePath);
      if ('errors' in parsed) {
        return {
          ok: false,
          error: `Invalid skill content: ${parsed.errors.map((e) => e.message).join(', ')}`,
        };
      }

      try {
        await mkdir(skillDirPath, { recursive: true });
        await writeFile(skillFilePath, content, 'utf-8');
      } catch (err) {
        return {
          ok: false,
          error: `Failed to write skill file: ${err instanceof Error ? err.message : String(err)}`,
        };
      }

      skillRegistry.register(parsed);

      return {
        ok: true,
        content: `Skill "${id}" created successfully. It is now available to assign to agents.`,
      };
    },
  };
}
