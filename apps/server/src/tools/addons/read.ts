/**
 * addon_read
 *
 * Read an installed addon: its manifest and the files it is built from.
 *
 * This closes the gap that made `addon_update` dangerous to use. That tool
 * takes a map of path → content and OVERWRITES each file wholesale, but until
 * now an agent had no way to see what a file contained first — addons live in a
 * directory outside the agent workspace, so `workspace_read` and `code_read`
 * cannot reach them. The only safe move was to rewrite a file from scratch,
 * which silently discarded whatever the agent had not authored itself.
 *
 * Two shapes, so reviewing an addon never costs more context than it has to:
 *   addon_read({ addon_id })                  → manifest + file inventory
 *   addon_read({ addon_id, paths: [...] })    → contents of those files
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { BuiltinTool } from '@openaidy/runtime';
import { addonReadMeta } from '../catalog.js';
import type { AddonToolDeps } from './create.js';
import { isValidId, relativePathError } from './shared.js';

/** Largest single file returned in full; longer ones are truncated with a note. */
const MAX_FILE_CHARS = 20_000;

/**
 * Ceiling on the combined size of one response. A built addon can carry a
 * vendored bundle, and dumping it would evict the conversation it was meant to
 * inform.
 */
const MAX_TOTAL_CHARS = 60_000;

/** Directories never worth reporting — noise, not addon source. */
const SKIPPED_DIRS = new Set(['node_modules', '.git', 'dist', '.cache']);

type FileEntry = { path: string; bytes: number };

/**
 * Every file under `dir`, as addon-root-relative POSIX paths. Depth-limited so
 * a symlink loop or a pathological tree cannot spin here.
 */
async function listFiles(
  root: string,
  dir: string,
  depth = 0,
): Promise<FileEntry[]> {
  if (depth > 6) return [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: FileEntry[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRS.has(entry.name)) continue;
      files.push(...(await listFiles(root, full, depth + 1)));
      continue;
    }
    if (!entry.isFile()) continue;
    let bytes = 0;
    try {
      bytes = (await stat(full)).size;
    } catch {
      // Unreadable size is not worth failing the listing over.
    }
    files.push({ path: relative(root, full).split('\\').join('/'), bytes });
  }
  return files;
}

export function createAddonReadTool(deps: AddonToolDeps): BuiltinTool {
  return {
    name: addonReadMeta.name,

    description: [
      'Read an EXISTING OpenAidy addon — its manifest and its files.',
      '',
      'WHY THIS EXISTS',
      '───────────────',
      'Addons live in a directory managed by OpenAidy, SEPARATE from your agent',
      'workspace. workspace_read and code_read cannot see them. This is the only',
      'way to read an addon.',
      '',
      'ALWAYS READ BEFORE YOU WRITE',
      '────────────────────────────',
      'addon_update OVERWRITES each file you pass it. If you write app/index.js',
      'from memory you will drop everything already in it. Read the file, change',
      'what you need, and pass the full new content back.',
      '',
      'TWO WAYS TO CALL IT',
      '───────────────────',
      '  addon_read({ addon_id: "weather" })',
      '      → manifest fields + the list of files (paths and sizes)',
      '  addon_read({ addon_id: "weather", paths: ["app/index.js"] })',
      '      → the contents of those files',
      '',
      'Start with the inventory, then ask for the files you actually need — a',
      'large file comes back truncated, and the response as a whole is capped.',
    ].join('\n'),

    parameters: {
      type: 'object',
      properties: {
        addon_id: {
          type: 'string',
          description:
            'Identifier of the addon to read (see the [ADDONS_AVAILABLE] list in your context).',
        },
        paths: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Addon-root-relative file paths to read (e.g. ["app/index.js", "app/index.html"]). ' +
            'Omit to get the manifest and the file inventory instead of contents.',
        },
      },
      required: ['addon_id'],
    },

    async execute(args) {
      const addonId = args['addon_id'];
      const pathsArg = args['paths'];

      if (typeof addonId !== 'string' || !addonId) {
        return {
          ok: false,
          error: 'addon_id is required and must be a non-empty string',
        };
      }
      if (!isValidId(addonId)) {
        return {
          ok: false,
          error:
            'addon_id must be lowercase alphanumeric with hyphens only (e.g. "my-addon")',
        };
      }

      const addonDir = join(deps.addonsDir, addonId);
      let manifestRaw: string;
      try {
        manifestRaw = await readFile(join(addonDir, 'addon.json'), 'utf-8');
      } catch {
        return {
          ok: false,
          error: `Addon "${addonId}" not found. Check the [ADDONS_AVAILABLE] list in your context, or use addon_create to make a new one.`,
        };
      }

      let manifest: Record<string, unknown>;
      try {
        manifest = JSON.parse(manifestRaw) as Record<string, unknown>;
      } catch (err) {
        return {
          ok: false,
          error: `Addon "${addonId}" has an unreadable addon.json: ${err instanceof Error ? err.message : String(err)}`,
        };
      }

      const requestedPaths: string[] = Array.isArray(pathsArg)
        ? pathsArg.filter((p): p is string => typeof p === 'string')
        : [];

      // ── Inventory mode ──────────────────────────────────────────────────
      if (requestedPaths.length === 0) {
        const files = await listFiles(addonDir, addonDir);
        const inventory = files
          .filter((f) => f.path !== 'addon.json')
          .sort((a, b) => a.path.localeCompare(b.path))
          .map((f) => `  ${f.path} (${f.bytes} bytes)`)
          .join('\n');

        const manifestSummary = [
          `id: ${addonId}`,
          `name: ${String(manifest['name'] ?? '(unset)')}`,
          `description: ${String(manifest['description'] ?? '(unset)')}`,
          `version: ${String(manifest['version'] ?? '(unset)')}`,
          `permissions: ${formatList(manifest['permissions'])}`,
          `externalDomains: ${formatList(manifest['externalDomains'])}`,
          `externalImageDomains: ${formatList(manifest['externalImageDomains'])}`,
        ].join('\n');

        return {
          ok: true,
          content: [
            `Addon "${addonId}" manifest:`,
            manifestSummary,
            '',
            'Files:',
            inventory || '  (none)',
            '',
            `Read a file with addon_read({ addon_id: "${addonId}", paths: ["app/index.js"] }).`,
          ].join('\n'),
        };
      }

      // ── Content mode ────────────────────────────────────────────────────
      for (const filePath of requestedPaths) {
        const pathError = relativePathError(filePath);
        if (pathError) return { ok: false, error: pathError };
      }

      const sections: string[] = [];
      let totalChars = 0;
      const missing: string[] = [];

      for (const filePath of requestedPaths) {
        let content: string;
        try {
          content = await readFile(join(addonDir, filePath), 'utf-8');
        } catch {
          missing.push(filePath);
          continue;
        }

        let body = content;
        let note = '';
        if (body.length > MAX_FILE_CHARS) {
          body = body.slice(0, MAX_FILE_CHARS);
          note = `\n… truncated at ${MAX_FILE_CHARS} characters of ${content.length}. Ask for a narrower set of files if you need the rest.`;
        }
        if (totalChars + body.length > MAX_TOTAL_CHARS) {
          sections.push(
            `── ${filePath} ──\n(skipped: response size limit reached — request this file on its own)`,
          );
          continue;
        }
        totalChars += body.length;
        sections.push(`── ${filePath} ──\n${body}${note}`);
      }

      if (sections.length === 0) {
        return {
          ok: false,
          error: `None of the requested files exist in addon "${addonId}": ${missing.join(', ')}. Call addon_read({ addon_id: "${addonId}" }) for the file list.`,
        };
      }

      const missingNote =
        missing.length > 0
          ? `\n\nNot found (skipped): ${missing.join(', ')}`
          : '';

      return {
        ok: true,
        content: `Addon "${addonId}" files:\n\n${sections.join('\n\n')}${missingNote}`,
      };
    },
  };
}

/** Render a manifest array field for the summary, or note that it is empty. */
function formatList(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return '(none)';
  return value.map((v) => String(v)).join(', ');
}
