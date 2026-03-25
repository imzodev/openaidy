import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';

const appConfigTemplatePath = fileURLToPath(new URL('../../../config/openaidy.template.json', import.meta.url));

describe('buildApp sqlite bootstrap', () => {
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
        APP_CONFIG_PATH: join(sqliteDir!, 'openaidy.config.json'),
        APP_CONFIG_TEMPLATE_PATH: appConfigTemplatePath,
        LOG_LEVEL: 'info',
      },
    }));

    const { buildApp } = await import('./app');

    app = await buildApp();

    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    expect((app as FastifyInstance & { services: { dbAdapter?: { kind?: string } } }).services.dbAdapter?.kind).toBe('sqlite');
  });
});
