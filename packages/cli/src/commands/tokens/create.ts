/**
 * Tokens Create Command Handler
 *
 * Implements `openaidy tokens create` command.
 */

import { readFile } from 'node:fs/promises';
import { resolveCLIConfig } from '../../lib/config.js';
import type { CommandResult } from '../../types.js';

type BootstrapAdminRecord = {
  token: string;
};

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
    return {
      exitCode: 0,
      output: `
Usage: openaidy tokens create --name <name> --scopes <scopes> [--expires <date>]

Create a new access token. The raw token is shown once — save it immediately.

Options:
  --name, -n <name>    Token name (required)
  --scopes <scopes>    Comma-separated list of scopes (required)
                       Use * for full admin access
  --expires <date>     Expiry date in ISO 8601 format (optional)

Available scopes:
  *                    Admin (all scopes)
  sessions.read        Read sessions
  sessions.write       Write sessions
  sessions.stream      Stream sessions
  sessions.delete      Delete sessions
  agents.read          Read agents
  agents.invoke        Invoke agents
  providers.read       Read providers
  config.read          Read config
  config.write         Write config

Examples:
  pnpm openaidy tokens create --name "CI Pipeline" --scopes "sessions.read,sessions.stream"
  pnpm openaidy tokens create --name "Admin Key" --scopes "*"
  pnpm openaidy tokens create --name "Temp" --scopes "sessions.read" --expires "2026-12-31"

Exit Codes:
  0  Token created successfully
  1  Error
  2  Invalid arguments
`,
    };
  }

  const opts = parseArgs(args);

  if (!opts.name) {
    return {
      exitCode: 2,
      error: 'Missing required option: --name\nRun with --help for usage.',
    };
  }
  if (opts.scopes.length === 0) {
    return {
      exitCode: 2,
      error: 'Missing required option: --scopes\nRun with --help for usage.',
    };
  }

  const config = resolveCLIConfig();
  const token = await readAdminToken(config.tokenPath);

  if (!token) {
    return {
      exitCode: 1,
      error: `Bootstrap admin token not found at ${config.tokenPath}.\nMake sure the server has been started at least once.`,
    };
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
    const msg = err instanceof Error ? err.message : String(err);
    return {
      exitCode: 1,
      error: `Cannot reach server at ${config.httpUrl}.\n${msg}\n\nMake sure the server is running.`,
    };
  }

  if (!res.ok) {
    const errBody = (await res
      .json()
      .catch(() => ({ error: res.statusText }))) as { error?: string };
    return {
      exitCode: 1,
      error: `Server returned ${res.status}: ${errBody.error ?? res.statusText}`,
    };
  }

  const result = (await res.json()) as CreateResponse;
  const { key, rawKey } = result;

  const lines = [
    'Access token created',
    '====================',
    '',
    `  Name:    ${key.name}`,
    `  ID:      ${key.id}`,
    `  Scopes:  ${key.scopes.join(', ')}`,
    ...(key.expiresAt ? [`  Expires: ${key.expiresAt}`] : []),
    '',
    'Token (shown once — save it now):',
    '',
    `  ${rawKey}`,
    '',
    'Use this token to log into the UI or authenticate API requests.',
  ];

  return { exitCode: 0, output: lines.join('\n') };
}
