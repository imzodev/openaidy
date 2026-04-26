/**
 * Builtin Tools — native, in-process tools available to agents.
 *
 * ─────────────────────────────────────────────────────────────────────
 * HOW TO ADD A NEW TOOL CATEGORY
 * ─────────────────────────────────────────────────────────────────────
 * 1. Create a directory:  src/tools/<category>/
 * 2. Implement each tool in its own file exporting a `create*Tool(deps): BuiltinTool`.
 * 3. Add a category barrel:  src/tools/<category>/index.ts
 *    that exports a `create<Category>Tools(deps): BuiltinTool[]` factory.
 * 4. Import the factory below and call it inside `createBuiltinToolRegistry`.
 * 5. Add the new tool names to the relevant agent configs under `nativeTools`.
 *
 * HOW TO ADD A SINGLE TOOL TO AN EXISTING CATEGORY
 * ─────────────────────────────────────────────────────────────────────
 * 1. Add a new file in the category directory.
 * 2. Export the `create*Tool` factory from the category barrel.
 * 3. Register it in the category's `create<Category>Tools` factory.
 * 4. Add the tool name to agent configs.
 * ─────────────────────────────────────────────────────────────────────
 */

import { BuiltinToolRegistry } from './registry';
import { createWorkspaceTools } from './workspace';
import type { WorkspaceService } from '../workspace/service';

export { BuiltinToolRegistry } from './registry';
export { createWorkspaceTools } from './workspace';

export type BuiltinToolRegistryDeps = {
  workspace: WorkspaceService;
  // Add more service dependencies here as new tool categories are introduced.
  // Example:
  //   exec?: ExecService;
  //   webSearch?: WebSearchService;
};

/**
 * Build and return the populated BuiltinToolRegistry for the server.
 *
 * Each tool category receives the services it needs via dependency injection.
 * The registry is then passed to SessionMessageService so it can look up and
 * call native tools during the agent tool-call loop — completely separate from
 * the MCP path.
 */
export function createBuiltinToolRegistry(
  deps: BuiltinToolRegistryDeps,
): BuiltinToolRegistry {
  const registry = new BuiltinToolRegistry();

  for (const tool of createWorkspaceTools(deps.workspace)) {
    registry.register(tool);
  }

  // To register future categories:
  //   for (const tool of createExecTools(deps.exec)) registry.register(tool);
  //   for (const tool of createWebSearchTools(deps.webSearch)) registry.register(tool);

  return registry;
}
