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
