import type { BuiltinTool } from '@openaidy/runtime';
import { createAddonCreateTool, type AddonToolDeps } from './create.js';
import { createAddonUpdateTool } from './update.js';

export { createAddonCreateTool } from './create.js';
export { createAddonUpdateTool } from './update.js';
export type { AddonToolDeps } from './create.js';

/**
 * Returns all addon builtin tools.
 *
 * Register selectively per-agent via `tools` in the agent config:
 *   "tools": ["addon_create", "addon_update"]
 */
export function createAddonTools(deps: AddonToolDeps): BuiltinTool[] {
  return [createAddonCreateTool(deps), createAddonUpdateTool(deps)];
}
