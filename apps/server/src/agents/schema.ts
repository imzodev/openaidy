import { z } from 'zod';
import type { McpServerRef } from '@openaidy/shared-types';

/**
 * Workspace permissions schema
 *
 * Defines what operations an agent can perform on a workspace.
 */
export const WorkspacePermissionsSchema = z.object({
  read: z.boolean().default(true),
  write: z.boolean().default(false),
  delete: z.boolean().default(false),
  list: z.boolean().default(true),
});

/**
 * TypeScript type for workspace permissions
 */
export type WorkspacePermissions = z.infer<typeof WorkspacePermissionsSchema>;

/**
 * Workspace schema
 *
 * Defines a single workspace with its path and permissions.
 */
export const WorkspaceSchema = z.object({
  path: z.string().min(1),
  permissions: WorkspacePermissionsSchema.optional(),
  // Optional glob patterns for file filtering
  include: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
});

/**
 * TypeScript type for workspace
 */
export type Workspace = z.infer<typeof WorkspaceSchema>;

/**
 * Workspace configuration schema
 *
 * Top-level workspace configuration for an agent.
 */
export const WorkspaceConfigSchema = z.object({
  enabled: z.boolean().default(true),
  defaultPermissions: WorkspacePermissionsSchema.optional(),
  workspaces: z.array(WorkspaceSchema).default([]),
});

/**
 * TypeScript type for workspace config
 */
export type WorkspaceConfig = z.infer<typeof WorkspaceConfigSchema>;

/**
 * MCP server reference schema
 *
 * References an MCP server from the app configuration.
 * Allows agents to use tools provided by MCP servers.
 */
export const McpServerRefSchema = z.object({
  /** MCP server ID from config */
  id: z.string().min(1),
  /** Specific tools to expose (empty = all tools from server) */
  tools: z.array(z.string()).optional(),
});

/**
 * TypeScript type for MCP server reference — re-exported from shared-types.
 * The Zod schema above is kept for runtime validation; the TS type comes from
 * the shared package so all consumers (server, CLI, web) use one definition.
 */
export type { McpServerRef };

/**
 * Agent definition schema
 *
 * Defines an agent with its configuration and metadata.
 * Stored as JSON files in config/agents/*.json
 */
export const AgentSchema = z.object({
  // Required fields
  id: z.string().min(1),
  name: z.string().min(1),
  enabled: z.boolean(),
  systemPrompt: z.string().min(1),

  // Optional fields
  // Format: "providerId/modelId" e.g., "openai/gpt-4o-mini". Optional so a
  // fresh install can ship an agent with no model; it inherits the config
  // default at runtime (set once the first provider is connected).
  model: z.string().min(1).optional(),
  description: z.string().optional(),

  // MCP server references - tools from external MCP server processes
  mcpServers: z.array(McpServerRefSchema).optional(),

  // Builtin (native, in-process) tool names to enable for this agent.
  // These are separate from mcpServers — they run in-process, no external server needed.
  // Available names are defined in apps/server/src/tools/.
  // Example: ["workspace_read", "workspace_list", "workspace_write", "workspace_delete"]
  tools: z.array(z.string()).optional(),

  // Skill IDs assigned to this agent.
  // These are loaded from .openaidy/skills/ and appended to the system prompt at dispatch time.
  skills: z.array(z.string()).optional(),

  tags: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
  version: z.number().int().positive().default(1),
  defaults: z
    .object({
      temperature: z.number().min(0).max(2).optional(),
      maxTokens: z.number().int().positive().optional(),
    })
    .optional(),
  // Workspace configuration (optional)
  workspace: WorkspaceConfigSchema.optional(),
});

/**
 * TypeScript type inferred from Zod schema
 */
export type Agent = z.infer<typeof AgentSchema>;

/**
 * Agent summary for list endpoints
 */
export type AgentSummary = {
  id: string;
  name: string;
  description: string | undefined;
  enabled: boolean;
  tags: string[] | undefined;
  tools: string[] | undefined;
  skills: string[] | undefined;
  mcpServers: McpServerRef[] | undefined;
  model: string | undefined; // Format: "providerId/modelId"; undefined = inherit config default
  workspace?: WorkspaceConfig | undefined;
};

/**
 * Custom validation error structure
 */
export type AgentValidationIssue = {
  code: string;
  message: string;
  path: (string | number)[];
};

/**
 * Validation error with file path context
 */
export type AgentValidationError = {
  filePath: string;
  errors: AgentValidationIssue[];
};

/**
 * Parse and validate an agent JSON file
 */
export function parseAgent(
  json: unknown,
  filePath: string,
): Agent | AgentValidationError {
  const result = AgentSchema.safeParse(json);

  if (!result.success) {
    return {
      filePath,
      errors: result.error.errors.map((e) => ({
        code: e.code,
        message: e.message,
        path: e.path,
      })),
    };
  }

  return result.data;
}

/**
 * Check if id matches filename (without .json extension)
 */
export function validateAgentIdMatch(
  agentId: string,
  fileName: string,
): boolean {
  const expectedId = fileName.replace(/\.json$/, '');
  return agentId === expectedId;
}

/**
 * Convert agent to summary format
 */
export function toAgentSummary(agent: Agent): AgentSummary {
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    enabled: agent.enabled,
    tags: agent.tags,
    tools: agent.tools,
    skills: agent.skills,
    mcpServers: agent.mcpServers,
    model: agent.model,
    workspace: agent.workspace,
  };
}

/**
 * Parse model string into providerId and modelId
 * Model format: "providerId/modelId"
 */
export function parseModelString(
  model: string,
): { providerId: string; modelId: string } | null {
  const parts = model.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return null;
  }
  return { providerId: parts[0], modelId: parts[1] };
}

/**
 * Get workspace configuration from an agent
 * Returns undefined if workspace is not configured or disabled
 */
export function getAgentWorkspace(agent: Agent): WorkspaceConfig | undefined {
  if (!agent.workspace || !agent.workspace.enabled) {
    return undefined;
  }
  return agent.workspace;
}
