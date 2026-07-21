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
 * How a secret-bearing `env`/`headers` value is sourced:
 * - `env`: a `${VAR}` reference — the secret lives in the process
 *   environment and this value is safe to display verbatim.
 * - `inline`: a value pasted directly into the form — encrypted at rest and
 *   never echoed back over the API (see `MASKED_VALUE`).
 */
export type McpSecretKind = 'env' | 'inline';

/**
 * A structured `env`/`headers` value. A plain `string` is also accepted on
 * the wire for backward compatibility with existing configs and third-party
 * import formats (Claude Desktop / VS Code / Cursor) — the server infers its
 * kind from content (does it look like a `${VAR}` reference or an inlined
 * credential?).
 */
export type McpSecretField = {
  kind: McpSecretKind;
  value: string;
};

/** A single `env`/`headers` value: structured, or a legacy plain string. */
export type McpSecretValue = string | McpSecretField;

/**
 * MCP server transport config fields (shared shape for both transports)
 */
export type McpServerTransportConfig = {
  id: string;
  name?: string | undefined;
  transport: McpServerTransport;
  command?: string | undefined;
  args?: string[] | undefined;
  env?: Record<string, McpSecretValue> | undefined;
  url?: string | undefined;
  headers?: Record<string, McpSecretValue> | undefined;
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
 * Returned by GET /mcp/servers. `env`/`headers` are always normalized to the
 * structured `{ kind, value }` shape — the server has already resolved
 * whether a legacy plain-string value counts as an env reference or an
 * inlined secret (see `redactSecrets`) — and inline values are masked.
 */
export type McpServerRecord = Omit<
  McpServerTransportConfig,
  'env' | 'headers'
> & {
  env?: Record<string, McpSecretField> | undefined;
  headers?: Record<string, McpSecretField> | undefined;
  /** Live runtime state */
  connected: boolean;
  toolCount: number;
  tools: McpToolSummary[];
  /**
   * Names of `${VAR}` secret placeholders that are referenced by this server
   * but not yet set in the server environment. Non-empty means the server is
   * awaiting configuration (e.g. an API key) and won't be auto-connected
   * until it's provided; empty means it's fully configured.
   */
  missingSecrets: string[];
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
