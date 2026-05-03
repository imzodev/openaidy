/**
 * addon_create
 *
 * Lets an agent scaffold a new addon in the OpenAidy addons directory,
 * then registers and enables it — exactly what `openaidy addon create` does.
 *
 * File scaffolding:  @openaidy/addon-scaffolding (shared with the CLI)
 * DB registration:   AddonService.installAddon + AddonService.enableAddon
 *                    (direct in-process call — no HTTP round-trip)
 *
 * Architecture note
 * ─────────────────
 * SDK documentation is imported from `../../addons/sdk-reference.ts` —
 * the single source of truth. When sdk-reference.ts is updated (new method
 * added, signature changed), this tool's description updates automatically.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { BuiltinTool } from '@openaidy/runtime';
import { generateFromTemplate } from '@openaidy/addon-scaffolding';
import type { AddonService } from '../../addons/service.js';
import type { AddonManifest } from '@openaidy/shared-types';
import { AddonServiceError } from '../../addons/types.js';
import { renderSdkReference, SDK_METHODS } from '../../addons/sdk-reference.js';

export type AddonToolDeps = {
  /** Absolute path to the root addons directory (e.g. .openaidy/addons) */
  addonsDir: string;
  /**
   * AddonService instance for registering and enabling the addon in the DB.
   * Optional — when absent the tool still writes files but skips DB registration
   * (useful in environments where the DB is not configured).
   */
  addonService?: AddonService;
};

// ── Validation helpers ────────────────────────────────────────────────────────

function isValidId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(id);
}

// ── SDK snippet helpers (derived from sdk-reference — no hardcoding) ──────────

function sdkBootstrapSnippet(): string {
  return `// Bootstrap: signal ready, then wait for OPENAIDY_INIT from the parent.
// The parent sends the init message with apiBase and an addon token.
window.addEventListener('message', function onInit(event) {
  var msg = event.data;
  if (!msg || msg.type !== 'OPENAIDY_INIT') return;
  window.removeEventListener('message', onInit);
  var script = document.createElement('script');
  script.src = msg.apiBase + '/sdk/openaidy-sdk.js';
  script.onload = function() { onSdkReady(msg); };
  document.head.appendChild(script);
});
window.parent.postMessage({ type: 'ADDON_READY' }, '*');`;
}

function buildSdkUsageComment(permissions: string[]): string {
  const relevant = SDK_METHODS.filter(
    (m) => !m.requiredPermission || permissions.includes(m.requiredPermission),
  );
  if (relevant.length === 0) return '';
  const lines = ['// Available SDK methods for this addon:'];
  for (const m of relevant) {
    lines.push(`//   ${m.exampleJs}`);
  }
  return lines.join('\n');
}

// ── Tool factory ──────────────────────────────────────────────────────────────

export function createAddonCreateTool(deps: AddonToolDeps): BuiltinTool {
  const sdkReference = renderSdkReference();

  return {
    name: 'addon_create',

    description: [
      'Scaffold a new OpenAidy addon, register it in the database, and enable it.',
      'The addon appears in the sidebar immediately — no restart needed.',
      'An addon is a sandboxed HTML/JS UI loaded in an iframe inside the OpenAidy app.',
      'It communicates with the backend exclusively via the OpenAidy SDK (openaidy-sdk.js),',
      'which is loaded dynamically — you never hardcode the server URL.',
      '',
      'ADDON STRUCTURE',
      '───────────────',
      '  <id>/                   ← addon root (created under the addons directory)',
      '    addon.json            ← manifest (always generated from parameters)',
      '    app/                  ← UI entry point',
      '      index.html          ← required',
      '      index.js            ← required',
      '',
      'TEMPLATE PARAMETER',
      '──────────────────',
      'Pass one of:',
      '  "basic"  — minimal hello-world with SDK connection status',
      '  "agent"  — agent runner UI: lists agents, takes a prompt, invokes an agent',
      '',
      'For custom UIs, choose "basic" and provide your own files in the `files` parameter.',
      '',
      'SDK BOOTSTRAP PATTERN (always required in index.js)',
      '────────────────────────────────────────────────────',
      'Copy this block verbatim at the top of app/index.js — do not modify it:',
      '',
      sdkBootstrapSnippet(),
      '',
      'Then define onSdkReady(msg) below it:',
      '',
      'function onSdkReady(msg) {',
      '  OpenAidy.ready(function(sdk) {',
      '    // your addon logic here',
      '  });',
      '}',
      '',
      'PERMISSIONS',
      '───────────',
      'The `permissions` parameter declares what the addon is allowed to do.',
      'Only methods whose required permission is listed will work at runtime.',
      '',
      sdkReference,
      '',
      'FILES PARAMETER (optional — overrides template files)',
      '──────────────────────────────────────────────────────',
      'Provide a map of relative paths to string contents to override or add files.',
      'Keys must be relative paths within the addon dir (e.g. "app/index.html").',
      'No "../" path traversal allowed. Do NOT include "addon.json" — it is always',
      'generated from the structured parameters.',
    ].join('\n'),

    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description:
            'Unique addon identifier — lowercase alphanumeric with hyphens (e.g. "weather-widget"). ' +
            'Must not already exist.',
        },
        name: {
          type: 'string',
          description:
            'Human-readable display name shown in the sidebar (e.g. "Weather Widget").',
        },
        description: {
          type: 'string',
          description: 'One-line description of what this addon does.',
        },
        template: {
          type: 'string',
          description:
            'Starting template: "basic" (minimal hello-world) or "agent" (agent runner UI). ' +
            'Defaults to "basic". Use "agent" when the primary purpose is invoking agents.',
        },
        permissions: {
          type: 'array',
          items: { type: 'string' },
          description:
            'SDK permissions this addon requires. ' +
            'Valid values: agents.list, agents.invoke, sessions.list, sessions.create, ' +
            'sessions.read, config.read. Only request what you actually use.',
        },
        files: {
          type: 'object',
          description:
            'Optional map of relative file paths to their contents, used to override ' +
            'or supplement the template files. Must include "app/index.html" and ' +
            '"app/index.js" if you want a fully custom UI. Paths must not contain "..".',
        },
      },
      required: ['id', 'name', 'description', 'permissions'],
    },

    async execute(args, ctx) {
      const id = args['id'];
      const name = args['name'];
      const description = args['description'];
      const template =
        typeof args['template'] === 'string' ? args['template'] : 'basic';
      const permissions = args['permissions'];
      const filesArg = args['files'];

      // ── Input validation ────────────────────────────────────────────────

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
      if (
        !Array.isArray(permissions) ||
        permissions.some((p) => typeof p !== 'string')
      ) {
        return { ok: false, error: 'permissions must be an array of strings' };
      }

      const addonDir = join(deps.addonsDir, id);
      if (existsSync(addonDir)) {
        return {
          ok: false,
          error: `Addon "${id}" already exists at ${addonDir}`,
        };
      }

      // ── Validate extra files (if provided) ──────────────────────────────

      const extraFiles: Record<string, string> = {};
      if (filesArg !== null && filesArg !== undefined) {
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
          const parts = filePath.split('/');
          if (
            parts.some((p) => p === '..' || p === '.') ||
            filePath.startsWith('/')
          ) {
            return {
              ok: false,
              error: `File path "${filePath}" must be relative with no ".." segments`,
            };
          }
          if (filePath === 'addon.json') {
            return {
              ok: false,
              error:
                'Do not include "addon.json" in files — it is always generated from structured parameters',
            };
          }
          if (typeof content !== 'string') {
            return {
              ok: false,
              error: `File "${filePath}" must have string content`,
            };
          }
          extraFiles[filePath] = content;
        }
      }

      // ── Step 1: scaffold files via shared template generator ─────────────

      const generated = await generateFromTemplate(template, addonDir, {
        name,
        id,
        description,
      });

      if (!generated.success) {
        return {
          ok: false,
          error: `Template generation failed: ${generated.message}`,
        };
      }

      // Write any extra/override files on top of the template
      if (Object.keys(extraFiles).length > 0) {
        const { mkdir, writeFile } = await import('node:fs/promises');
        for (const [filePath, content] of Object.entries(extraFiles)) {
          const parts = filePath.split('/');
          if (parts.length > 1) {
            await mkdir(join(addonDir, ...parts.slice(0, -1)), {
              recursive: true,
            });
          }
          await writeFile(join(addonDir, filePath), content, 'utf-8');
        }
      }

      // ── Step 2: register + enable via AddonService (in-process) ──────────

      const registrationNote: string[] = [];

      if (deps.addonService) {
        try {
          const { readFileSync } = await import('node:fs');
          const manifest = JSON.parse(
            readFileSync(join(addonDir, 'addon.json'), 'utf-8'),
          ) as unknown as AddonManifest;
          await deps.addonService.installAddon({
            manifest,
            installedBy: ctx.agentId,
          });
          await deps.addonService.enableAddon({
            addonId: id,
            approvedPermissions: permissions as string[],
            approvedBy: ctx.agentId,
          });
          registrationNote.push(
            'Registered and enabled — appears in sidebar immediately.',
          );
        } catch (err) {
          const msg =
            err instanceof AddonServiceError
              ? err.message
              : err instanceof Error
                ? err.message
                : String(err);
          registrationNote.push(
            `Warning: files written but DB registration failed: ${msg}`,
            'Run `openaidy addon install ' + id + '` to register it manually.',
          );
        }
      } else {
        registrationNote.push(
          'DB not configured — files written but addon is not registered.',
          'Run `openaidy addon install ' + id + '` to register it manually.',
        );
      }

      // ── Success ─────────────────────────────────────────────────────────

      const writtenFiles = [...generated.files, ...Object.keys(extraFiles)];
      const usageHint = buildSdkUsageComment(permissions as string[]);

      return {
        ok: true,
        content: [
          `Addon "${name}" (${id}) created at ${addonDir}`,
          ...registrationNote,
          '',
          'Files written:',
          ...writtenFiles.map((f) => `  ${f}`),
          '',
          usageHint,
        ]
          .filter((line) => line !== undefined)
          .join('\n'),
      };
    },
  };
}
