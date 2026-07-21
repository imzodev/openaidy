/**
 * MCP Import Command Handler
 *
 * Implements `openaidy mcp import [file]`.
 *
 * Reads a standard MCP config in the keyed-map format (Claude Desktop /
 * VS Code / Cursor) from a file argument or stdin and POSTs it to
 * POST /api/mcp/servers/import. Secrets are referenced with ${ENV_VAR}
 * placeholders and resolved server-side from the server environment.
 */

import * as p from '@clack/prompts';
import { readFile } from 'node:fs/promises';
import { readAdminToken } from '../../lib/admin-token.js';
import { resolveCLIConfig } from '../../lib/config.js';
import type { CommandResult } from '../../types.js';
import type { ImportMcpServersRequest } from '@openaidy/shared-types';

/** Read all of stdin as a UTF-8 string (for `… | openaidy mcp import`). */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function mcpImportHandler(args: string[]): Promise<CommandResult> {
  if (args.includes('-h') || args.includes('--help')) {
    p.note(
      `Usage: openaidy mcp import [file]

Import one or more MCP servers from a standard config file (or stdin).
Accepts the keyed-map format used by Claude Desktop, VS Code and Cursor —
either the full { "mcpServers": { … } } wrapper or a bare { "<id>": { … } }
map. Transport is taken from "type"/"transport" or inferred from command/url.

Reference secrets with \${ENV_VAR} placeholders; they are resolved from the
server environment at connection time and never persisted in plaintext.

Arguments:
  file    Path to a JSON config file. Omit (or use "-") to read from stdin.

Examples:
  openaidy mcp import ./mcp.json
  cat ~/.config/mcp.json | openaidy mcp import

Exit Codes:
  0  Servers imported successfully
  1  Server unreachable, not authenticated, or import rejected
  2  Missing/invalid input`,
      'mcp import',
    );
    return { exitCode: 0 };
  }

  const fileArg = args.find((a) => !a.startsWith('-'));

  // Load raw config from the file argument, or stdin when omitted / "-".
  let raw: string;
  try {
    raw =
      fileArg && fileArg !== '-'
        ? await readFile(fileArg, 'utf8')
        : await readStdin();
  } catch (err) {
    const msg = `Cannot read config: ${err instanceof Error ? err.message : String(err)}`;
    p.log.error(msg);
    return { exitCode: 2, error: msg };
  }

  if (!raw.trim()) {
    const msg = 'No config provided. Pass a file path or pipe JSON via stdin.';
    p.log.error(msg);
    return { exitCode: 2, error: msg };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const msg = 'Invalid JSON in MCP config.';
    p.log.error(msg);
    return { exitCode: 2, error: msg };
  }

  // Accept the standard `{ "mcpServers": { … } }` wrapper or a bare map.
  const map =
    parsed && typeof parsed === 'object' && 'mcpServers' in parsed
      ? (parsed as { mcpServers: unknown }).mcpServers
      : parsed;

  if (!map || typeof map !== 'object' || Array.isArray(map)) {
    const msg = 'Expected an object mapping server ids to their config.';
    p.log.error(msg);
    return { exitCode: 2, error: msg };
  }

  const config = resolveCLIConfig();
  const token = await readAdminToken(config.tokenPath);
  if (!token.ok) {
    p.log.error(token.error);
    return { exitCode: 1, error: token.error };
  }

  const body: ImportMcpServersRequest = {
    mcpServers: map as ImportMcpServersRequest['mcpServers'],
  };

  const s = p.spinner();
  s.start('Importing MCP servers…');

  let res: Response;
  try {
    res = await fetch(`${config.httpUrl}/api/mcp/servers/import`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    s.stop('Failed.');
    const msg = `Cannot reach server at ${config.httpUrl}.\n${err instanceof Error ? err.message : String(err)}`;
    p.log.error(msg);
    return { exitCode: 1, error: msg };
  }

  if (!res.ok) {
    s.stop('Failed.');
    const errBody = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
    };
    const msg =
      errBody.message ?? `Server returned ${res.status}: ${res.statusText}`;
    p.log.error(msg);
    return { exitCode: 1, error: msg };
  }

  const { servers } = (await res.json()) as {
    servers: Array<{
      id: string;
      transport: string;
      connected: boolean;
      toolCount: number;
    }>;
  };

  s.stop(
    `Imported ${servers.length} MCP server${servers.length !== 1 ? 's' : ''}.`,
  );
  for (const srv of servers) {
    const status = srv.connected
      ? `connected · ${srv.toolCount} tool${srv.toolCount !== 1 ? 's' : ''}`
      : 'not connected';
    p.log.success(`✓ ${srv.id} (${srv.transport}) — ${status}`);
  }

  return { exitCode: 0 };
}
