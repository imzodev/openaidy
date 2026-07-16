/**
 * `openaidy mcp migrate-secrets` — one-shot migration of plaintext MCP
 * secrets to encrypted-at-rest form (issue #401).
 *
 * Delegates to the server's `POST /api/mcp/servers/migrate-secrets`
 * endpoint so the migration reuses the in-process encryption service
 * (single key surface) and writes via the same `AppConfigService.save`
 * path the UI uses. With `--dry-run`, the server returns the plan
 * without persisting; the CLI surfaces the same plan to the operator.
 */

import * as p from '@clack/prompts';
import { readAdminToken } from '../../lib/admin-token.js';
import { resolveCLIConfig } from '../../lib/config.js';
import type { CommandResult } from '../../types.js';

type MigrationResponse = {
  scanned: number;
  migrated: number;
  serversTouched: string[];
  errors: Array<{ serverId: string; message: string }>;
  dryRun: boolean;
};

export async function mcpMigrateSecretsHandler(
  args: string[],
): Promise<CommandResult> {
  if (args.includes('-h') || args.includes('--help')) {
    p.note(
      `Usage: openaidy mcp migrate-secrets [--dry-run]

Walk every persisted MCP server's env/headers and encrypt plaintext inline
secrets in-place. Existing installs may have stored an inlined credential
(e.g. an Authorization header pasted with a real token) as a plain string
in ~/.openaidy/openaidy.json — this command rewrites those values as
encrypted-at-rest ciphertext (enc:v1:...) so a copy of the config file
no longer exposes the raw secret.

The migration is idempotent: re-running on an already-migrated config is a
no-op. Env-var references (${'$'}{VAR}) are left as plaintext placeholders —
their secret lives in the process environment, not the config.

Options:
  --dry-run   Print the plan (which servers / how many values would be
              encrypted) without persisting any changes.

Exit Codes:
  0  Migration completed (or was a no-op / dry-run with no errors)
  1  Server unreachable, not authenticated, or migration failed`,
      'mcp migrate-secrets',
    );
    return { exitCode: 0 };
  }

  const dryRun = args.includes('--dry-run');

  const config = resolveCLIConfig();
  const token = await readAdminToken(config.tokenPath);
  if (!token.ok) {
    p.log.error(token.error);
    return { exitCode: 1, error: token.error };
  }

  const s = p.spinner();
  s.start(
    dryRun ? 'Scanning MCP servers (dry run)…' : 'Migrating MCP secrets…',
  );

  let res: Response;
  try {
    res = await fetch(`${config.httpUrl}/api/mcp/servers/migrate-secrets`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ dryRun }),
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

  const report = (await res.json()) as MigrationResponse;

  if (report.errors.length > 0) {
    s.stop(
      dryRun
        ? 'Dry run completed with errors.'
        : 'Migration completed with errors.',
    );
    for (const err of report.errors) {
      p.log.warn(`${err.serverId}: ${err.message}`);
    }
  } else if (dryRun) {
    s.stop(
      report.migrated === 0
        ? 'No plaintext secrets found.'
        : `Would encrypt ${report.migrated} value${report.migrated === 1 ? '' : 's'}.`,
    );
  } else if (report.migrated === 0) {
    s.stop('No plaintext secrets found — nothing to migrate.');
  } else {
    s.stop(
      `Encrypted ${report.migrated} plaintext secret${report.migrated === 1 ? '' : 's'} at rest.`,
    );
  }

  p.log.message(
    `Scanned ${report.scanned} MCP server${report.scanned === 1 ? '' : 's'}.`,
  );
  if (report.serversTouched.length > 0) {
    p.log.message(
      `${dryRun ? 'Would touch' : 'Touched'}: ${report.serversTouched.join(', ')}`,
    );
  }

  if (dryRun && report.migrated > 0) {
    p.log.message('Re-run without --dry-run to apply these changes.');
  }

  return { exitCode: report.errors.length > 0 ? 1 : 0 };
}
