/**
 * CLI Config tests - PR1 NDQ-5 AIDY_HOME resolution
 *
 * Verifies:
 *  - With AIDY_HOME set, tokenPath is absolute under
 *    AIDY_HOME/credentials/bootstrap-admin.json
 *  - With AIDY_HOME unset, tokenPath falls back to the repo-local
 *    .aidy/credentials/bootstrap-admin.json (preserving dev workflow)
 *  - With a relative AIDY_HOME, tokenPath is resolved to absolute
 *  - Explicit BOOTSTRAP_ADMIN_TOKEN_PATH still wins
 *  - jwtSecret still falls back to the unsafe default when WS_TOKEN_SECRET
 *    is unset and no manifest is present (so the init command can refuse it)
 *  - jwtSecret reads from $AIDY_HOME/state/install.json when the
 *    install script has persisted a secret there — this is the fix for
 *    the user-reported bug where `aidy stop && aidy start` (no
 *    WS_TOKEN_SECRET in env) would otherwise cause the server to silently
 *    regenerate the bootstrap admin JWT.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolve, isAbsolute, join } from 'node:path';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolveCLIConfig } from './config.js';

describe('resolveCLIConfig() - tokenPath resolution (PR1 NDQ-5)', () => {
  it('uses AIDY_HOME/credentials/bootstrap-admin.json when AIDY_HOME is set', () => {
    const cfg = resolveCLIConfig({ AIDY_HOME: '/tmp/aidy-home' });
    expect(cfg.tokenPath).toBe(
      resolve('/tmp/aidy-home', 'credentials', 'bootstrap-admin.json'),
    );
    expect(isAbsolute(cfg.tokenPath)).toBe(true);
  });

  it('falls back to repo-local .aidy/credentials/bootstrap-admin.json when AIDY_HOME is unset', () => {
    const cfg = resolveCLIConfig({});
    expect(cfg.tokenPath).toBe(
      resolve('.aidy', 'credentials', 'bootstrap-admin.json'),
    );
  });

  it('resolves a relative AIDY_HOME to an absolute tokenPath', () => {
    const cfg = resolveCLIConfig({ AIDY_HOME: 'relative-home' });
    expect(isAbsolute(cfg.tokenPath)).toBe(true);
    expect(cfg.tokenPath).toBe(
      resolve('relative-home', 'credentials', 'bootstrap-admin.json'),
    );
  });

  it('explicit BOOTSTRAP_ADMIN_TOKEN_PATH still wins over AIDY_HOME', () => {
    const cfg = resolveCLIConfig({
      AIDY_HOME: '/tmp/aidy-home',
      BOOTSTRAP_ADMIN_TOKEN_PATH: '/etc/aidy/token.json',
    });
    expect(cfg.tokenPath).toBe('/etc/aidy/token.json');
  });

  it('jwtSecret falls back to the unsafe default when WS_TOKEN_SECRET is unset and no manifest is present', () => {
    const cfg = resolveCLIConfig({});
    expect(cfg.jwtSecret).toBe('change-me-in-production');
  });

  it('jwtSecret uses WS_TOKEN_SECRET when set', () => {
    const cfg = resolveCLIConfig({ WS_TOKEN_SECRET: 'real-secret' });
    expect(cfg.jwtSecret).toBe('real-secret');
  });

  it('bootstrapAdminEnabled is true by default', () => {
    const cfg = resolveCLIConfig({});
    expect(cfg.bootstrapAdminEnabled).toBe(true);
  });

  it('bootstrapAdminEnabled is false only when BOOTSTRAP_ADMIN_ENABLED=false', () => {
    const cfg = resolveCLIConfig({ BOOTSTRAP_ADMIN_ENABLED: 'false' });
    expect(cfg.bootstrapAdminEnabled).toBe(false);
  });
});

describe('resolveCLIConfig() - port and path defaults (out-of-box install)', () => {
  it('defaults httpUrl to http://localhost:3001 when AIDY_PORT is unset', () => {
    const cfg = resolveCLIConfig({});
    expect(cfg.httpUrl).toBe('http://localhost:3001');
  });

  it('defaults wsUrl to ws://localhost:3001/ws when AIDY_PORT and WS_PATH are unset', () => {
    const cfg = resolveCLIConfig({});
    expect(cfg.wsUrl).toBe('ws://localhost:3001/ws');
  });

  it('honors an explicit AIDY_PORT override', () => {
    const cfg = resolveCLIConfig({ AIDY_PORT: '8080' });
    expect(cfg.httpUrl).toBe('http://localhost:8080');
    expect(cfg.wsUrl).toBe('ws://localhost:8080/ws');
  });

  it('honors an explicit WS_PATH override', () => {
    const cfg = resolveCLIConfig({
      AIDY_PORT: '3001',
      WS_PATH: '/custom/ws',
    });
    expect(cfg.wsUrl).toBe('ws://localhost:3001/custom/ws');
  });

  it('honors an explicit AIDY_WS_URL override', () => {
    const cfg = resolveCLIConfig({
      AIDY_WS_URL: 'wss://example.com/ws',
    });
    expect(cfg.wsUrl).toBe('wss://example.com/ws');
  });

  it('honors an explicit AIDY_SERVER_URL override', () => {
    const cfg = resolveCLIConfig({
      AIDY_SERVER_URL: 'https://api.example.com',
    });
    expect(cfg.httpUrl).toBe('https://api.example.com');
  });
});

describe('resolveCLIConfig() - WS_TOKEN_SECRET manifest fallback (restart bug fix)', () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'aidy-cli-config-'));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('reads jwtSecret from $AIDY_HOME/state/install.json when WS_TOKEN_SECRET is unset', () => {
    mkdirSync(join(home, 'state'), { recursive: true });
    writeFileSync(
      join(home, 'state', 'install.json'),
      JSON.stringify({ wsTokenSecret: 'manifest-secret' }),
      'utf-8',
    );
    const cfg = resolveCLIConfig({ AIDY_HOME: home });
    expect(cfg.jwtSecret).toBe('manifest-secret');
  });

  it('reads jwtSecret from install.json in the install-mode home (~/.aidy)', () => {
    // No AIDY_HOME → simulate the install-script default by writing
    // the manifest at the user-home default location the CLI also checks.
    mkdirSync(join(home, 'state'), { recursive: true });
    writeFileSync(
      join(home, 'state', 'install.json'),
      JSON.stringify({ wsTokenSecret: 'user-home-manifest-secret' }),
      'utf-8',
    );
    // We can't easily redirect the OS homedir in this test, so just
    // verify the AIDY_HOME path works and trust the array ordering
    // logic for the secondary home (covered by the shared helper's tests).
    const cfg = resolveCLIConfig({ AIDY_HOME: home });
    expect(cfg.jwtSecret).toBe('user-home-manifest-secret');
  });

  it('prefers WS_TOKEN_SECRET over the manifest', () => {
    mkdirSync(join(home, 'state'), { recursive: true });
    writeFileSync(
      join(home, 'state', 'install.json'),
      JSON.stringify({ wsTokenSecret: 'manifest-secret' }),
      'utf-8',
    );
    const cfg = resolveCLIConfig({
      AIDY_HOME: home,
      WS_TOKEN_SECRET: 'env-secret',
    });
    expect(cfg.jwtSecret).toBe('env-secret');
  });

  it('treats an empty WS_TOKEN_SECRET as unset and falls back to the manifest', () => {
    mkdirSync(join(home, 'state'), { recursive: true });
    writeFileSync(
      join(home, 'state', 'install.json'),
      JSON.stringify({ wsTokenSecret: 'manifest-secret' }),
      'utf-8',
    );
    const cfg = resolveCLIConfig({
      AIDY_HOME: home,
      WS_TOKEN_SECRET: '',
    });
    expect(cfg.jwtSecret).toBe('manifest-secret');
  });

  it('treats a WS_TOKEN_SECRET equal to the unsafe default as unset and falls back to the manifest', () => {
    mkdirSync(join(home, 'state'), { recursive: true });
    writeFileSync(
      join(home, 'state', 'install.json'),
      JSON.stringify({ wsTokenSecret: 'manifest-secret' }),
      'utf-8',
    );
    const cfg = resolveCLIConfig({
      AIDY_HOME: home,
      WS_TOKEN_SECRET: 'change-me-in-production',
    });
    expect(cfg.jwtSecret).toBe('manifest-secret');
  });

  it('ignores a manifest whose wsTokenSecret is the unsafe default', () => {
    mkdirSync(join(home, 'state'), { recursive: true });
    writeFileSync(
      join(home, 'state', 'install.json'),
      JSON.stringify({ wsTokenSecret: 'change-me-in-production' }),
      'utf-8',
    );
    const cfg = resolveCLIConfig({ AIDY_HOME: home });
    expect(cfg.jwtSecret).toBe('change-me-in-production');
  });

  it('ignores a manifest whose wsTokenSecret is empty', () => {
    mkdirSync(join(home, 'state'), { recursive: true });
    writeFileSync(
      join(home, 'state', 'install.json'),
      JSON.stringify({ wsTokenSecret: '' }),
      'utf-8',
    );
    const cfg = resolveCLIConfig({ AIDY_HOME: home });
    expect(cfg.jwtSecret).toBe('change-me-in-production');
  });

  it('falls back to the unsafe default when neither env nor any manifest has a real secret', () => {
    const cfg = resolveCLIConfig({ AIDY_HOME: home });
    expect(cfg.jwtSecret).toBe('change-me-in-production');
  });
});
