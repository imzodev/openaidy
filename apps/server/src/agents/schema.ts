import { z } from 'zod';

/**
 * Agent defaults schema
 * 
 * Default provider/model configuration for an agent.
 */
export const AgentDefaultsSchema = z.object({
  providerId: z.string().optional(),
  modelId: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
});

/**
 * Agent definition schema
 * 
 * Defines an agent with its configuration, defaults, and metadata.
 * Stored as JSON files in config/agents/*.json
 */
export const AgentSchema = z.object({
  // Required fields
  id: z.string().min(1),
  name: z.string().min(1),
  enabled: z.boolean(),
  systemPrompt: z.string().min(1),
  defaults: AgentDefaultsSchema,

  // Optional fields
  description: z.string().optional(),
  tools: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
  version: z.number().int().positive().default(1),
});

/**
 * TypeScript types inferred from Zod schemas
 */
export type AgentDefaults = z.infer<typeof AgentDefaultsSchema>;
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
export function parseAgent(json: unknown, filePath: string): Agent | AgentValidationError {
  const result = AgentSchema.safeParse(json);
  
  if (!result.success) {
    return {
      filePath,
      errors: result.error.errors.map(e => ({
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
export function validateAgentIdMatch(agentId: string, fileName: string): boolean {
  const expectedId = fileName.replace(/\.json$/, '');
  return agentId === expectedId;
}

/**
 * Convert agent to summary format
 */
export function toAgentSummary(agent: Agent): AgentSummary {
  const summary: AgentSummary = {
    id: agent.id,
    name: agent.name,
    enabled: agent.enabled,
  };
  
  if (agent.description !== undefined) {
    summary.description = agent.description;
  }
  
  if (agent.tags !== undefined) {
    summary.tags = agent.tags;
  }
  
  return summary;
}
