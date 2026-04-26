import type { BuiltinTool, ToolDefinition } from '@openaidy/runtime';

/**
 * BuiltinToolRegistry
 *
 * Central registry for all native (in-process) tools.
 *
 * How to add a new tool
 * ---------------------
 * 1. Create a file in `apps/server/src/tools/<category>/<tool-name>.ts`
 *    that exports a `const myTool: BuiltinTool = { ... }`.
 * 2. Import and pass it to `registry.register(myTool)` in
 *    `apps/server/src/tools/index.ts` (or the category barrel).
 * 3. Add the tool name to the agent's `nativeTools` list in its config.
 *
 * That's it — no changes needed in sessions/service.ts or the tool-call loop.
 */
export class BuiltinToolRegistry {
  private readonly tools = new Map<string, BuiltinTool>();

  /**
   * Register a builtin tool. Throws if a tool with the same name is already registered.
   */
  register(tool: BuiltinTool): this {
    if (this.tools.has(tool.name)) {
      throw new Error(
        `BuiltinToolRegistry: tool "${tool.name}" is already registered`,
      );
    }
    this.tools.set(tool.name, tool);
    return this;
  }

  /**
   * Look up a tool by name. Returns undefined if not found.
   */
  get(name: string): BuiltinTool | undefined {
    return this.tools.get(name);
  }

  /**
   * Return the ToolDefinition[] (schema only, no executor) for a given set of
   * tool names. Silently skips names that are not registered.
   * Used to populate the `tools` field in a ModelRequest.
   */
  getDefinitions(names: string[]): ToolDefinition[] {
    const defs: ToolDefinition[] = [];
    for (const name of names) {
      const tool = this.tools.get(name);
      if (tool) {
        defs.push({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        });
      }
    }
    return defs;
  }

  /**
   * Return all registered ToolDefinitions (schema only, no executor).
   * Used by the /tools API endpoint to expose available tools to clients.
   */
  getAllDefinitions(): ToolDefinition[] {
    return [...this.tools.values()].map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }));
  }

  /**
   * All registered tool names (useful for validation / logging).
   */
  get registeredNames(): string[] {
    return [...this.tools.keys()];
  }
}
