/**
 * addon_update
 *
 * Lets an agent modify an EXISTING addon: overwrite / add / delete its UI
 * files, and/or change manifest fields (name, description, version,
 * permissions, externalDomains, externalImageDomains). Keeps the on-disk
 * addon.json and the DB record in sync.
 *
 * File edits:        direct fs writes/deletes under the addon directory
 * Manifest sync:     AddonService.updateAddon (in-process, no HTTP round-trip)
 *
 * For creating a brand-new addon use `addon_create`. This tool refuses to
 * run if the addon does not already exist.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { BuiltinTool } from '@openaidy/runtime';
import type { AddonManifest } from '@openaidy/shared-types';
import { AddonServiceError } from '../../addons/types.js';
import type { AddonToolDeps } from './create.js';
import { addonUpdateMeta } from '../catalog.js';

// ── Validation helpers ────────────────────────────────────────────────────────

function isValidId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(id);
}

/** Returns an error string if the path is unsafe, otherwise null. */
function relativePathError(filePath: string): string | null {
  const parts = filePath.split('/');
  if (parts.some((p) => p === '..' || p === '.') || filePath.startsWith('/')) {
    return `File path "${filePath}" must be relative with no ".." segments`;
  }
  return null;
}

const MANIFEST_FIELD_KEYS = [
  'name',
  'description',
  'version',
  'permissions',
  'externalDomains',
  'externalImageDomains',
] as const;

// ── Tool factory ──────────────────────────────────────────────────────────────

export function createAddonUpdateTool(deps: AddonToolDeps): BuiltinTool {
  return {
    name: addonUpdateMeta.name,

    description: [
      'Modify an EXISTING OpenAidy addon. The addon must already exist (use',
      'addon_create for new ones). Changes take effect when the addon is',
      'reloaded in the UI — no server restart needed.',
      '',
      'WHAT YOU CAN CHANGE',
      '───────────────────',
      '  files               — create or OVERWRITE files (e.g. app/index.js, app/styles.css)',
      '  deleteFiles         — remove files no longer needed',
      '  name / description / version',
      '  permissions         — replace the SDK permission set',
      '  externalDomains     — hostnames the addon may fetch() from (CSP connect-src)',
      '  externalImageDomains— hostnames the addon may load <img> from (CSP img-src)',
      '',
      'Provide at least one of the above. Fields you omit are left unchanged.',
      '',
      'FILE RULES',
      '──────────',
      '  • Paths are relative to the addon root, no ".." segments.',
      '  • Do NOT write "addon.json" directly — change its fields via the',
      '    structured parameters (name, permissions, externalDomains, …).',
      '  • You cannot delete app/index.html or app/index.js (required to run).',
      '  • If you overwrite app/index.html it MUST still load the SDK before',
      '    the addon script, in this order, just before </body>:',
      '      <script src="/sdk/openaidy-sdk.js"></script>',
      '      <script src="index.js"></script>',
      '',
      'EXTERNAL DOMAINS',
      '────────────────',
      'If your updated code calls fetch() on an external URL, the hostname MUST',
      'be present in externalDomains or the browser blocks it via CSP. This tool',
      'scans the files you write and fails if it finds an undeclared external',
      'fetch host. Pass the full list via externalDomains (it REPLACES the old',
      'list — include hosts you still need).',
      '',
      'PERMISSIONS',
      '───────────',
      'Changing permissions updates the manifest and DB. An addon iframe that is',
      'already open keeps its old access token until it is reloaded (or the addon',
      'is disabled/re-enabled), so tell the user to reload after a permission change.',
    ].join('\n'),

    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Identifier of the addon to update. Must already exist.',
        },
        files: {
          type: 'object',
          description:
            'Map of relative path → string content. Creates or overwrites each file. ' +
            'Do not include "addon.json". Paths must be relative with no ".." segments.',
          additionalProperties: { type: 'string' },
        },
        deleteFiles: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Relative paths to delete from the addon. Cannot delete addon.json, ' +
            'app/index.html or app/index.js.',
        },
        name: {
          type: 'string',
          description: 'New human-readable display name.',
        },
        description: {
          type: 'string',
          description: 'New one-line description.',
        },
        version: {
          type: 'string',
          description: 'New semver version (e.g. "1.1.0").',
        },
        permissions: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Replacement permission set. Valid values: agents.list, agents.invoke, ' +
            'sessions.list, sessions.read, sessions.write, config.read.',
        },
        externalDomains: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Replacement list of bare hostnames the addon may fetch() from. ' +
            'REPLACES the previous list — include every host still needed.',
        },
        externalImageDomains: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Replacement list of bare hostnames the addon may load images from. ' +
            'REPLACES the previous list.',
        },
      },
      required: ['id'],
    },

    async execute(args, ctx) {
      const id = args['id'];

      // ── id validation ────────────────────────────────────────────────────
      if (typeof id !== 'string' || !id) {
        return {
          ok: false,
          error: 'id is required and must be a non-empty string',
        };
      }
      if (!isValidId(id)) {
        return {
          ok: false,
          error:
            'id must be lowercase alphanumeric with hyphens only (e.g. "my-addon")',
        };
      }

      const addonDir = join(deps.addonsDir, id);
      if (!existsSync(addonDir)) {
        return {
          ok: false,
          error: `Addon "${id}" does not exist at ${addonDir}. Use addon_create to create a new addon.`,
        };
      }

      const filesArg = args['files'];
      const deleteArg = args['deleteFiles'];
      const hasFiles = filesArg !== undefined && filesArg !== null;
      const hasDeletes = Array.isArray(deleteArg) && deleteArg.length > 0;
      const providedManifestFields = MANIFEST_FIELD_KEYS.filter(
        (k) => args[k] !== undefined,
      );
      const hasManifestChanges = providedManifestFields.length > 0;

      if (!hasFiles && !hasDeletes && !hasManifestChanges) {
        return {
          ok: false,
          error:
            'Nothing to update. Provide at least one of: files, deleteFiles, ' +
            'name, description, version, permissions, externalDomains, externalImageDomains.',
        };
      }

      // ── Validate files to write ──────────────────────────────────────────
      const filesToWrite: Record<string, string> = {};
      if (hasFiles) {
        if (typeof filesArg !== 'object' || Array.isArray(filesArg)) {
          return {
            ok: false,
            error:
              'files must be an object mapping relative paths to string contents',
          };
        }
        for (const [filePath, content] of Object.entries(
          filesArg as Record<string, unknown>,
        )) {
          const pErr = relativePathError(filePath);
          if (pErr) return { ok: false, error: pErr };
          if (filePath === 'addon.json') {
            return {
              ok: false,
              error:
                'Do not write "addon.json" directly — change its fields via the ' +
                'structured parameters (name, permissions, externalDomains, …)',
            };
          }
          if (typeof content !== 'string') {
            return {
              ok: false,
              error: `File "${filePath}" must have string content`,
            };
          }
          filesToWrite[filePath] = content;
        }

        // If overwriting index.html, enforce SDK-before-app-script ordering.
        const html = filesToWrite['app/index.html'];
        if (typeof html === 'string') {
          if (!html.includes('<script src="index.js">')) {
            return {
              ok: false,
              error:
                'app/index.html must contain <script src="index.js"></script> before </body>',
            };
          }
          if (!html.includes('<script src="/sdk/openaidy-sdk.js">')) {
            return {
              ok: false,
              error:
                'app/index.html must load the SDK statically: <script src="/sdk/openaidy-sdk.js"></script> must appear before <script src="index.js">',
            };
          }
          if (
            html.indexOf('<script src="/sdk/openaidy-sdk.js">') >
            html.indexOf('<script src="index.js">')
          ) {
            return {
              ok: false,
              error:
                '<script src="/sdk/openaidy-sdk.js"> must appear before <script src="index.js"> in app/index.html',
            };
          }
        }
      }

      // ── Validate deletes ─────────────────────────────────────────────────
      const filesToDelete: string[] = [];
      if (hasDeletes) {
        for (const f of deleteArg as unknown[]) {
          if (typeof f !== 'string') {
            return {
              ok: false,
              error: 'deleteFiles must be an array of strings',
            };
          }
          const pErr = relativePathError(f);
          if (pErr) return { ok: false, error: pErr };
          if (
            f === 'addon.json' ||
            f === 'app/index.html' ||
            f === 'app/index.js'
          ) {
            return {
              ok: false,
              error: `Cannot delete "${f}" — it is required for the addon to function`,
            };
          }
          filesToDelete.push(f);
        }
      }

      // ── Read existing manifest (for merge + fetch validation) ────────────
      const { readFileSync } = await import('node:fs');
      const manifestPath = join(addonDir, 'addon.json');
      let currentManifest: Record<string, unknown> = {};
      try {
        currentManifest = JSON.parse(
          readFileSync(manifestPath, 'utf-8'),
        ) as Record<string, unknown>;
      } catch {
        if (hasManifestChanges) {
          return {
            ok: false,
            error: `Cannot update manifest fields: addon.json is missing or invalid at ${manifestPath}`,
          };
        }
      }

      // ── Validate provided manifest-field types ───────────────────────────
      const name = args['name'];
      const description = args['description'];
      const version = args['version'];
      const permissions = args['permissions'];
      const externalDomains = args['externalDomains'];
      const externalImageDomains = args['externalImageDomains'];

      if (name !== undefined && (typeof name !== 'string' || !name)) {
        return { ok: false, error: 'name must be a non-empty string' };
      }
      if (
        description !== undefined &&
        (typeof description !== 'string' || !description)
      ) {
        return { ok: false, error: 'description must be a non-empty string' };
      }
      if (version !== undefined && (typeof version !== 'string' || !version)) {
        return { ok: false, error: 'version must be a non-empty string' };
      }
      const isStringArray = (v: unknown): v is string[] =>
        Array.isArray(v) && v.every((x) => typeof x === 'string');
      if (permissions !== undefined && !isStringArray(permissions)) {
        return { ok: false, error: 'permissions must be an array of strings' };
      }
      if (externalDomains !== undefined && !isStringArray(externalDomains)) {
        return {
          ok: false,
          error: 'externalDomains must be an array of strings',
        };
      }
      if (
        externalImageDomains !== undefined &&
        !isStringArray(externalImageDomains)
      ) {
        return {
          ok: false,
          error: 'externalImageDomains must be an array of strings',
        };
      }

      // ── Validate fetch() hosts in the files being written ────────────────
      const effectiveExternalDomains: string[] = isStringArray(externalDomains)
        ? externalDomains
        : Array.isArray(currentManifest['externalDomains'])
          ? (currentManifest['externalDomains'] as unknown[]).filter(
              (d): d is string => typeof d === 'string',
            )
          : [];
      {
        const newContent = Object.values(filesToWrite).join('\n');
        const fetchMatches = newContent.match(
          /fetch\(\s*['"`](https?:\/\/[^'"`\s]+)/g,
        );
        if (fetchMatches && fetchMatches.length > 0) {
          const hosts = fetchMatches
            .map((m) => {
              const url = m.replace(/fetch\(\s*['"`]/, '');
              try {
                return new URL(url).hostname;
              } catch {
                return null;
              }
            })
            .filter((h): h is string => h !== null);
          const undeclared = [
            ...new Set(
              hosts.filter((h) => !effectiveExternalDomains.includes(h)),
            ),
          ];
          if (undeclared.length > 0) {
            return {
              ok: false,
              error:
                'Your updated files call fetch() on external URLs not in externalDomains. ' +
                `The browser will block these via CSP. Pass externalDomains including: [${undeclared
                  .map((h) => `"${h}"`)
                  .join(', ')}]`,
            };
          }
        }
      }

      // ── Apply file writes / deletes ──────────────────────────────────────
      const { mkdir, writeFile, rm } = await import('node:fs/promises');
      const written: string[] = [];
      for (const [filePath, content] of Object.entries(filesToWrite)) {
        const parts = filePath.split('/');
        if (parts.length > 1) {
          await mkdir(join(addonDir, ...parts.slice(0, -1)), {
            recursive: true,
          });
        }
        await writeFile(join(addonDir, filePath), content, 'utf-8');
        written.push(filePath);
      }
      const deleted: string[] = [];
      for (const f of filesToDelete) {
        const target = join(addonDir, f);
        if (existsSync(target)) {
          await rm(target);
          deleted.push(f);
        }
      }

      // ── Apply manifest changes (disk + DB) ───────────────────────────────
      const notes: string[] = [];
      if (hasManifestChanges) {
        const newManifest: Record<string, unknown> = { ...currentManifest };
        if (name !== undefined) newManifest['name'] = name;
        if (description !== undefined) newManifest['description'] = description;
        if (version !== undefined) newManifest['version'] = version;
        if (permissions !== undefined) newManifest['permissions'] = permissions;
        if (externalDomains !== undefined)
          newManifest['externalDomains'] = externalDomains;
        if (externalImageDomains !== undefined)
          newManifest['externalImageDomains'] = externalImageDomains;

        const oldPerms = Array.isArray(currentManifest['permissions'])
          ? (currentManifest['permissions'] as string[])
          : [];
        const newPerms = Array.isArray(newManifest['permissions'])
          ? (newManifest['permissions'] as string[])
          : [];
        const permissionsChanged =
          permissions !== undefined &&
          (oldPerms.length !== newPerms.length ||
            oldPerms.some((p) => !newPerms.includes(p)) ||
            newPerms.some((p) => !oldPerms.includes(p)));

        await writeFile(
          manifestPath,
          JSON.stringify(newManifest, null, 2) + '\n',
          'utf-8',
        );
        written.push('addon.json');

        if (deps.addonService) {
          try {
            await deps.addonService.updateAddon({
              addonId: id,
              manifest: newManifest as unknown as AddonManifest,
              updatedBy: ctx.agentId,
            });
            notes.push('Manifest updated in database.');
            if (permissionsChanged) {
              notes.push(
                'Permissions changed — reload the addon (or disable/enable it) so the ' +
                  'iframe picks up a token with the new permissions.',
              );
            }
          } catch (err) {
            const msg =
              err instanceof AddonServiceError
                ? err.message
                : err instanceof Error
                  ? err.message
                  : String(err);
            notes.push(
              `Warning: files updated but DB manifest update failed: ${msg}`,
            );
          }
        } else {
          notes.push(
            'DB not configured — addon.json updated on disk but not in the database.',
          );
        }
      }

      // ── Success ──────────────────────────────────────────────────────────
      return {
        ok: true,
        content: [
          `Addon "${id}" updated at ${addonDir}`,
          ...(written.length
            ? ['', 'Files written:', ...written.map((f) => `  ${f}`)]
            : []),
          ...(deleted.length
            ? ['', 'Files deleted:', ...deleted.map((f) => `  ${f}`)]
            : []),
          ...(notes.length ? ['', ...notes] : []),
          '',
          'Reload the addon in the UI to see the changes.',
        ].join('\n'),
      };
    },
  };
}
