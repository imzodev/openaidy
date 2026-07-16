/**
 * Tests for the MCP secrets migration (issue #401).
 *
 * Uses an in-memory mock of `AppConfigService` that exposes only the
 * surface used by `migrate-secrets.ts` (`getConfig`, `getMcpServers`,
 * `save`). The encryption service it touches is real (via the in-process
 * `getEncryptionService`), so the migration actually round-trips through
 * `encryptSecret`/`decryptSecret` and exercises the full path.
 */

import { describe, it, expect } from 'vitest';
import type { OpenAidyAppConfig } from '@openaidy/config';
import type { McpServerConfig } from '@openaidy/config';
import type { AppConfigService } from '../config/service';
import {
  migrateAllInlineSecrets,
  migrateInlineSecretsForConnect,
} from './migrate-secrets';
import { decryptSecret, isEncryptedSecret } from './secret-crypto';

type MockConfigService = {
  getConfig(): OpenAidyAppConfig;
  getMcpServers(): McpServerConfig[];
  save(input: unknown): Promise<OpenAidyAppConfig>;
};

function makeConfigService(servers: McpServerConfig[]): MockConfigService & {
  writeCount: () => number;
  lastSaved: () => unknown;
} {
  const config: OpenAidyAppConfig = {
    mcpServers: servers,
  } as OpenAidyAppConfig;
  let writes = 0;
  let last: unknown = null;
  return {
    getConfig: () => config,
    getMcpServers: () => config.mcpServers ?? [],
    save: async (input: unknown) => {
      writes += 1;
      last = input;
      Object.assign(config, input);
      return config;
    },
    writeCount: () => writes,
    lastSaved: () => last,
  };
}

/**
 * Test-local wrapper that strips down the full `AppConfigService` shape to
 * just the three methods `migrate-secrets.ts` uses. Keeps the production
 * import untouched and dodges the cost of constructing a real service
 * (with providers, agents, db, etc.) for what is purely a pure-function
 * test of the migration.
 */
function asAppConfigService(
  mock: ReturnType<typeof makeConfigService>,
): AppConfigService {
  return mock as unknown as AppConfigService;
}

describe('migrateAllInlineSecrets', () => {
  it('reports zero changes when nothing needs migrating', async () => {
    const svc = makeConfigService([
      {
        id: 'gh',
        transport: 'http',
        url: 'https://example.com',
        headers: { Authorization: 'Bearer ${GH_TOKEN}' },
      } as McpServerConfig,
    ]);
    const report = await migrateAllInlineSecrets({
      configService: asAppConfigService(svc),
      dryRun: false,
    });
    expect(report.scanned).toBe(1);
    expect(report.migrated).toBe(0);
    expect(report.serversTouched).toEqual([]);
    expect(svc.writeCount()).toBe(0);
  });

  it('encrypts plaintext inline values and persists', async () => {
    const svc = makeConfigService([
      {
        id: 'gh',
        transport: 'http',
        url: 'https://example.com',
        headers: { Authorization: 'Bearer ghp_realLongLivedToken1234567890' },
        env: { API_KEY: 'sk_test_plaintext_value' },
      } as McpServerConfig,
    ]);
    const report = await migrateAllInlineSecrets({
      configService: asAppConfigService(svc),
      dryRun: false,
    });
    expect(report.scanned).toBe(1);
    expect(report.migrated).toBe(2);
    expect(report.serversTouched).toEqual(['gh']);
    expect(svc.writeCount()).toBe(1);

    const updated = svc.getMcpServers()[0]!;
    const authHeader = updated.headers!.Authorization as {
      kind: string;
      value: string;
    };
    expect(authHeader.kind).toBe('inline');
    expect(isEncryptedSecret(authHeader.value)).toBe(true);
    expect(decryptSecret(authHeader.value)).toBe(
      'Bearer ghp_realLongLivedToken1234567890',
    );

    const apiKey = updated.env!.API_KEY as { kind: string; value: string };
    expect(apiKey.kind).toBe('inline');
    expect(isEncryptedSecret(apiKey.value)).toBe(true);
    expect(decryptSecret(apiKey.value)).toBe('sk_test_plaintext_value');
  });

  it('leaves env-var references untouched (env references are not secrets)', async () => {
    const svc = makeConfigService([
      {
        id: 'a',
        transport: 'http',
        url: 'https://example.com',
        headers: {
          Authorization: 'Bearer ${GH_TOKEN}',
          'X-Other': '${SOME_ENV}',
        },
      } as McpServerConfig,
    ]);
    const report = await migrateAllInlineSecrets({
      configService: asAppConfigService(svc),
      dryRun: false,
    });
    expect(report.migrated).toBe(0);
    expect(report.serversTouched).toEqual([]);
    expect(svc.writeCount()).toBe(0);

    const headers = svc.getMcpServers()[0]!.headers!;
    expect(headers.Authorization).toBe('Bearer ${GH_TOKEN}');
    expect(headers['X-Other']).toBe('${SOME_ENV}');
  });

  it('dryRun returns a plan without persisting', async () => {
    const svc = makeConfigService([
      {
        id: 'gh',
        transport: 'http',
        url: 'https://example.com',
        headers: { Authorization: 'ghp_realLongLivedToken1234567890' },
      } as McpServerConfig,
    ]);
    const report = await migrateAllInlineSecrets({
      configService: asAppConfigService(svc),
      dryRun: true,
    });
    expect(report.scanned).toBe(1);
    expect(report.migrated).toBe(1);
    expect(report.serversTouched).toEqual(['gh']);
    expect(svc.writeCount()).toBe(0);

    // The on-disk value is still plaintext.
    const headers = svc.getMcpServers()[0]!.headers!;
    expect(headers.Authorization).toBe('ghp_realLongLivedToken1234567890');
  });

  it('is idempotent: a second run on a migrated config does nothing', async () => {
    const svc = makeConfigService([
      {
        id: 'gh',
        transport: 'http',
        url: 'https://example.com',
        headers: { Authorization: 'ghp_realLongLivedToken1234567890' },
      } as McpServerConfig,
    ]);
    const first = await migrateAllInlineSecrets({
      configService: asAppConfigService(svc),
      dryRun: false,
    });
    expect(first.migrated).toBe(1);
    const writesAfterFirst = svc.writeCount();

    const second = await migrateAllInlineSecrets({
      configService: asAppConfigService(svc),
      dryRun: false,
    });
    expect(second.migrated).toBe(0);
    expect(second.serversTouched).toEqual([]);
    expect(svc.writeCount()).toBe(writesAfterFirst);
  });

  it('continues past a per-server failure and reports it', async () => {
    // Patch the second server's headers to throw a getter so the
    // migration's try/catch is exercised. (Plain object spread + accessor.)
    const goodServer: McpServerConfig = {
      id: 'good',
      transport: 'http',
      url: 'https://example.com',
      headers: { Authorization: 'ghp_realLongLivedToken1234567890' },
    } as McpServerConfig;

    const badServer: McpServerConfig = {
      id: 'bad',
      transport: 'http',
      url: 'https://example.com',
    } as McpServerConfig;
    Object.defineProperty(badServer, 'env', {
      get() {
        throw new Error('boom');
      },
    });

    const svc = makeConfigService([goodServer, badServer]);
    const report = await migrateAllInlineSecrets({
      configService: asAppConfigService(svc),
      dryRun: false,
    });
    expect(report.scanned).toBe(2);
    expect(report.serversTouched).toEqual(['good']);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]).toEqual({
      serverId: 'bad',
      message: 'boom',
    });
  });
});

describe('migrateInlineSecretsForConnect', () => {
  it('returns the same server and migrates zero when nothing to do', async () => {
    const svc = makeConfigService([]);
    const server = {
      id: 'gh',
      transport: 'http',
      url: 'https://example.com',
      headers: { Authorization: 'Bearer ${GH_TOKEN}' },
    } as McpServerConfig;
    const result = await migrateInlineSecretsForConnect({
      configService: asAppConfigService(svc),
      server,
    });
    expect(result.migrated).toBe(0);
    expect(result.server).toBe(server);
    expect(svc.writeCount()).toBe(0);
  });

  it('encrypts plaintext inline values and persists', async () => {
    const server = {
      id: 'gh',
      transport: 'http',
      url: 'https://example.com',
      headers: { Authorization: 'ghp_realLongLivedToken1234567890' },
    } as McpServerConfig;
    const svc = makeConfigService([server]);
    const result = await migrateInlineSecretsForConnect({
      configService: asAppConfigService(svc),
      server,
    });
    expect(result.migrated).toBe(1);
    const authHeader = result.server.headers!.Authorization as {
      kind: string;
      value: string;
    };
    expect(isEncryptedSecret(authHeader.value)).toBe(true);
    expect(decryptSecret(authHeader.value)).toBe(
      'ghp_realLongLivedToken1234567890',
    );

    // The mock service received the updated server list.
    const saved = svc.lastSaved() as { mcpServers: McpServerConfig[] };
    const persisted = saved.mcpServers[0]!;
    const persistedHeader = persisted.headers!.Authorization as {
      kind: string;
      value: string;
    };
    expect(isEncryptedSecret(persistedHeader.value)).toBe(true);
  });

  it('counts env + headers migrations separately', async () => {
    const server = {
      id: 'multi',
      transport: 'stdio',
      command: 'echo',
      env: { A: 'plainA', B: 'plainB' },
      headers: { X: 'plainX' },
    } as McpServerConfig;
    const svc = makeConfigService([server]);
    const result = await migrateInlineSecretsForConnect({
      configService: asAppConfigService(svc),
      server,
    });
    expect(result.migrated).toBe(3);
  });
});
