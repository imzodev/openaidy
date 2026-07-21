/**
 * Tokens Create Command Handler
 *
 * Implements `openaidy tokens create` command.
 */

import * as p from '@clack/prompts';
import { readFile } from 'node:fs/promises';
import { resolveCLIConfig } from '../../lib/config.js';
import type { CommandResult } from '../../types.js';
import type { BootstrapAdminRecord } from '@openaidy/shared-types';

type CreateResponse = {
  key: {
    id: string;
    name: string;
    keyPrefix: string;
    scopes: string[];
    createdAt: string;
    expiresAt: string | null;
  };
  rawKey: string;
};

async function readAdminToken(tokenPath: string): Promise<string | null> {
  try {
    const raw = await readFile(tokenPath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<BootstrapAdminRecord>;
    return typeof parsed.token === 'string' ? parsed.token : null;
  } catch {
    return null;
  }
}

type CreateOptions = {
  name: string | null;
  scopes: string[];
  expiresAt: string | null;
};

function parseArgs(args: string[]): CreateOptions {
  const opts: CreateOptions = { name: null, scopes: [], expiresAt: null };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === '--name' || arg === '-n') && args[i + 1]) {
      opts.name = args[++i];
    } else if (arg === '--scopes' && args[i + 1]) {
      opts.scopes = args[++i]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (arg === '--expires' && args[i + 1]) {
      opts.expiresAt = args[++i];
    }
  }

  return opts;
}

export async function tokensCreateHandler(
  args: string[],
): Promise<CommandResult> {
  if (args.includes('-h') || args.includes('--help')) {
    p.note(
      `Usage: openaidy tokens create --name <name> --scopes <scopes> [--expires <date>]

Create a new access token. The raw token is shown once — save it immediately.

Options:
  --name, -n <name>    Token name (required)
  --scopes <scopes>    Comma-separated list of scopes (required)
                       Use * for full admin access
  --expires <date>     Expiry date in ISO 8601 format (optional)

Available scopes:
  *                    Admin (all scopes)
  sessions.list        List all sessions
  sessions.read        Read a specific session
  sessions.write       Create sessions / submit messages
  sessions.stream      Stream session events
  sessions.delete      Delete sessions
  agents.list          List available agents
  agents.invoke        Invoke agents
  providers.read       Read providers
  config.read          Read config
  config.write         Write config

Examples:
  pnpm openaidy tokens create --name "CI Pipeline" --scopes "sessions.list,sessions.stream"
  pnpm openaidy tokens create --name "Admin Key" --scopes "*"
  pnpm openaidy tokens create --name "Temp" --scopes "sessions.list" --expires "2026-12-31"

Exit Codes:
  0  Token created successfully
  1  Error
  2  Invalid arguments`,
      'Help',
    );
    return { exitCode: 0 };
  }

  const opts = parseArgs(args);

  if (!opts.name) {
    const msg = 'Missing required option: --name\nRun with --help for usage.';
    p.log.error(msg);
    return { exitCode: 2, error: msg };
  }
  if (opts.scopes.length === 0) {
    const msg = 'Missing required option: --scopes\nRun with --help for usage.';
    p.log.error(msg);
    return { exitCode: 2, error: msg };
  }

  const config = resolveCLIConfig();
  const token = await readAdminToken(config.tokenPath);

  if (!token) {
    const msg = `Bootstrap admin token not found at ${config.tokenPath}.\nMake sure the server has been started at least once.`;
    p.log.error(msg);
    return { exitCode: 1, error: msg };
  }

  const body: Record<string, unknown> = {
    name: opts.name,
    scopes: opts.scopes,
  };
  if (opts.expiresAt) body.expiresAt = opts.expiresAt;

  let res: Response;
  try {
    res = await fetch(`${config.httpUrl}/api/access-tokens`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const msg = `Cannot reach server at ${config.httpUrl}.\n${err instanceof Error ? err.message : String(err)}\n\nMake sure the server is running.`;
    p.log.error(msg);
    return { exitCode: 1, error: msg };
  }

  if (!res.ok) {
    const errBody = (await res
      .json()
      .catch(() => ({ error: res.statusText }))) as { error?: string };
    const msg = `Server returned ${res.status}: ${errBody.error ?? res.statusText}`;
    p.log.error(msg);
    return { exitCode: 1, error: msg };
  }

  const result = (await res.json()) as CreateResponse;
  const { key, rawKey } = result;

  const details = [
    `Name:    ${key.name}`,
    `ID:      ${key.id}`,
    `Scopes:  ${key.scopes.join(', ')}`,
    ...(key.expiresAt ? [`Expires: ${key.expiresAt}`] : []),
  ].join('\n');

  p.note(details, 'Token Created');
  p.note(
    `Token (shown once — save it now):\n\n  ${rawKey}\n\nUse this token to log into the UI or authenticate API requests.`,
    'Raw Token',
  );
  p.outro('Access token created successfully.');
  return { exitCode: 0 };
}
