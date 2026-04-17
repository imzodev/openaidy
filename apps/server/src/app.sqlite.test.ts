import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';

const appConfigTemplatePath = fileURLToPath(
  new URL('../../../config/openaidy.template.json', import.meta.url),
);

describe('buildApp sqlite bootstrap', { timeout: 15000 }, () => {
  let app: FastifyInstance | undefined;
  let sqliteDir: string | undefined;

  afterEach(async () => {
    await app?.close();

    vi.resetModules();
    vi.doUnmock('./lib/env');

    if (sqliteDir) {
      rmSync(sqliteDir, { recursive: true, force: true });
      sqliteDir = undefined;
    }
  });

  it('boots successfully with sqlite configuration', async () => {
    sqliteDir = mkdtempSync(join(tmpdir(), 'openaidy-sqlite-test-'));
    const sqlitePath = join(sqliteDir, 'openaidy.db');

    vi.resetModules();
    vi.doMock('./lib/env', () => ({
      env: {
        HOST: '0.0.0.0',
        PORT: 3001,
        CORS_ORIGIN: 'http://localhost:3000',
        DB_KIND: 'sqlite',
        DATABASE_URL: undefined,
        SQLITE_PATH: sqlitePath,
        OPENAIDY_HOME: sqliteDir!,
        APP_CONFIG_PATH: join(sqliteDir!, 'openaidy.config.json'),
        APP_CONFIG_TEMPLATE_PATH: appConfigTemplatePath,
        LOG_LEVEL: 'info',
        // Workspace configuration
        WORKSPACE_BASE_DIR: join(sqliteDir!, 'workspaces'),
        // Bootstrap admin configuration
        BOOTSTRAP_ADMIN_ENABLED: true,
        BOOTSTRAP_ADMIN_TOKEN_PATH: join(sqliteDir!, 'bootstrap-admin.json'),
        BOOTSTRAP_ADMIN_CLIENT_ID: 'test-bootstrap-admin',
        BOOTSTRAP_ADMIN_TOKEN_EXPIRY_MS: 31536000000,
        // WebSocket configuration
        WS_ENABLED: true,
        WS_PORT: 3001,
        WS_PATH: '/ws',
        WS_MAX_CONNECTIONS: 1000,
        WS_HEARTBEAT_INTERVAL: 30000,
        WS_AUTH_REQUIRED: true,
        WS_TOKEN_EXPIRY: 86400000,
        WS_TOKEN_SECRET: 'test-secret',
        WS_RATE_LIMIT_MAX: 100,
        WS_RATE_LIMIT_WINDOW: 60000,
        // Pairing configuration
        WS_PAIRING_CODE_LENGTH: 6,
        WS_PAIRING_CODE_EXPIRY_MS: 300000,
        WS_PAIRING_MAX_PENDING: 100,
        WS_PAIRING_TOKEN_EXPIRY_MS: 2592000000,
        WS_PAIRING_REQUIRE_ADMIN: true,
      },
    }));

    const { buildApp } = await import('./app');

    app = await buildApp();

    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    expect(
      (app as FastifyInstance & { services: { dbAdapter?: { kind?: string } } })
        .services.dbAdapter?.kind,
    ).toBe('sqlite');
  });
});
