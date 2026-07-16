/**
 * Migrate existing plaintext MCP secrets in the persisted app config to
 * encrypted-at-rest form (issue #401).
 *
 * Existing installs may have stored inline secrets as plain strings in
 * `~/.openaidy/openaidy.json` — e.g. an `Authorization: Bearer ghp_xxx`
 * pasted directly into the headers field, the exact scenario the issue
 * describes. After this commit, new writes route every value through
 * {@link unmaskRecord}, which encrypts inline secrets before they reach
 * disk. But existing on-disk values are still plaintext until something
 * rewrites them.
 *
 * This module provides that rewrite:
 *   - {@link migrateAllInlineSecrets} walks every persisted MCP server's
 *     `env`/`headers`, encrypts plaintext inline values in-place, and
 *     persists via `configService.save`. It is idempotent: re-running on
 *     an already-migrated config is a no-op (already-encrypted values pass
 *     through, env references pass through). `dryRun: true` returns the
 *     plan without persisting.
 *   - {@link migrateInlineSecretsForConnect} is invoked on connect: it
 *     encrypts any leftover plaintext and saves before the connector
 *     reads it — so an operator who never runs the explicit CLI still
 *     gets migrated on next connect.
 *
 * Both paths reuse {@link migrateInlineSecrets} from `server-record.ts` so
 * the "what counts as inline" logic lives in exactly one place.
 */

import { createLogger } from '../lib/logger';
import type { AppConfigService } from '../config/service';
import type { McpServerConfig, McpSecretValue } from '@openaidy/config';
import { migrateInlineSecrets } from './server-record';
import { isEncryptedSecret } from './secret-crypto';

const log = createLogger('mcp.migrate-secrets');

/** A single plaintext secret that needs to be encrypted. */
export type InlineSecretToMigrate = {
  serverId: string;
  /** `env` or `headers` — which field on the server config. */
  field: 'env' | 'headers';
  /** The key whose value needs encrypting. */
  key: string;
};

/** What {@link migrateAllInlineSecrets} did, suitable for the CLI log. */
export type MigrationReport = {
  /** Number of MCP servers scanned. */
  scanned: number;
  /** Number of plaintext values that were (or, in dryRun, would be) encrypted. */
  migrated: number;
  /** Servers that had at least one migrated value. */
  serversTouched: string[];
  /**
   * Server-level errors — e.g. a single value that threw during encryption.
   * The migration keeps going past per-server failures so one bad server
   * does not block the rest.
   */
  errors: Array<{ serverId: string; message: string }>;
};

/**
 * Mirror of `server-record.ts`'s `isSafeToShow` predicate — kept private
 * there, replicated here to avoid coupling the migration to a single
 * re-implementation. The two must agree or migration would touch a value
 * the redactor would later treat as plaintext (or vice versa).
 */
function isSafePlaceholder(value: string): boolean {
  const PLACEHOLDER_PATTERN = /\$\{[^}]+\}/g;
  const SAFE_SCAFFOLDING_PATTERN = /^[A-Za-z \t-]*$/;
  const trimmed = value.trim();
  if (!/\$\{[^}]+\}/.test(trimmed)) return false;
  const literal = trimmed.replace(PLACEHOLDER_PATTERN, ' ');
  return SAFE_SCAFFOLDING_PATTERN.test(literal);
}

/**
 * Identify plaintext values that the migration would encrypt.
 *
 * Splits a value's keys into "would encrypt" vs "would leave alone" so the
 * caller can produce a useful summary without ever holding plaintext in a
 * report.
 */
function collectPlaintextEntries(
  serverId: string,
  field: 'env' | 'headers',
  record: Record<string, McpSecretValue> | undefined,
): InlineSecretToMigrate[] {
  if (!record) return [];
  const out: InlineSecretToMigrate[] = [];
  for (const [key, value] of Object.entries(record)) {
    const isStringPlaintext =
      typeof value === 'string' && !isSafePlaceholder(value);
    const isStructuredInlinePlaintext =
      typeof value === 'object' &&
      value.kind === 'inline' &&
      !isEncryptedSecret(value.value);
    if (isStringPlaintext || isStructuredInlinePlaintext) {
      out.push({ serverId, field, key });
    }
  }
  return out;
}

/**
 * Walk every persisted MCP server, encrypt plaintext inline secrets in
 * `env`/`headers`, and persist the result via {@link AppConfigService.save}.
 *
 * `dryRun: true` returns a {@link MigrationReport} without writing — the
 * CLI uses this to preview what would change.
 */
export async function migrateAllInlineSecrets(options: {
  configService: AppConfigService;
  dryRun: boolean;
}): Promise<MigrationReport> {
  const { configService, dryRun } = options;

  const servers = configService.getMcpServers();
  const errors: MigrationReport['errors'] = [];
  const serversTouched = new Set<string>();
  let migrated = 0;

  const nextServers: McpServerConfig[] = [];
  for (const server of servers) {
    try {
      const envEntries = collectPlaintextEntries(server.id, 'env', server.env);
      const headerEntries = collectPlaintextEntries(
        server.id,
        'headers',
        server.headers,
      );
      const allEntries = [...envEntries, ...headerEntries];

      if (allEntries.length === 0) {
        nextServers.push(server);
        continue;
      }

      serversTouched.add(server.id);
      migrated += allEntries.length;

      if (dryRun) {
        nextServers.push(server);
        continue;
      }

      const migratedServer: McpServerConfig = {
        ...server,
        env: migrateInlineSecrets(server.env),
        headers: migrateInlineSecrets(server.headers),
      };
      nextServers.push(migratedServer);
    } catch (error) {
      errors.push({
        serverId: server.id,
        message: error instanceof Error ? error.message : String(error),
      });
      nextServers.push(server);
    }
  }

  if (!dryRun && (migrated > 0 || errors.length === 0)) {
    const fullConfig = configService.getConfig();
    const same =
      servers.length === nextServers.length &&
      servers.every((s, i) => s === nextServers[i]);
    if (!same) {
      await configService.save({
        ...fullConfig,
        mcpServers: nextServers,
      });
    }
  }

  const report: MigrationReport = {
    scanned: servers.length,
    migrated,
    serversTouched: [...serversTouched],
    errors,
  };

  if (dryRun) {
    log.info('mcp migrate-secrets --dry-run: no changes written', {
      scanned: report.scanned,
      wouldMigrate: report.migrated,
      serversTouched: report.serversTouched,
    });
  } else if (report.migrated > 0) {
    log.info(
      'mcp migrate-secrets: encrypted plaintext inline secrets at rest',
      {
        migrated: report.migrated,
        serversTouched: report.serversTouched,
      },
    );
  }

  return report;
}

/**
 * Migrate a single server config in-place and persist it. Used by the
 * connect path so that an operator who never runs the CLI still gets
 * migrated on next connect — and so a server with stale plaintext secrets
 * is brought up-to-date before its first new connection attempt.
 *
 * No-ops if the config is already migrated (already-encrypted values are
 * left alone).
 */
export async function migrateInlineSecretsForConnect(options: {
  configService: AppConfigService;
  server: McpServerConfig;
}): Promise<{ migrated: number; server: McpServerConfig }> {
  const { configService, server } = options;

  const envEntries = collectPlaintextEntries(server.id, 'env', server.env);
  const headerEntries = collectPlaintextEntries(
    server.id,
    'headers',
    server.headers,
  );
  const totalMigrated = envEntries.length + headerEntries.length;

  if (totalMigrated === 0) {
    return { migrated: 0, server };
  }

  const updatedServer: McpServerConfig = {
    ...server,
    env: migrateInlineSecrets(server.env),
    headers: migrateInlineSecrets(server.headers),
  };

  const fullConfig = configService.getConfig();
  const newServers = (fullConfig.mcpServers ?? []).map((s) =>
    s.id === server.id ? updatedServer : s,
  );
  await configService.save({ ...fullConfig, mcpServers: newServers });

  log.info(
    'migrated plaintext inline secrets to encrypted-at-rest on connect',
    { serverId: server.id, count: totalMigrated },
  );

  return { migrated: totalMigrated, server: updatedServer };
}
