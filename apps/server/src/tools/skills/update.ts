import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { BuiltinTool } from '@openaidy/runtime';
import { parseSkillMd } from '../../skills/parser.js';
import type { SkillRegistry } from '../../skills/index.js';
import type { WorkspaceService } from '../../workspace/service.js';
import { skillUpdateMeta } from '../catalog.js';

/**
 * skill_update
 *
 * Lets an agent modify an existing skill in its own workspace skills directory.
 * The skill is rewritten as a properly formatted SKILL.md and immediately
 * re-registered in the SkillRegistry so the change is live without a restart.
 *
 * Companion files: the `files` map is merged (add or overwrite by filename);
 * files not mentioned are preserved. Pass `deleteFiles` to explicitly remove
 * companion files. This is intentionally NOT a replace-all operation so that
 * a partial update cannot silently destroy unseen files.
 *
 * Preserves the original `created_by` frontmatter and stamps `updated_by`
 * (the calling agent) plus `updated_at` (ISO 8601) on every successful update.
 */
export function createSkillUpdateTool(
  skillRegistry: SkillRegistry,
  workspace: WorkspaceService,
): BuiltinTool {
  return {
    name: skillUpdateMeta.name,
    description: skillUpdateMeta.description,
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description:
            'Identifier of the skill to update (e.g. "summarize-text"). ' +
            'Must already exist.',
        },
        name: {
          type: 'string',
          description: 'New human-readable display name (replaces current).',
        },
        description: {
          type: 'string',
          description: 'New one-line description (replaces current).',
        },
        version: {
          type: 'string',
          description:
            'New semver version string (e.g. "1.1.0"). Replaces current version.',
        },
        body: {
          type: 'string',
          description:
            'New skill instructions — plain text or Markdown. ' +
            'Replaces the current body in full.',
        },
        files: {
          type: 'object',
          description:
            'Companion files to add or overwrite inside the skill folder. ' +
            'Keys are filenames, values are file contents as strings. ' +
            'Filenames must be plain (no path separators). ' +
            'Files NOT mentioned here are preserved unchanged.',
        },
        deleteFiles: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Companion files to delete from the skill folder. ' +
            'Each entry must be a plain filename (no path separators). ' +
            'Only the named files are removed; others are preserved.',
        },
      },
      required: ['id'],
    },

    async execute(args, ctx) {
      const id = args['id'];
      const name = args['name'];
      const description = args['description'];
      const version = args['version'];
      const body = args['body'];
      const filesArg = args['files'];
      const deleteFilesArg = args['deleteFiles'];

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

      const hasName = typeof name === 'string' && name.length > 0;
      const hasDescription =
        typeof description === 'string' && description.length > 0;
      const hasVersion = typeof version === 'string' && version.length > 0;
      const hasBody = typeof body === 'string' && body.length > 0;
      const filesMap: Record<string, string> | null =
        filesArg !== null &&
        filesArg !== undefined &&
        typeof filesArg === 'object' &&
        !Array.isArray(filesArg)
          ? (filesArg as Record<string, string>)
          : null;
      const hasFiles = filesMap !== null && Object.keys(filesMap).length > 0;
      const deleteFiles: string[] = Array.isArray(deleteFilesArg)
        ? deleteFilesArg.filter((f): f is string => typeof f === 'string')
        : [];
      const hasDeleteFiles = deleteFiles.length > 0;

      if (
        !hasName &&
        !hasDescription &&
        !hasVersion &&
        !hasBody &&
        !hasFiles &&
        !hasDeleteFiles
      ) {
        return {
          ok: false,
          error:
            'No fields to update. Provide at least one of: name, description, version, body, files, deleteFiles.',
        };
      }

      if (filesMap) {
        for (const [filename, content] of Object.entries(filesMap)) {
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
                'Use the body parameter to change SKILL.md content — do not pass it as a companion file',
            };
          }
          if (typeof content !== 'string') {
            return {
              ok: false,
              error: `Companion file "${filename}" must have string content`,
            };
          }
        }
      }

      for (const filename of deleteFiles) {
        if (
          basename(filename) !== filename ||
          filename.includes('/') ||
          filename.includes('\\')
        ) {
          return {
            ok: false,
            error: `deleteFiles entry "${filename}" must be a plain filename with no path separators`,
          };
        }
        if (filename.toUpperCase() === 'SKILL.MD') {
          return {
            ok: false,
            error: 'SKILL.md cannot be deleted — it is the skill itself',
          };
        }
      }

      const agentSkillsDir = join(
        workspace.getWorkspacePath(ctx.agentId),
        'skills',
      );
      const skillDirPath = join(agentSkillsDir, id);
      const skillFilePath = join(skillDirPath, 'SKILL.md');

      let existingContent: string;
      try {
        existingContent = await readFile(skillFilePath, 'utf-8');
      } catch {
        return {
          ok: false,
          error: `Skill "${id}" does not exist. Use skill_create to create it.`,
        };
      }

      const existingParsed = parseSkillMd(existingContent, id, skillFilePath);
      if ('errors' in existingParsed) {
        return {
          ok: false,
          error: `Existing SKILL.md is invalid: ${existingParsed.errors.map((e) => e.message).join(', ')}`,
        };
      }

      const createdBy = extractFrontmatterField(existingContent, 'created_by');
      const updatedAt = new Date().toISOString();

      const nextName = hasName ? name : existingParsed.name;
      const nextDescription = hasDescription
        ? description
        : existingParsed.description;
      const nextVersion =
        hasVersion || existingParsed.version
          ? (version ?? existingParsed.version)
          : '1.0.0';
      const nextBody = hasBody ? body : existingParsed.body;

      const frontmatterLines = [
        `name: ${nextName}`,
        `description: ${nextDescription}`,
        `version: ${nextVersion}`,
        ...(createdBy ? [`created_by: ${createdBy}`] : []),
        `updated_by: ${ctx.agentId}`,
        `updated_at: ${updatedAt}`,
      ];
      const newContent = `---\n${frontmatterLines.join('\n')}\n---\n\n${nextBody}\n`;

      const reparsed = parseSkillMd(newContent, id, skillFilePath);
      if ('errors' in reparsed) {
        return {
          ok: false,
          error: `Invalid skill content: ${reparsed.errors.map((e) => e.message).join(', ')}`,
        };
      }

      try {
        await mkdir(skillDirPath, { recursive: true });
        await writeFile(skillFilePath, newContent, 'utf-8');

        if (filesMap) {
          for (const [filename, fileContent] of Object.entries(filesMap)) {
            await writeFile(join(skillDirPath, filename), fileContent, 'utf-8');
          }
        }

        for (const filename of deleteFiles) {
          try {
            await unlink(join(skillDirPath, filename));
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
              throw err;
            }
          }
        }
      } catch (err) {
        return {
          ok: false,
          error: `Failed to write skill file: ${err instanceof Error ? err.message : String(err)}`,
        };
      }

      skillRegistry.register(reparsed);

      const writtenFiles = filesMap ? Object.keys(filesMap) : [];
      const notes: string[] = [];
      if (writtenFiles.length > 0) {
        notes.push(`Companion files written: ${writtenFiles.join(', ')}.`);
      }
      if (deleteFiles.length > 0) {
        notes.push(`Companion files deleted: ${deleteFiles.join(', ')}.`);
      }
      const note = notes.length > 0 ? ` ${notes.join(' ')}` : '';

      return {
        ok: true,
        content: `Skill "${id}" updated successfully.${note}`,
      };
    },
  };
}

/**
 * Line-scan the frontmatter of a SKILL.md content string for a single key.
 * Mirrors the parser's scan style so we can recover fields it doesn't model.
 * Returns undefined if the key is not present.
 */
function extractFrontmatterField(
  content: string,
  key: string,
): string | undefined {
  const lines = content.split('\n');
  const prefix = `${key}:`;
  let inFrontmatter = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '---') {
      if (!inFrontmatter) {
        inFrontmatter = true;
        continue;
      }
      return undefined;
    }
    if (inFrontmatter && line.startsWith(prefix)) {
      return line.substring(prefix.length).trim();
    }
  }
  return undefined;
}
