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
import {
  renderSdkReference,
  listSdkPermissions,
  SDK_METHODS,
} from '../../addons/sdk-reference.js';
import { addonCreateMeta } from '../catalog.js';
import {
  isValidId,
  injectTailwindCdn,
  validateEntryScripts,
  extractExternalFetchHosts,
  TAILWIND_CDN_HOST,
} from './shared.js';

export type AddonToolDeps = {
  /** Absolute path to the root addons directory (e.g. .openaidy/addons) */
  addonsDir: string;
  /**
   * AddonService instance for registering and enabling the addon in the DB.
   * Optional — when absent the tool still writes files but skips DB registration
   * (useful in environments where the DB is not configured).
   */
  addonService?: AddonService;
  /**
   * Per-addon storage engine. Required by the addon_run / addon_list_queries
   * tools; absent when storage is unavailable.
   */
  storageEngine?: import('../../addons/storage/engine').AddonStorageEngine;
};

// ── SDK snippet helpers (derived from sdk-reference — no hardcoding) ──────────

function sdkBootstrapSnippet(): string {
  return `// Bootstrap: signal ready to the parent, then call your logic inside OpenAidy.ready().
// The SDK is loaded statically via <script src="/sdk/openaidy-sdk.js"> in index.html.
window.parent.postMessage({ type: 'ADDON_READY' }, '*');
OpenAidy.ready(function(sdk) {
  // your addon logic here — sdk is fully initialized
});`;
}

export function buildSdkUsageComment(permissions: string[]): string {
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
  const validPermissions = listSdkPermissions().join(', ');

  return {
    name: addonCreateMeta.name,

    description: [
      'Scaffold a new OpenAidy addon, register it in the database, and enable it.',
      'The addon appears in the sidebar immediately — no restart needed.',
      '',
      'WHERE ADDONS LIVE',
      '─────────────────',
      'Addons live in a dedicated directory managed by OpenAidy (its addons dir),',
      'which is SEPARATE from your agent workspace. Your workspace_read /',
      'workspace_write / code_edit / code_read / exec_run tools operate on the',
      'workspace and CANNOT create or change an addon in a way the addon loader',
      'picks up — files written there are simply ignored by the addon system.',
      '',
      'ONLY WAY TO CREATE AN ADDON',
      '───────────────────────────',
      'Use THIS tool (addon_create). It writes the files in the correct directory',
      'AND registers + enables the addon in one step. Do NOT use workspace_write,',
      'code_edit, or exec_run to scaffold addon files — even if a path looks right,',
      'the loader will not see them and the addon will silently never appear.',
      'To modify an existing addon, use addon_update (never generic file tools).',
      '',
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
      'STYLING: TAILWIND CSS + sdk.ui.* COMPONENTS',
      '────────────────────────────────────────────',
      'Tailwind CSS is auto-injected into every addon — use utility classes freely,',
      'no setup needed. For common UI (cards, buttons, tables, dialogs, forms, toasts,',
      'etc.) prefer the built-in sdk.ui.* component library over hand-rolled HTML: it is',
      'accessible (ARIA, keyboard nav, focus management), responsive, and already styled',
      'to match the platform. Every sdk.ui.* method returns a real HTMLElement — build it',
      'and append it, e.g. document.body.appendChild(sdk.ui.card({ title: "Hi" })).',
      'See the UI section of the reference below for the full list with parameters, or',
      'fetch GET /sdk/components.json at runtime for a machine-readable manifest.',
      '',
      '',
      "THEMING: THE ADDON MUST FOLLOW THE HOST APP'S LIGHT/DARK MODE",
      '────────────────────────────────────────────────────────────',
      "The SDK automatically mirrors the host app's current theme onto the addon's",
      'document (a `dark` class on <html>, kept in sync live as the user toggles it —',
      'no addon code required for this mechanism). But that only helps colors that are',
      'theme-aware in the first place:',
      '  - Every sdk.ui.* component already handles both modes — prefer it.',
      '  - For any hand-rolled Tailwind classes, ALWAYS pair a light color with its',
      '    dark: variant, e.g. `bg-white dark:bg-gray-900`, `text-gray-900 dark:text-gray-100`.',
      'Never hardcode a single fixed color (e.g. just `bg-white` with no dark: pair) for',
      'any surface, text, or border — it will look broken (wrong contrast, mismatched',
      'with the rest of the app) whenever the user is in the other mode from what you',
      'happened to design for.',
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
      'Example — addon that plays a remotely-hosted audio file (e.g. a TTS URL):',
      '  externalMediaDomains: ["oss.minimax.io"]',
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
      'STORAGE (optional — give the addon its own database)',
      '────────────────────────────────────────────────────',
      'Pass the `storage` parameter to give the addon a private SQLite database — use it',
      'for anything that accumulates data (notes, contacts, logs, trackers, caches).',
      'Declare tables in storage.migrations (applied automatically, so they exist even before',
      'the UI runs). The UI reads/writes via sdk.storage.* — add "storage.read"/"storage.write"',
      'to permissions for that. To let AGENTS work with the data, set storage.agentAccess',
      '("read" or "readwrite") and declare storage.agentQueries: named, parameterized queries',
      'the agent runs by name via the addon_run tool (agents never write raw SQL).',
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
            `Valid base values: ${validPermissions}. Only request what you actually use. ` +
            'Append ":<agentId>" to agents.invoke or workspace.write to scope it to one agent ' +
            'instead of granting it for every agent (e.g. "workspace.write:my-agent"). ' +
            'NOTE: sessions are created automatically by agents.invoke — there is no sessions.create permission. ' +
            'sessions.write = send a message via sdk.sendMessage() or attach a file via sdk.attachFile(). ' +
            "workspace.write = share a file into an agent's workspace via sdk.shareFile(). " +
            'media.read = record audio (sdk.media.recordAudio) and/or take a photo (sdk.media.takePhoto) via the host — ' +
            'scope with ":microphone" or ":camera" to grant only one. Playing the returned data: URL back ' +
            '(<audio src>/<img src>) works automatically once media.read is granted — no externalDomains needed. ' +
            'Playing back a REMOTELY hosted file instead (e.g. <audio src="https://..."> pointing at a TTS/CDN ' +
            'host) needs externalMediaDomains, not media.read.',
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
        externalMediaDomains: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Bare hostnames the addon is allowed to play audio/video from ' +
            '(e.g. ["oss.minimax.io"]). Enforced via CSP media-src. Use this for ' +
            '<audio src="https://...">/<video src="https://..."> pointing at a remotely-hosted file — ' +
            "separate from the data: playback that media.read already grants for the addon's own recordings.",
        },
        files: {
          type: 'object',
          description:
            'Required. Must contain at minimum "app/index.html" and "app/index.js". ' +
            '"app/index.html" must end with <script src="index.js"></script> just before </body>. ' +
            'Paths must be relative with no ".." segments. Do not include "addon.json".',
          additionalProperties: { type: 'string' },
        },
        storage: {
          type: 'object',
          description:
            'Optional. Gives the addon its own private SQLite database. ' +
            'Declare the schema in `migrations` (ordered SQL DDL, applied automatically — so tables exist even before the UI runs). ' +
            "The UI reads/writes it via the storage SDK (sdk.storage.kv.*, sdk.storage.query/exec/search) — add 'storage.read' and/or 'storage.write' to `permissions` for that. " +
            "To let AGENTS use the data, set `agentAccess` ('read' or 'readwrite') and declare `agentQueries`: named, parameterized queries the agent runs by name (agents never write raw SQL). " +
            'Example: { "migrations": ["CREATE TABLE notes (id INTEGER PRIMARY KEY, title TEXT, created_at TEXT DEFAULT (datetime(\'now\')))"], "agentAccess": "readwrite", "agentQueries": [{ "name": "add_note", "description": "Add a note", "params": { "title": "string" }, "access": "write", "sql": "INSERT INTO notes (title) VALUES (:title)" }, { "name": "recent_notes", "description": "Most recent notes", "access": "read", "sql": "SELECT title FROM notes ORDER BY created_at DESC LIMIT 20" }] }',
          properties: {
            migrations: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Ordered SQL DDL statements applied once, by index (CREATE TABLE / INDEX / VIRTUAL TABLE ... USING fts5). No BEGIN/COMMIT; no ATTACH/DETACH.',
            },
            agentAccess: {
              type: 'string',
              enum: ['read', 'readwrite'],
              description:
                "Opt the addon's data into agent access. 'read' allows read queries; 'readwrite' also allows write queries.",
            },
            agentQueries: {
              type: 'array',
              description:
                'Named, parameterized queries agents can run via addon_run. Each: { name, description, params?: {name: "string"|"int"|"number"|"boolean"}, access: "read"|"write", sql (use :name for params) }.',
              items: { type: 'object' },
            },
          },
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
      const externalMediaDomains = Array.isArray(args['externalMediaDomains'])
        ? (args['externalMediaDomains'] as string[])
        : undefined;
      const storage =
        args['storage'] && typeof args['storage'] === 'object'
          ? (args['storage'] as Record<string, unknown>)
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
          const scriptError = validateEntryScripts(html);
          if (scriptError) return { ok: false, error: scriptError };
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
        extraFiles[filePath] =
          filePath === 'app/index.html' ? injectTailwindCdn(content) : content;
      }

      // ── Validate externalDomains: detect undeclared external fetch() calls ─
      {
        const allContent = Object.values(extraFiles).join('\n');
        const undeclared = extractExternalFetchHosts(allContent).filter(
          (h) => !externalDomains || !externalDomains.includes(h),
        );
        if (undeclared.length > 0) {
          return {
            ok: false,
            error:
              `Your addon calls fetch() on external URLs but externalDomains is missing or incomplete. ` +
              `The browser will block these requests via CSP. ` +
              `Add the following to externalDomains: [${undeclared.map((h) => `"${h}"`).join(', ')}]`,
          };
        }
      }

      // ── Step 1: scaffold files via shared template generator ─────────────

      // The Tailwind CDN <script> is auto-injected above; document it in the
      // manifest's externalDomains too (informational — script-src for it is
      // enforced as a fixed platform allowance, see routes/addons.ts).
      const externalDomainsWithTailwind = Array.from(
        new Set([...(externalDomains ?? []), TAILWIND_CDN_HOST]),
      );

      const generated = await generateFromTemplate(template, addonDir, {
        name,
        id,
        description,
        permissions: permissions as string[],
        externalDomains: externalDomainsWithTailwind,
        ...(externalImageDomains ? { externalImageDomains } : {}),
        ...(externalMediaDomains ? { externalMediaDomains } : {}),
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

      // Merge the declared storage block into the scaffolded addon.json so the
      // on-disk manifest reflects it (and the DB registration below picks it up).
      // The full storage schema is validated by installAddon's manifest validator.
      if (storage) {
        const { readFileSync, writeFileSync } = await import('node:fs');
        const manifestPath = join(addonDir, 'addon.json');
        const m = JSON.parse(readFileSync(manifestPath, 'utf-8')) as Record<
          string,
          unknown
        >;
        m.storage = storage;
        writeFileSync(manifestPath, JSON.stringify(m, null, 2), 'utf-8');
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
