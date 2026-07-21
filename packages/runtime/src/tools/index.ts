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
  readonly additionalProperties?: ToolParameterSchema | boolean;
};

/**
 * Tool definition shape (sent to the model — no executor)
 */
export type ToolDefinition = {
  readonly name: string;
  readonly description: string;
  readonly parameters: ToolParameterSchema;
};

/**
 * Context passed to every builtin tool at execution time.
 * Extend this interface when new capabilities need to be surfaced to tools.
 */
export type BuiltinToolContext = {
  /** The agent that is invoking this tool */
  readonly agentId: string;
  /** The session in which the tool is being invoked */
  readonly sessionId?: string;
  /**
   * Fired when the user cancels this in-flight tool call. Tools that run
   * long/interruptible work (e.g. exec_run) should honor it; tools that ignore
   * it keep working unchanged.
   */
  readonly signal?: AbortSignal;
  /**
   * Stream partial output to the UI while the tool runs. The host wires this to
   * emit per-chunk events addressed to this tool call. Optional — tools that
   * don't produce incremental output ignore it.
   */
  readonly onOutput?: (chunk: {
    stream: 'stdout' | 'stderr';
    data: string;
  }) => void;
};

/**
 * A builtin (native, in-process) tool.
 *
 * Unlike MCP tools — which are executed by an external process — builtin tools
 * run inside the server. Each tool is a plain object:
 *
 *   export const myTool: BuiltinTool = {
 *     name: 'my_tool',
 *     description: 'Does something useful',
 *     parameters: { type: 'object', properties: { ... }, required: [...] },
 *     execute: async (args, ctx) => ({ ok: true, content: '...' }),
 *   };
 *
 * Register it in the BuiltinToolRegistry and it becomes available to agents.
 */
export type BuiltinTool = ToolDefinition & {
  execute(
    args: Record<string, unknown>,
    ctx: BuiltinToolContext,
  ): Promise<{ ok: true; content: string } | { ok: false; error: string }>;
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
  parameters: ToolParameterSchema,
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
  isError?: boolean,
): ToolCallResult {
  return { toolCallId, name, content, isError: isError ?? false };
}

/**
 * Validates that a tool call request matches a tool definition
 */
export function validateToolCall(
  request: ToolCallRequest,
  definition: ToolDefinition,
): boolean {
  return request.name === definition.name;
}
