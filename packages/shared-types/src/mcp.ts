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
 * OAuth sign-in settings for a remote (http) MCP server. Omitting `clientId`
 * means the server supports dynamic client registration ("one-click").
 */
export type McpServerAuth = {
  type: 'oauth';
  clientId?: string | undefined;
  clientSecret?: McpSecretValue | undefined;
  scopes?: string[] | undefined;
};

/**
 * OAuth sign-in state of a server:
 * - `none`: the server doesn't use OAuth
 * - `signed_in`: tokens are stored
 * - `needs_sign_in`: no tokens yet, or the stored ones were rejected
 */
export type McpAuthStatus = 'none' | 'signed_in' | 'needs_sign_in';

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
  auth?: McpServerAuth | undefined;
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
  'env' | 'headers' | 'auth'
> & {
  env?: Record<string, McpSecretField> | undefined;
  headers?: Record<string, McpSecretField> | undefined;
  /** OAuth settings; `clientSecret` is redacted like any other secret. */
  auth?:
    | (Omit<McpServerAuth, 'clientSecret'> & {
        clientSecret?: McpSecretField | undefined;
      })
    | undefined;
  /** OAuth sign-in state (`none` for servers that don't use OAuth). */
  authStatus: McpAuthStatus;
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
  'id' | 'auth'
> & {
  /** An object replaces the OAuth settings; `null` removes them. */
  auth?: McpServerAuth | null | undefined;
};

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

/**
 * How connecting a catalog integration works:
 * - `oauth`: one click — the server registers OpenAidy automatically
 * - `oauth-own-app`: sign-in, but the user must first create an OAuth app
 *   with the provider and paste its client ID/secret
 */
export type McpCatalogSetup = 'oauth' | 'oauth-own-app';

export type McpCatalogCategory =
  | 'productivity'
  | 'payments'
  | 'marketing'
  | 'google'
  | 'developer';

/**
 * An alternative to sign-in for providers that also accept a pasted API
 * token, sent as `<headerName>: <valuePrefix><token>`.
 */
export type McpCatalogApiKeyOption = {
  /** What the provider calls it, e.g. "API token". */
  label: string;
  /** Where the user creates one. */
  setupUrl: string;
  headerName: string;
  valuePrefix: string;
};

/** An integration offered in the "Browse integrations" gallery. */
export type McpCatalogEntry = {
  /** Also the id of the MCP server it installs. */
  id: string;
  name: string;
  description: string;
  category: McpCatalogCategory;
  setup: McpCatalogSetup;
  /** Remote MCP endpoint. */
  url: string;
  /** Provider docs for this MCP server / creating the OAuth app. */
  docsUrl: string;
  /** Default OAuth scopes (`oauth-own-app` providers need them explicit). */
  scopes?: string[] | undefined;
  /** Set when the provider also accepts a pasted API token. */
  apiKey?: McpCatalogApiKeyOption | undefined;
  /** Whether a server with this id is already configured. */
  installed: boolean;
};

/** Body of POST /mcp/catalog/:id/install. */
export type InstallMcpCatalogEntryRequest = {
  /** Required for `oauth-own-app` entries. */
  clientId?: string | undefined;
  clientSecret?: string | undefined;
  /**
   * Connect with this API token instead of signing in. Only for entries
   * with an `apiKey` option.
   */
  apiKey?: string | undefined;
};
