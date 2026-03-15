import type { ToolCallRequest } from '../messages';

/**
 * Tool parameter schema definition (JSON Schema-like)
 */
export type ToolParameterSchema = {
  readonly type: string;
  readonly description?: string;
  readonly properties?: Record<string, ToolParameterSchema>;
  readonly required?: readonly string[];
  readonly items?: ToolParameterSchema;
  readonly enum?: readonly string[];
  readonly default?: unknown;
};

/**
 * Tool definition shape
 */
export type ToolDefinition = {
  readonly name: string;
  readonly description: string;
  readonly parameters: ToolParameterSchema;
};

/**
 * Tool call result shape (from tool execution back to provider)
 */
export type ToolCallResult = {
  readonly toolCallId: string;
  readonly name: string;
  readonly content: string;
  readonly isError?: boolean;
};

/**
 * Creates a tool definition
 */
export function createToolDefinition(
  name: string,
  description: string,
  parameters: ToolParameterSchema
): ToolDefinition {
  return { name, description, parameters };
}

/**
 * Creates a tool call result
 */
export function createToolCallResult(
  toolCallId: string,
  name: string,
  content: string,
  isError?: boolean
): ToolCallResult {
  return { toolCallId, name, content, isError: isError ?? false };
}

/**
 * Validates that a tool call request matches a tool definition
 */
export function validateToolCall(
  request: ToolCallRequest,
  definition: ToolDefinition
): boolean {
  return request.name === definition.name;
}
