import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from './env';

const workspaceRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../',
);

describe('parseEnv', () => {
  it('defaults to sqlite with a default sqlite path', () => {
    const parsed = parseEnv({});

    expect(parsed.DB_KIND).toBe('sqlite');
    expect(parsed.SQLITE_PATH).toBe(
      resolve(workspaceRoot, '.openaidy/data/openaidy.db'),
    );
    expect(parsed.OPENAIDY_HOME).toBe(resolve(workspaceRoot, '.openaidy'));
    expect(parsed.APP_CONFIG_PATH).toBe(
      resolve(workspaceRoot, '.openaidy/openaidy.json'),
    );
    expect(parsed.APP_CONFIG_TEMPLATE_PATH).toBe(
      resolve(workspaceRoot, 'config/openaidy.template.json'),
    );
    expect(parsed.WORKSPACE_BASE_DIR).toBe(
      resolve(workspaceRoot, '.openaidy/workspaces'),
    );
  });

  it('derives openaidy paths from OPENAIDY_HOME', () => {
    const parsed = parseEnv({
      OPENAIDY_HOME: '/tmp/custom-openaidy',
    });

    expect(parsed.OPENAIDY_HOME).toBe('/tmp/custom-openaidy');
    expect(parsed.APP_CONFIG_PATH).toBe('/tmp/custom-openaidy/openaidy.json');
    expect(parsed.BOOTSTRAP_ADMIN_TOKEN_PATH).toBe(
      '/tmp/custom-openaidy/credentials/bootstrap-admin.json',
    );
    expect(parsed.WORKSPACE_BASE_DIR).toBe('/tmp/custom-openaidy/workspaces');
  });

  it('prefers explicit path overrides over OPENAIDY_HOME derived defaults', () => {
    const parsed = parseEnv({
      OPENAIDY_HOME: '/tmp/custom-openaidy',
      APP_CONFIG_PATH: '/tmp/other/config.json',
      BOOTSTRAP_ADMIN_TOKEN_PATH: '/tmp/other/bootstrap-admin.json',
      WORKSPACE_BASE_DIR: '/tmp/other/workspaces',
    });

    expect(parsed.APP_CONFIG_PATH).toBe('/tmp/other/config.json');
    expect(parsed.BOOTSTRAP_ADMIN_TOKEN_PATH).toBe(
      '/tmp/other/bootstrap-admin.json',
    );
    expect(parsed.WORKSPACE_BASE_DIR).toBe('/tmp/other/workspaces');
  });

  it('uses a provided sqlite path', () => {
    const parsed = parseEnv({
      DB_KIND: 'sqlite',
      SQLITE_PATH: './tmp/test.db',
    });

    expect(parsed.DB_KIND).toBe('sqlite');
    expect(parsed.SQLITE_PATH).toBe('./tmp/test.db');
  });

  it('requires DATABASE_URL for postgres mode', () => {
    expect(() => parseEnv({ DB_KIND: 'postgres' })).toThrow(
      /DATABASE_URL is required/i,
    );
  });

  it('accepts postgres mode with a database url', () => {
    const parsed = parseEnv({
      DB_KIND: 'postgres',
      DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/openaidy',
    });

    expect(parsed.DB_KIND).toBe('postgres');
    expect(parsed.DATABASE_URL).toBe(
      'postgres://postgres:postgres@localhost:5432/openaidy',
    );
  });
});
