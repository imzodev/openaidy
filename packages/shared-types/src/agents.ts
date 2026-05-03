/**
 * Types that belong in packages/shared-types/src/:
 *   - Types used across two or more packages (CLI, server, web, SDK, etc.)
 *   - API request/response contracts shared between server and clients
 *   - Domain types that are not internal to a single package
 *
 * Types that do NOT belong here:
 *   - Server-only internal types → apps/server/src/types.ts
 *   - CLI-only internal types    → packages/cli/src/types.ts
 *   - Web-only UI types          → apps/web/src/lib/types.ts (pending refactor)
 */

/**
 * A reference from an agent to a globally-configured MCP server.
 * Stored in the agent config under `mcpServers[]`.
 * The `id` must match an entry in the top-level `mcpServers` array of openaidy.json.
 * The optional `tools` list restricts which server tools are exposed to the agent;
 * an absent or empty list means "all tools from this server".
 */
export type McpServerRef = {
  id: string;
  tools?: string[] | undefined;
};

/**
 * Minimal user-provided fields for creating a new agent.
 * Structural defaults (version, enabled, workspace scaffold) are applied
 * by the server's AgentRegistry.createAgent().
 */
export type CreateAgentInput = {
  id: string;
  name: string;
  systemPrompt: string;
  model: string;
  description?: string;
  tags?: string[];
  skills?: string[];
};
