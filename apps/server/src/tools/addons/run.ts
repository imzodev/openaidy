/**
 * addon_run / addon_list_queries
 *
 * The agent-facing half of addon storage. Agents never write SQL against an
 * addon's DB — they discover the named queries an addon exposes
 * (`addon_list_queries`) and run them by name with typed parameters
 * (`addon_run`). See packages/shared-types AddonAgentQuerySchema and
 * ../../addons/storage/agent-queries.ts.
 */
import type { BuiltinTool } from '@openaidy/runtime';
import type { AddonToolDeps } from './create.js';
import {
  AddonAgentQueryService,
  AgentQueryDenied,
} from '../../addons/storage/agent-queries.js';
import { addonRunMeta, addonListQueriesMeta } from '../catalog.js';

export function createAddonListQueriesTool(deps: AddonToolDeps): BuiltinTool {
  return {
    name: addonListQueriesMeta.name,
    description: addonListQueriesMeta.description,
    parameters: {
      type: 'object',
      properties: {
        addon_id: {
          type: 'string',
          description:
            'Optional — restrict the catalog to a single addon by its id.',
        },
      },
    },
    execute: async (args) => {
      if (!deps.addonService || !deps.storageEngine) {
        return { ok: false, error: 'Addon storage is not available' };
      }
      const service = new AddonAgentQueryService(deps.storageEngine);
      const filterId = args.addon_id ? String(args.addon_id) : undefined;

      const { addons } = await deps.addonService.listAddons({
        status: 'enabled',
      });
      const catalog: Array<{
        addon_id: string;
        name: string;
        queries: Array<{
          name: string;
          description: string;
          params: Record<string, string>;
          access: string;
        }>;
      }> = [];
      for (const addon of addons) {
        if (filterId && addon.addonId !== filterId) continue;
        const queries = service.list(addon);
        if (queries.length === 0) continue;
        catalog.push({
          addon_id: addon.addonId,
          name: addon.name,
          queries: queries.map((q) => ({
            name: q.name,
            description: q.description,
            params: q.params ?? {},
            access: q.access ?? 'read',
          })),
        });
      }
      return { ok: true, content: JSON.stringify(catalog, null, 2) };
    },
  };
}

export function createAddonRunTool(deps: AddonToolDeps): BuiltinTool {
  return {
    name: addonRunMeta.name,
    description: addonRunMeta.description,
    parameters: {
      type: 'object',
      properties: {
        addon_id: {
          type: 'string',
          description: 'Id of the addon whose query to run.',
        },
        query: {
          type: 'string',
          description:
            'Name of a query the addon exposes (from addon_list_queries).',
        },
        params: {
          type: 'object',
          description:
            "The query's declared parameters, keyed by name. Types are coerced/validated against the declaration.",
        },
      },
      required: ['addon_id', 'query'],
    },
    execute: async (args) => {
      const addonId = String(args.addon_id ?? '');
      const query = String(args.query ?? '');
      const params = (args.params ?? {}) as Record<string, unknown>;
      if (!addonId || !query) {
        return { ok: false, error: 'addon_id and query are required' };
      }
      if (!deps.addonService || !deps.storageEngine) {
        return { ok: false, error: 'Addon storage is not available' };
      }
      const addon = await deps.addonService.getAddon(addonId);
      if (!addon) {
        return { ok: false, error: `Addon "${addonId}" not found` };
      }
      if (addon.status !== 'enabled') {
        return { ok: false, error: `Addon "${addonId}" is not enabled` };
      }

      const service = new AddonAgentQueryService(deps.storageEngine);
      try {
        const result = service.run(addon, query, params);
        if (result.kind === 'rows') {
          return {
            ok: true,
            content: JSON.stringify({ rows: result.rows }, null, 2),
          };
        }
        return {
          ok: true,
          content: JSON.stringify({
            changes: result.changes,
            lastInsertRowid: Number(result.lastInsertRowid),
          }),
        };
      } catch (err) {
        if (err instanceof AgentQueryDenied) {
          return { ok: false, error: `${err.code}: ${err.message}` };
        }
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'Query failed',
        };
      }
    },
  };
}
