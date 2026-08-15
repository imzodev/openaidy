import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { resolve, join } from 'node:path';
import { dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  mkdirSync,
  rmSync,
  writeFileSync,
  existsSync,
  mkdtempSync,
} from 'node:fs';
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
    expect(parsed.BUNDLED_SKILLS_DIR).toBe(
      resolve(workspaceRoot, 'config/skills'),
    );
    expect(parsed.WORKSPACE_BASE_DIR).toBe(
      resolve(workspaceRoot, '.openaidy/workspaces'),
    );
  });

  it('honors an explicit BUNDLED_SKILLS_DIR override (packaged CLI injects this)', () => {
    const customSkills = resolve(tmpdir(), 'openaidy-packaged-skills');
    const parsed = parseEnv({ BUNDLED_SKILLS_DIR: customSkills });
    expect(parsed.BUNDLED_SKILLS_DIR).toBe(customSkills);
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

  it('requires the renewal check interval to be small enough to land inside the renewal window', () => {
    expect(() =>
      parseEnv({
        BOOTSTRAP_ADMIN_TOKEN_EXPIRY_MS: '3600000', // 1h
        BOOTSTRAP_ADMIN_RENEW_THRESHOLD_FRACTION: '0.2', // 12min window
        BOOTSTRAP_ADMIN_RENEW_CHECK_INTERVAL_MS: '21600000', // 6h default, way too coarse
      }),
    ).toThrow(/BOOTSTRAP_ADMIN_RENEW_CHECK_INTERVAL_MS/);
  });

  it('accepts a renewal check interval comfortably smaller than the renewal window', () => {
    const parsed = parseEnv({
      BOOTSTRAP_ADMIN_TOKEN_EXPIRY_MS: '3600000', // 1h
      BOOTSTRAP_ADMIN_RENEW_THRESHOLD_FRACTION: '0.2', // 12min window
      BOOTSTRAP_ADMIN_RENEW_CHECK_INTERVAL_MS: '60000', // 1min
    });

    expect(parsed.BOOTSTRAP_ADMIN_RENEW_CHECK_INTERVAL_MS).toBe(60000);
  });
});

describe('parseEnv - WS_TOKEN_SECRET resolution', () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'openaidy-env-'));
    mkdirSync(join(home, 'state'), { recursive: true });
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('uses an explicit WS_TOKEN_SECRET over the manifest', () => {
    writeFileSync(
      join(home, 'state', 'install.json'),
      JSON.stringify({ wsTokenSecret: 'manifest-secret' }),
      'utf-8',
    );
    const parsed = parseEnv({
      OPENAIDY_HOME: home,
      WS_TOKEN_SECRET: 'env-secret',
    });
    expect(parsed.WS_TOKEN_SECRET).toBe('env-secret');
  });

  it('falls back to state/install.json when WS_TOKEN_SECRET is unset', () => {
    writeFileSync(
      join(home, 'state', 'install.json'),
      JSON.stringify({ wsTokenSecret: 'manifest-secret' }),
      'utf-8',
    );
    const parsed = parseEnv({ OPENAIDY_HOME: home });
    expect(parsed.WS_TOKEN_SECRET).toBe('manifest-secret');
  });

  it('falls back to state/install.json when WS_TOKEN_SECRET is empty', () => {
    writeFileSync(
      join(home, 'state', 'install.json'),
      JSON.stringify({ wsTokenSecret: 'manifest-secret' }),
      'utf-8',
    );
    const parsed = parseEnv({
      OPENAIDY_HOME: home,
      WS_TOKEN_SECRET: '',
    });
    expect(parsed.WS_TOKEN_SECRET).toBe('manifest-secret');
  });

  it('uses the unsafe default sentinel when neither env nor manifest has a real secret', () => {
    const parsed = parseEnv({ OPENAIDY_HOME: home });
    expect(parsed.WS_TOKEN_SECRET).toBe('change-me-in-production');
  });

  it('does not regenerate the JWT when the manifest secret matches the existing token (regression test for restart bug)', () => {
    // Reproduces the user-reported bug: on `openaidy stop && openaidy start`
    // without WS_TOKEN_SECRET in the env, the server previously fell back to
    // the unsafe default and BootstrapAdminManager.ensureToken() would
    // silently regenerate the admin JWT, logging the user out.
    writeFileSync(
      join(home, 'state', 'install.json'),
      JSON.stringify({ wsTokenSecret: 'install-secret-persisted' }),
      'utf-8',
    );
    // No WS_TOKEN_SECRET in the env — exactly the manual restart case.
    const parsed = parseEnv({ OPENAIDY_HOME: home });
    expect(parsed.WS_TOKEN_SECRET).toBe('install-secret-persisted');
    expect(parsed.WS_TOKEN_SECRET).not.toBe('change-me-in-production');
    // Sanity: install.json is preserved across the read.
    expect(existsSync(join(home, 'state', 'install.json'))).toBe(true);
  });
});
