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
import { addonCreateMeta } from '../catalog.js';

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
  return `// Bootstrap: signal ready to the parent, then call your logic inside OpenAidy.ready().
// The SDK is loaded statically via <script src="/sdk/openaidy-sdk.js"> in index.html.
window.parent.postMessage({ type: 'ADDON_READY' }, '*');
OpenAidy.ready(function(sdk) {
  // your addon logic here — sdk is fully initialized
});`;
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
    name: addonCreateMeta.name,

    description: [
      'Scaffold a new OpenAidy addon, register it in the database, and enable it.',
      'The addon appears in the sidebar immediately — no restart needed.',
      'An addon is a sandboxed HTML/JS UI loaded in an iframe inside the OpenAidy app.',
      'It communicates with the backend exclusively via the OpenAidy SDK (openaidy-sdk.js),',
      'which is loaded as a static <script> tag — you never hardcode the server URL.',
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
      'Always use "basic" and provide the full UI in the `files` parameter.',
      '',
      'SDK BOOTSTRAP PATTERN (always required)',
      '────────────────────────────────────────',
      'app/index.html MUST load the SDK as a static script BEFORE index.js:',
      '',
      '  <script src="/sdk/openaidy-sdk.js"></script>',
      '  <script src="index.js"></script>',
      '</body>',
      '</html>',
      '',
      'Then at the top of app/index.js:',
      '',
      sdkBootstrapSnippet(),
      '',
      '',
      'EXTERNAL DOMAINS (required when using fetch())',
      '───────────────────────────────────────────────',
      'If your addon calls fetch() on any external URL (anything that is not the OpenAidy',
      'server), you MUST declare those hostnames in `externalDomains`. Without this the',
      'browser will block the request with a CSP error and the addon will silently fail.',
      '',
      'Rule: scan every fetch() / XMLHttpRequest / WebSocket call in your code.',
      'For every external hostname found, add it (bare, no protocol) to externalDomains.',
      '',
      'Example — addon that calls a weather API:',
      '  externalDomains: ["api.open-meteo.com"]',
      '',
      'Example — addon that loads images from GitHub:',
      '  externalImageDomains: ["raw.githubusercontent.com"]',
      '',
      'The OpenAidy server itself (localhost / the SDK proxy) is always allowed.',
      'Do NOT list it in externalDomains.',
      '',
      'PERMISSIONS',
      '───────────',
      'The `permissions` parameter declares what the addon is allowed to do.',
      'Only methods whose required permission is listed will work at runtime.',
      '',
      sdkReference,
      '',
      'AGENT IDS',
      '─────────',
      'NEVER hardcode an agent ID. Agent IDs are user-defined and vary between',
      'installations. Before writing addon code that references an agent, call the',
      '`agents_list` tool to discover the real agent IDs available in this instance,',
      'then use the correct ID in the addon code.',
      'sdk.invokeAgent(agentId, prompt) requires the "agents.invoke" permission.',
      '',
      'FILES PARAMETER (required)',
      '──────────────────────────',
      'You MUST always provide at minimum:',
      '  "app/index.html" — the full UI page',
      '  "app/index.js"   — the bootstrap + addon logic',
      '',
      'app/index.html must end with (SDK MUST come before index.js):',
      '  <script src="/sdk/openaidy-sdk.js"></script>',
      '  <script src="index.js"></script>',
      '</body>',
      '</html>',
      '',
      'Do NOT include "addon.json" — it is always generated from the structured parameters.',
      'Paths must be relative with no ".." segments.',
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
            'Valid values: agents.list, agents.invoke, sessions.list, ' +
            'sessions.read, sessions.write, config.read. Only request what you actually use. ' +
            'NOTE: sessions are created automatically by agents.invoke — there is no sessions.create permission. ' +
            'sessions.write = send a message to an existing session via sdk.sendMessage().',
        },
        externalDomains: {
          type: 'array',
          items: { type: 'string' },
          description:
            'REQUIRED whenever the addon calls fetch() on a URL that is not the OpenAidy server. ' +
            'List every external hostname (bare, no protocol) the addon fetches from. ' +
            'Without this the browser blocks the request via CSP and the addon silently fails. ' +
            'Example: ["api.open-meteo.com"]. ' +
            'The OpenAidy server and SDK proxy are always allowed — do not list them here.',
        },
        externalImageDomains: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Bare hostnames the addon is allowed to load images from ' +
            '(e.g. ["raw.githubusercontent.com", "assets.pokemon.com"]). ' +
            'Enforced via CSP img-src. Use this for <img src="https://..."> and CSS background images.',
        },
        files: {
          type: 'object',
          description:
            'Required. Must contain at minimum "app/index.html" and "app/index.js". ' +
            '"app/index.html" must end with <script src="index.js"></script> just before </body>. ' +
            'Paths must be relative with no ".." segments. Do not include "addon.json".',
          additionalProperties: { type: 'string' },
        },
      },
      required: ['id', 'name', 'description', 'permissions', 'files'],
    },

    async execute(args, ctx) {
      const id = args['id'];
      const name = args['name'];
      const description = args['description'];
      const template =
        typeof args['template'] === 'string' ? args['template'] : 'basic';
      const permissions = args['permissions'];
      const externalDomains = Array.isArray(args['externalDomains'])
        ? (args['externalDomains'] as string[])
        : undefined;
      const externalImageDomains = Array.isArray(args['externalImageDomains'])
        ? (args['externalImageDomains'] as string[])
        : undefined;
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

      // ── Validate files (required) ────────────────────────────────────────

      const extraFiles: Record<string, string> = {};
      if (filesArg === null || filesArg === undefined) {
        return {
          ok: false,
          error:
            'files is required and must include "app/index.html" and "app/index.js"',
        };
      }
      if (typeof filesArg !== 'object' || Array.isArray(filesArg)) {
        return {
          ok: false,
          error:
            'files must be an object mapping relative paths to string contents',
        };
      }
      const fileKeys = Object.keys(filesArg as Record<string, unknown>);
      if (!fileKeys.includes('app/index.html')) {
        return { ok: false, error: 'files must include "app/index.html"' };
      }
      if (!fileKeys.includes('app/index.js')) {
        return { ok: false, error: 'files must include "app/index.js"' };
      }
      {
        const html = (filesArg as Record<string, unknown>)['app/index.html'];
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
          const sdkPos = html.indexOf('<script src="/sdk/openaidy-sdk.js">');
          const jsPos = html.indexOf('<script src="index.js">');
          if (sdkPos > jsPos) {
            return {
              ok: false,
              error:
                '<script src="/sdk/openaidy-sdk.js"> must appear before <script src="index.js"> in app/index.html',
            };
          }
        }
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

      // ── Validate externalDomains: detect undeclared external fetch() calls ─
      {
        const allContent = Object.values(extraFiles).join('\n');
        const fetchMatches = allContent.match(
          /fetch\(\s*['"`](https?:\/\/[^'"`\s]+)/g,
        );
        if (fetchMatches && fetchMatches.length > 0) {
          const mentionedHosts = fetchMatches
            .map((m) => {
              const url = m.replace(/fetch\(\s*['"`]/, '');
              try {
                return new URL(url).hostname;
              } catch {
                return null;
              }
            })
            .filter((h): h is string => h !== null);
          const undeclared = mentionedHosts.filter(
            (h) => !externalDomains || !externalDomains.includes(h),
          );
          if (undeclared.length > 0) {
            const unique = [...new Set(undeclared)];
            return {
              ok: false,
              error:
                `Your addon calls fetch() on external URLs but externalDomains is missing or incomplete. ` +
                `The browser will block these requests via CSP. ` +
                `Add the following to externalDomains: [${unique.map((h) => `"${h}"`).join(', ')}]`,
            };
          }
        }
      }

      // ── Step 1: scaffold files via shared template generator ─────────────

      const generated = await generateFromTemplate(template, addonDir, {
        name,
        id,
        description,
        permissions: permissions as string[],
        ...(externalDomains ? { externalDomains } : {}),
        ...(externalImageDomains ? { externalImageDomains } : {}),
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
