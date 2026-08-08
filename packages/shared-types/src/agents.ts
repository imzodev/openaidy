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
 * Pattern for a 6-digit hex color (e.g. "#7C3AED"). Single source of truth
 * for identity accent-color validation — consumed by the server's Zod
 * schema and the CLI's flag/prompt validation so both agree on one rule.
 */
export const AGENT_IDENTITY_HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/**
 * Type guard for a 6-digit hex color string.
 */
export function isAgentIdentityHexColor(value: string): value is `#${string}` {
  return AGENT_IDENTITY_HEX_COLOR_PATTERN.test(value);
}

/**
 * A renderable visual asset for an agent's identity, layered on top of the
 * emoji fallback. Discriminated by `kind` so consumers (web, CLI, future
 * addons) branch on the union instead of inspecting URLs or content-type.
 */
export type AgentIdentityAsset =
  | { kind: 'image'; url: string; alt?: string | undefined }
  | { kind: 'model3d'; url: string; format: 'gltf' | 'glb' };

/**
 * Structured visual identity for an agent: emoji + accent color, with an
 * optional avatar asset override. Optional everywhere it's consumed so
 * existing agents without an `identity` block continue to load unchanged.
 */
export type AgentIdentity = {
  emoji: string;
  accentColor: `#${string}`;
  avatar?: AgentIdentityAsset | undefined;
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
  /**
   * Id of a prebuilt personality preset (see AGENT_PERSONALITY_PRESETS). When
   * set, the server writes the preset's personality files after scaffolding
   * the new agent. Ignored by agent config storage itself.
   */
  personalityPresetId?: string;
  identity?: AgentIdentity;
};
