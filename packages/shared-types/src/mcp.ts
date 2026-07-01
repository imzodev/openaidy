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
  name?: string | undefined;
  transport: McpServerTransport;
  command?: string | undefined;
  args?: string[] | undefined;
  env?: Record<string, string> | undefined;
  url?: string | undefined;
  headers?: Record<string, string> | undefined;
};

/**
 * Runtime status of a single MCP tool
 */
export type McpToolSummary = {
  name: string;
  description?: string | undefined;
};

/**
 * Full MCP server record combining persisted config + live runtime status.
 * Returned by GET /mcp/servers
 */
export type McpServerRecord = McpServerTransportConfig & {
  /** Live runtime state */
  connected: boolean;
  toolCount: number;
  tools: McpToolSummary[];
};

/**
 * Request body for creating a new MCP server config
 */
export type CreateMcpServerRequest = McpServerTransportConfig;

/**
 * Request body for updating an existing MCP server config
 */
export type UpdateMcpServerRequest = Omit<
  Partial<McpServerTransportConfig>,
  'id'
>;

/**
 * MCP tool with its input schema exposed (for UI exploration)
 */
export type McpToolWithSchema = {
  name: string;
  description?: string | undefined;
  inputSchema: Record<string, unknown>;
};

/**
 * A single MCP server entry in the widely-used keyed-map config format
 * (Claude Desktop / VS Code / Cursor). Transport may be given as `type` or
 * `transport`, or omitted and inferred from `command` (stdio) vs `url` (http).
 * Values are intentionally permissive strings — the server normalises and
 * validates them.
 */
export type McpServerImportEntry = {
  type?: string | undefined;
  transport?: string | undefined;
  name?: string | undefined;
  command?: string | undefined;
  args?: string[] | undefined;
  env?: Record<string, string> | undefined;
  url?: string | undefined;
  headers?: Record<string, string> | undefined;
};

/**
 * Request body for POST /mcp/servers/import — the standard `mcpServers` map
 * keyed by server id.
 */
export type ImportMcpServersRequest = {
  mcpServers: Record<string, McpServerImportEntry>;
};
