/**
 * CLI Config tests - PR1 NDQ-5 OPENAIDY_HOME resolution
 *
 * Verifies:
 *  - With OPENAIDY_HOME set, tokenPath is absolute under
 *    OPENAIDY_HOME/credentials/bootstrap-admin.json
 *  - With OPENAIDY_HOME unset, tokenPath falls back to the repo-local
 *    .openaidy/credentials/bootstrap-admin.json (preserving dev workflow)
 *  - With a relative OPENAIDY_HOME, tokenPath is resolved to absolute
 *  - Explicit BOOTSTRAP_ADMIN_TOKEN_PATH still wins
 *  - jwtSecret still falls back to the unsafe default when WS_TOKEN_SECRET
 *    is unset (so the init command can refuse it)
 */

import { describe, it, expect } from 'vitest';
import { resolve, isAbsolute } from 'node:path';
import { resolveCLIConfig } from './config.js';

describe('resolveCLIConfig() - tokenPath resolution (PR1 NDQ-5)', () => {
  it('uses OPENAIDY_HOME/credentials/bootstrap-admin.json when OPENAIDY_HOME is set', () => {
    const cfg = resolveCLIConfig({ OPENAIDY_HOME: '/tmp/openaidy-home' });
    expect(cfg.tokenPath).toBe(
      resolve('/tmp/openaidy-home', 'credentials', 'bootstrap-admin.json'),
    );
    expect(isAbsolute(cfg.tokenPath)).toBe(true);
  });

  it('falls back to repo-local .openaidy/credentials/bootstrap-admin.json when OPENAIDY_HOME is unset', () => {
    const cfg = resolveCLIConfig({});
    expect(cfg.tokenPath).toBe(
      resolve('.openaidy', 'credentials', 'bootstrap-admin.json'),
    );
  });

  it('resolves a relative OPENAIDY_HOME to an absolute tokenPath', () => {
    const cfg = resolveCLIConfig({ OPENAIDY_HOME: 'relative-home' });
    expect(isAbsolute(cfg.tokenPath)).toBe(true);
    expect(cfg.tokenPath).toBe(
      resolve('relative-home', 'credentials', 'bootstrap-admin.json'),
    );
  });

  it('explicit BOOTSTRAP_ADMIN_TOKEN_PATH still wins over OPENAIDY_HOME', () => {
    const cfg = resolveCLIConfig({
      OPENAIDY_HOME: '/tmp/openaidy-home',
      BOOTSTRAP_ADMIN_TOKEN_PATH: '/etc/openaidy/token.json',
    });
    expect(cfg.tokenPath).toBe('/etc/openaidy/token.json');
  });

  it('jwtSecret still falls back to the unsafe default when WS_TOKEN_SECRET is unset', () => {
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
  it('defaults httpUrl to http://localhost:3001 when OPENAIDY_PORT is unset', () => {
    const cfg = resolveCLIConfig({});
    expect(cfg.httpUrl).toBe('http://localhost:3001');
  });

  it('defaults wsUrl to ws://localhost:3001/ws when OPENAIDY_PORT and WS_PATH are unset', () => {
    const cfg = resolveCLIConfig({});
    expect(cfg.wsUrl).toBe('ws://localhost:3001/ws');
  });

  it('honors an explicit OPENAIDY_PORT override', () => {
    const cfg = resolveCLIConfig({ OPENAIDY_PORT: '8080' });
    expect(cfg.httpUrl).toBe('http://localhost:8080');
    expect(cfg.wsUrl).toBe('ws://localhost:8080/ws');
  });

  it('honors an explicit WS_PATH override', () => {
    const cfg = resolveCLIConfig({
      OPENAIDY_PORT: '3001',
      WS_PATH: '/custom/ws',
    });
    expect(cfg.wsUrl).toBe('ws://localhost:3001/custom/ws');
  });

  it('honors an explicit OPENAIDY_WS_URL override', () => {
    const cfg = resolveCLIConfig({
      OPENAIDY_WS_URL: 'wss://example.com/ws',
    });
    expect(cfg.wsUrl).toBe('wss://example.com/ws');
  });

  it('honors an explicit OPENAIDY_SERVER_URL override', () => {
    const cfg = resolveCLIConfig({
      OPENAIDY_SERVER_URL: 'https://api.example.com',
    });
    expect(cfg.httpUrl).toBe('https://api.example.com');
  });
});
