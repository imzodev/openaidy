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
 * Frontmatter is patched, not rebuilt: only the keys the caller asked for
 * change, every other key (`created_by`, `tags`, `license`, anything the parser
 * doesn't model) is carried over verbatim, and `updated_by` (the calling agent)
 * plus `updated_at` (ISO 8601) are stamped on every successful update.
 *
 * Writes are all-or-nothing. SKILL.md and the companion files cannot be
 * committed as one filesystem operation, so the prior content of every path is
 * snapshotted first and restored if any write or delete fails; the registry is
 * updated only once the on-disk state is final, so the two never drift apart.
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

      const updatedAt = new Date().toISOString();

      // Select each value from its `has*` flag, never from the raw argument: a
      // non-null but invalid value (an empty string, a number) must leave the
      // existing field alone rather than overwrite it with junk.
      const nextBody = hasBody ? body : existingParsed.body;

      // Patch the frontmatter in place instead of rebuilding it from the four
      // fields the parser models — rebuilding silently dropped every other key
      // (tags, license, custom metadata) on any update, including a body-only
      // one. Unknown keys and their order survive untouched.
      const frontmatter = parseFrontmatterBlocks(existingContent);
      if (hasName) setFrontmatterField(frontmatter, 'name', name);
      if (hasDescription) {
        setFrontmatterField(frontmatter, 'description', description);
      }
      if (hasVersion) {
        setFrontmatterField(frontmatter, 'version', version);
      } else if (!existingParsed.version) {
        // No version provided and none on disk — stamp the default so every
        // skill this tool touches carries one.
        setFrontmatterField(frontmatter, 'version', '1.0.0');
      }
      setFrontmatterField(frontmatter, 'updated_by', ctx.agentId);
      setFrontmatterField(frontmatter, 'updated_at', updatedAt);

      const newContent = `---\n${renderFrontmatterBlocks(frontmatter).join('\n')}\n---\n\n${nextBody}\n`;

      const reparsed = parseSkillMd(newContent, id, skillFilePath);
      if ('errors' in reparsed) {
        return {
          ok: false,
          error: `Invalid skill content: ${reparsed.errors.map((e) => e.message).join(', ')}`,
        };
      }

      // An update touches several files (SKILL.md plus any companion writes and
      // deletes) and there is no filesystem primitive that commits them as one.
      // So snapshot every path we are about to touch, and undo the whole set if
      // any single operation fails — a half-applied update on disk with a stale
      // registry is worse than no update at all.
      const touchedPaths = [
        skillFilePath,
        ...(filesMap
          ? Object.keys(filesMap).map((f) => join(skillDirPath, f))
          : []),
        ...deleteFiles.map((f) => join(skillDirPath, f)),
      ];

      let snapshots: FileSnapshot[];
      try {
        snapshots = await snapshotFiles(touchedPaths);
      } catch (err) {
        return {
          ok: false,
          error: `Failed to read the current skill files before updating: ${err instanceof Error ? err.message : String(err)}`,
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
        const restoreFailures = await restoreFiles(snapshots);
        const detail = err instanceof Error ? err.message : String(err);
        return {
          ok: false,
          error:
            restoreFailures.length === 0
              ? `Failed to write skill file: ${detail}. The skill was left unchanged.`
              : `Failed to write skill file: ${detail}. Rolling back left these files in an unknown state: ${restoreFailures.join(', ')}.`,
        };
      }

      // Only now is the on-disk state final, so this is the only point at which
      // the registry can be updated without drifting from the files.
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
 * One frontmatter key with the raw lines that belong to it.
 *
 * `key` is empty for the leading block, which holds any lines that appear
 * before the first key (comments, blank lines) so they survive a round-trip.
 */
type FrontmatterBlock = { key: string; lines: string[] };

/** A `key:` line at the top level of the frontmatter. */
const FRONTMATTER_KEY_PATTERN = /^([A-Za-z0-9_.-]+):/;

/**
 * Split the frontmatter of a SKILL.md into ordered key blocks.
 *
 * A block starts at a `key:` line and absorbs everything up to the next one,
 * so a multi-line value (an indented map, a `- ` list) travels with its key and
 * is re-emitted verbatim. Mirrors the parser's delimiter scan: the frontmatter
 * is whatever lies between the first two `---` lines. Callers only reach this
 * after `parseSkillMd` succeeded, so those delimiters are known to exist; an
 * unparseable input yields a single leading block and is rewritten as-is.
 */
function parseFrontmatterBlocks(content: string): FrontmatterBlock[] {
  const lines = content.split('\n');
  const dashes: number[] = [];
  for (let i = 0; i < lines.length && dashes.length < 2; i++) {
    if (lines[i]?.trim() === '---') dashes.push(i);
  }
  if (dashes.length < 2) return [];

  const blocks: FrontmatterBlock[] = [];
  for (let i = dashes[0]! + 1; i < dashes[1]!; i++) {
    const line = lines[i] ?? '';
    const match = FRONTMATTER_KEY_PATTERN.exec(line);
    if (match) {
      blocks.push({ key: match[1]!, lines: [line] });
      continue;
    }
    const current = blocks[blocks.length - 1];
    if (current) {
      current.lines.push(line);
    } else {
      blocks.push({ key: '', lines: [line] });
    }
  }
  return blocks;
}

/**
 * Set a frontmatter key to a single-line scalar, replacing the existing block
 * (and any continuation lines it had) or appending a new one at the end.
 */
function setFrontmatterField(
  blocks: FrontmatterBlock[],
  key: string,
  value: unknown,
): void {
  const line = `${key}: ${String(value)}`;
  const existing = blocks.find((block) => block.key === key);
  if (existing) {
    existing.lines = [line];
    return;
  }
  blocks.push({ key, lines: [line] });
}

/** Flatten blocks back into frontmatter lines, in order. */
function renderFrontmatterBlocks(blocks: FrontmatterBlock[]): string[] {
  return blocks.flatMap((block) => block.lines);
}

/**
 * The prior content of a file, or `null` when it did not exist. Buffers rather
 * than strings so restoring a companion file written outside this tool (an
 * image, anything non-UTF-8) returns the exact bytes.
 */
type FileSnapshot = { path: string; previous: Buffer | null };

/**
 * Record the current content of every path an update is about to touch.
 *
 * @throws if a file exists but cannot be read — better to refuse the update
 * than to start writing with no way back.
 */
async function snapshotFiles(paths: string[]): Promise<FileSnapshot[]> {
  const unique = [...new Set(paths)];
  const snapshots: FileSnapshot[] = [];
  for (const path of unique) {
    try {
      snapshots.push({ path, previous: await readFile(path) });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        snapshots.push({ path, previous: null });
        continue;
      }
      throw err;
    }
  }
  return snapshots;
}

/**
 * Put the files back the way {@link snapshotFiles} found them: restore prior
 * content, and remove files that did not exist before.
 *
 * Best-effort and non-throwing — it runs while another error is already being
 * reported. Returns the paths it could not restore so the caller can say so
 * instead of claiming a clean rollback.
 */
async function restoreFiles(snapshots: FileSnapshot[]): Promise<string[]> {
  const failed: string[] = [];
  for (const { path, previous } of [...snapshots].reverse()) {
    try {
      if (previous === null) {
        await unlink(path).catch((err: NodeJS.ErrnoException) => {
          if (err.code !== 'ENOENT') throw err;
        });
      } else {
        await writeFile(path, previous);
      }
    } catch {
      failed.push(path);
    }
  }
  return failed;
}
