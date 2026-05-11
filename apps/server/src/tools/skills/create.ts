import { mkdir, writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import type { BuiltinTool } from '@openaidy/runtime';
import { parseSkillMd } from '../../skills/parser.js';
import type { SkillRegistry } from '../../skills/index.js';
import type { WorkspaceService } from '../../workspace/service.js';
import { skillCreateMeta } from '../catalog.js';

/**
 * skill_create
 *
 * Lets an agent create a new skill in its own workspace skills directory.
 * The skill is written as a properly formatted SKILL.md file and
 * immediately registered in the SkillRegistry so it is available
 * without a server restart.
 *
 * Companion files (scripts, configs, .env.example, reference docs, etc.)
 * can be written alongside SKILL.md by passing them in the `files` map.
 * The skill body can then reference these files by name.
 */
export function createSkillCreateTool(
  skillRegistry: SkillRegistry,
  workspace: WorkspaceService,
): BuiltinTool {
  return {
    name: skillCreateMeta.name,
    description: skillCreateMeta.description,
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
            'This text will be appended to the agent system prompt when the skill is active. ' +
            'Reference companion files by their filename (e.g. "see script.py for the implementation").',
        },
        files: {
          type: 'object',
          description:
            'Optional companion files to write into the skill folder alongside SKILL.md. ' +
            'Keys are filenames (e.g. "script.py", "config.json", ".env.example"), ' +
            'values are the file contents as strings. Filenames must not contain path separators.',
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
      const filesArg = args['files'];
      const companionFiles: Record<string, string> =
        filesArg !== null &&
        filesArg !== undefined &&
        typeof filesArg === 'object' &&
        !Array.isArray(filesArg)
          ? (filesArg as Record<string, string>)
          : {};

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

      // Validate companion filenames — no path traversal, no overwriting SKILL.md
      for (const filename of Object.keys(companionFiles)) {
        if (
          basename(filename) !== filename ||
          filename.includes('/') ||
          filename.includes('\\')
        ) {
          return {
            ok: false,
            error: `Companion file name "${filename}" must be a plain filename with no path separators`,
          };
        }
        if (filename.toUpperCase() === 'SKILL.MD') {
          return {
            ok: false,
            error:
              'Use the body parameter to set SKILL.md content — do not pass it as a companion file',
          };
        }
        if (typeof companionFiles[filename] !== 'string') {
          return {
            ok: false,
            error: `Companion file "${filename}" must have string content`,
          };
        }
      }

      const content = `---\nname: ${name}\ndescription: ${description}\nversion: ${version}\ncreated_by: ${ctx.agentId}\n---\n\n${body}\n`;

      const agentSkillsDir = join(
        workspace.getWorkspacePath(ctx.agentId),
        'skills',
      );
      const skillFilePath = join(agentSkillsDir, id, 'SKILL.md');
      const skillDirPath = join(agentSkillsDir, id);

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

        for (const [filename, fileContent] of Object.entries(companionFiles)) {
          await writeFile(join(skillDirPath, filename), fileContent, 'utf-8');
        }
      } catch (err) {
        return {
          ok: false,
          error: `Failed to write skill file: ${err instanceof Error ? err.message : String(err)}`,
        };
      }

      skillRegistry.register(parsed);

      const companionList = Object.keys(companionFiles);
      const companionNote =
        companionList.length > 0
          ? ` Companion files written: ${companionList.join(', ')}.`
          : '';

      return {
        ok: true,
        content: `Skill "${id}" created successfully.${companionNote} It is now available to assign to agents.`,
      };
    },
  };
}
