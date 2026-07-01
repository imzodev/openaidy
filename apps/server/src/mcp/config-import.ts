/**
 * MCP config import.
 *
 * Translates the widely-used keyed-map config format (Claude Desktop, VS Code,
 * Cursor, …) into this project's flat {@link McpServerConfig} shape. The map
 * key is the server id; transport comes from `transport`/`type`, or is inferred
 * from the presence of `command` (stdio) vs `url` (http).
 *
 * Example input (the `mcpServers` object of a standard config):
 *
 *   {
 *     "github": {
 *       "type": "http",
 *       "url": "https://api.githubcopilot.com/mcp/",
 *       "headers": { "Authorization": "Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}" }
 *     }
 *   }
 *
 * Single responsibility: normalisation only — no persistence, no connection.
 */

import type { McpServerConfig } from '@openaidy/config';
import type { McpServerTransport } from '@openaidy/shared-types';

/**
 * A raw MCP server entry in the keyed-map format. Transport may be given as
 * `type` or `transport`, or omitted and inferred.
 */
export type RawMcpServerEntry = {
  type?: string;
  transport?: string;
  name?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
};

/** The standard `mcpServers` map: server id → entry. */
export type RawMcpServerMap = Record<string, RawMcpServerEntry>;

/** Thrown when an entry cannot be normalised into a valid server config. */
export class McpConfigImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'McpConfigImportError';
  }
}

/** Aliases accepted for each supported transport (case-insensitive). */
const HTTP_TYPE_ALIASES = new Set([
  'http',
  'streamable-http',
  'streamablehttp',
]);
const STDIO_TYPE_ALIASES = new Set(['stdio']);

function resolveTransport(
  id: string,
  entry: RawMcpServerEntry,
): McpServerTransport {
  const declared = (entry.transport ?? entry.type)?.trim().toLowerCase();

  if (declared) {
    if (STDIO_TYPE_ALIASES.has(declared)) return 'stdio';
    if (HTTP_TYPE_ALIASES.has(declared)) return 'http';
    if (declared === 'sse') {
      throw new McpConfigImportError(
        `MCP server "${id}": the "sse" transport is not supported; use "http" (streamable HTTP).`,
      );
    }
    throw new McpConfigImportError(
      `MCP server "${id}": unknown transport "${declared}"; expected "stdio" or "http".`,
    );
  }

  // Infer from shape when transport/type is omitted.
  if (entry.command) return 'stdio';
  if (entry.url) return 'http';
  throw new McpConfigImportError(
    `MCP server "${id}": cannot determine transport — provide "type"/"transport", or a "command" (stdio) or "url" (http).`,
  );
}

/**
 * Normalise a single keyed-map entry into a {@link McpServerConfig}.
 */
export function normalizeMcpServerEntry(
  id: string,
  entry: RawMcpServerEntry,
): McpServerConfig {
  if (!id.trim()) {
    throw new McpConfigImportError(
      'MCP server id (map key) must not be empty.',
    );
  }

  const transport = resolveTransport(id, entry);

  if (transport === 'stdio' && !entry.command) {
    throw new McpConfigImportError(
      `MCP server "${id}": stdio transport requires a "command".`,
    );
  }
  if (transport === 'http' && !entry.url) {
    throw new McpConfigImportError(
      `MCP server "${id}": http transport requires a "url".`,
    );
  }

  return {
    id,
    transport,
    ...(entry.name !== undefined ? { name: entry.name } : {}),
    ...(entry.command !== undefined ? { command: entry.command } : {}),
    ...(entry.args !== undefined ? { args: entry.args } : {}),
    ...(entry.env !== undefined ? { env: entry.env } : {}),
    ...(entry.url !== undefined ? { url: entry.url } : {}),
    ...(entry.headers !== undefined ? { headers: entry.headers } : {}),
  } as McpServerConfig;
}

/**
 * Normalise a full keyed-map of MCP servers into config records. Fails if the
 * map is empty or any entry is invalid (all-or-nothing, so an import never
 * half-applies).
 */
export function normalizeMcpServerMap(map: RawMcpServerMap): McpServerConfig[] {
  const entries = Object.entries(map);
  if (entries.length === 0) {
    throw new McpConfigImportError(
      'No MCP servers to import: the "mcpServers" map is empty.',
    );
  }
  return entries.map(([id, entry]) => normalizeMcpServerEntry(id, entry));
}
