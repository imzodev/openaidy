import { z } from 'zod';

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
  model: z.string().min(1), // Format: "providerId/modelId" e.g., "openai/gpt-4o-mini"

  // Optional fields
  description: z.string().optional(),
  tools: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
  version: z.number().int().positive().default(1),
  defaults: z
    .object({
      temperature: z.number().min(0).max(2).optional(),
      maxTokens: z.number().int().positive().optional(),
    })
    .optional(),
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
  description?: string | undefined;
  enabled: boolean;
  tags?: string[] | undefined;
  tools?: string[] | undefined;
  model: string; // Format: "providerId/modelId"
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
    model: agent.model,
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
