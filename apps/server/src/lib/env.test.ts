import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { dirname } from 'node:path';
import { tmpdir } from 'node:os';
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

  it('defaults OPENAIDY_PORT to DEFAULT_SERVER_PORT (3001) when unset', () => {
    const parsed = parseEnv({});
    expect(parsed.OPENAIDY_PORT).toBe(3001);
  });

  it('honors an explicit OPENAIDY_PORT override', () => {
    const parsed = parseEnv({ OPENAIDY_PORT: '8080' });
    expect(parsed.OPENAIDY_PORT).toBe(8080);
  });

  it('defaults OPENAIDY_CORS_ORIGIN to the local Vite dev origin', () => {
    const parsed = parseEnv({});
    expect(parsed.OPENAIDY_CORS_ORIGIN).toBe('http://localhost:5173');
  });

  it('honors an explicit OPENAIDY_CORS_ORIGIN override', () => {
    const parsed = parseEnv({
      OPENAIDY_CORS_ORIGIN: 'https://openaidy.example.com',
    });
    expect(parsed.OPENAIDY_CORS_ORIGIN).toBe('https://openaidy.example.com');
  });

  it('derives openaidy paths from OPENAIDY_HOME', () => {
    const customHome = resolve(tmpdir(), 'custom-openaidy');
    const parsed = parseEnv({
      OPENAIDY_HOME: customHome,
    });

    expect(parsed.OPENAIDY_HOME).toBe(customHome);
    expect(parsed.APP_CONFIG_PATH).toBe(resolve(customHome, 'openaidy.json'));
    expect(parsed.BOOTSTRAP_ADMIN_TOKEN_PATH).toBe(
      resolve(customHome, 'credentials/bootstrap-admin.json'),
    );
    expect(parsed.WORKSPACE_BASE_DIR).toBe(resolve(customHome, 'workspaces'));
  });

  it('prefers explicit path overrides over OPENAIDY_HOME derived defaults', () => {
    const customHome = resolve(tmpdir(), 'custom-openaidy');
    const appConfigOverride = resolve(tmpdir(), 'other', 'config.json');
    const bootstrapOverride = resolve(
      tmpdir(),
      'other',
      'bootstrap-admin.json',
    );
    const workspaceOverride = resolve(tmpdir(), 'other', 'workspaces');
    const parsed = parseEnv({
      OPENAIDY_HOME: customHome,
      APP_CONFIG_PATH: appConfigOverride,
      BOOTSTRAP_ADMIN_TOKEN_PATH: bootstrapOverride,
      WORKSPACE_BASE_DIR: workspaceOverride,
    });

    expect(parsed.APP_CONFIG_PATH).toBe(appConfigOverride);
    expect(parsed.BOOTSTRAP_ADMIN_TOKEN_PATH).toBe(bootstrapOverride);
    expect(parsed.WORKSPACE_BASE_DIR).toBe(workspaceOverride);
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
