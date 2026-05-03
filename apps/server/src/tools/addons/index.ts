import type { BuiltinTool } from '@openaidy/runtime';
import { createAddonCreateTool, type AddonToolDeps } from './create.js';

export { createAddonCreateTool } from './create.js';
export type { AddonToolDeps } from './create.js';

/**
 * Returns all addon builtin tools.
 *
 * Register selectively per-agent via `tools` in the agent config:
 *   "tools": ["addon_create"]
 */
export function createAddonTools(deps: AddonToolDeps): BuiltinTool[] {
  return [createAddonCreateTool(deps)];
}
