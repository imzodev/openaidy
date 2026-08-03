import type { BuiltinTool } from '@openaidy/runtime';
import { createAddonCreateTool, type AddonToolDeps } from './create.js';
import { createAddonUpdateTool } from './update.js';
import { createAddonReadTool } from './read.js';
import { createAddonRunTool, createAddonListQueriesTool } from './run.js';

export { createAddonCreateTool } from './create.js';
export { createAddonUpdateTool } from './update.js';
export { createAddonReadTool } from './read.js';
export { createAddonRunTool, createAddonListQueriesTool } from './run.js';
export type { AddonToolDeps } from './create.js';

/**
 * Returns all addon builtin tools.
 *
 * Register selectively per-agent via `tools` in the agent config:
 *   "tools": ["addon_create", "addon_read", "addon_update", "addon_run", "addon_list_queries"]
 */
export function createAddonTools(deps: AddonToolDeps): BuiltinTool[] {
  return [
    createAddonCreateTool(deps),
    createAddonReadTool(deps),
    createAddonUpdateTool(deps),
    createAddonRunTool(deps),
    createAddonListQueriesTool(deps),
  ];
}
