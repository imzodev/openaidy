/**
 * MCP Server shared types
 *
 * These types are shared between the server and the frontend.
 */

/**
 * MCP server transport type
 */
export type McpServerTransport = 'stdio' | 'http';

/**
 * MCP server transport config fields (shared shape for both transports)
 */
export type McpServerTransportConfig = {
  id: string;
  name?: string;
  transport: McpServerTransport;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
};

/**
 * Runtime status of a single MCP tool
 */
export type McpToolSummary = {
  name: string;
  description?: string;
};

/**
 * Full MCP server record combining persisted config + live runtime status.
 * Returned by GET /mcp/servers
 */
export type McpServerRecord = {
  /** Persisted config */
  id: string;
  name?: string;
  transport: McpServerTransport;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  /** Live runtime state */
  connected: boolean;
  toolCount: number;
  tools: McpToolSummary[];
};

/**
 * Request body for creating a new MCP server config
 */
export type CreateMcpServerRequest = {
  id: string;
  name?: string;
  transport: McpServerTransport;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
};

/**
 * Request body for updating an existing MCP server config
 */
export type UpdateMcpServerRequest = {
  name?: string;
  transport?: McpServerTransport;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
};

/**
 * MCP tool with its input schema exposed (for UI exploration)
 */
export type McpToolWithSchema = {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
};
