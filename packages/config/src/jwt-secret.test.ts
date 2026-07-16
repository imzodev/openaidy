/**
 * Tests for the shared JWT-secret resolution helper.
 *
 * The bug being prevented: if `WS_TOKEN_SECRET` is unset on a manual
 * `openaidy start`, the server falls back to the unsafe default secret
 * and `BootstrapAdminManager.ensureToken()` regenerates the admin JWT
 * (because signature validation fails against the old secret), silently
 * logging the user out of the UI. The install script persists the secret
 * to `$OPENAIDY_HOME/state/install.json`; both the CLI and the server
 * must read from there as a fallback.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readJwtSecretFromState,
  resolveJwtSecret,
  UNSAFE_DEFAULT_JWT_SECRET,
} from './jwt-secret';

describe('readJwtSecretFromState', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'openaidy-jwt-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns undefined when the manifest is missing', () => {
    expect(readJwtSecretFromState(dir)).toBeUndefined();
  });

  it('returns undefined when the manifest contains invalid JSON', () => {
    mkdirSync(join(dir, 'state'), { recursive: true });
    writeFileSync(join(dir, 'state', 'install.json'), '{not json', 'utf-8');
    expect(readJwtSecretFromState(dir)).toBeUndefined();
  });

  it('returns undefined when wsTokenSecret is missing', () => {
    mkdirSync(join(dir, 'state'), { recursive: true });
    writeFileSync(
      join(dir, 'state', 'install.json'),
      JSON.stringify({ generatedAt: '2024-01-01T00:00:00Z' }),
      'utf-8',
    );
    expect(readJwtSecretFromState(dir)).toBeUndefined();
  });

  it('returns undefined when wsTokenSecret is an empty string', () => {
    mkdirSync(join(dir, 'state'), { recursive: true });
    writeFileSync(
      join(dir, 'state', 'install.json'),
      JSON.stringify({ wsTokenSecret: '' }),
      'utf-8',
    );
    expect(readJwtSecretFromState(dir)).toBeUndefined();
  });

  it('returns undefined when wsTokenSecret is the unsafe default', () => {
    mkdirSync(join(dir, 'state'), { recursive: true });
    writeFileSync(
      join(dir, 'state', 'install.json'),
      JSON.stringify({ wsTokenSecret: UNSAFE_DEFAULT_JWT_SECRET }),
      'utf-8',
    );
    expect(readJwtSecretFromState(dir)).toBeUndefined();
  });

  it('returns the persisted secret when present and valid', () => {
    mkdirSync(join(dir, 'state'), { recursive: true });
    writeFileSync(
      join(dir, 'state', 'install.json'),
      JSON.stringify({
        wsTokenSecret: 'a-real-secret-from-the-install-script',
        generatedAt: '2024-01-01T00:00:00Z',
      }),
      'utf-8',
    );
    expect(readJwtSecretFromState(dir)).toBe(
      'a-real-secret-from-the-install-script',
    );
  });
});

describe('resolveJwtSecret', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'openaidy-jwt-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('uses an explicit non-default env value over the manifest', () => {
    mkdirSync(join(dir, 'state'), { recursive: true });
    writeFileSync(
      join(dir, 'state', 'install.json'),
      JSON.stringify({ wsTokenSecret: 'manifest-secret' }),
      'utf-8',
    );
    expect(resolveJwtSecret('env-secret', dir)).toBe('env-secret');
  });

  it('falls back to the manifest when env is undefined', () => {
    mkdirSync(join(dir, 'state'), { recursive: true });
    writeFileSync(
      join(dir, 'state', 'install.json'),
      JSON.stringify({ wsTokenSecret: 'manifest-secret' }),
      'utf-8',
    );
    expect(resolveJwtSecret(undefined, dir)).toBe('manifest-secret');
  });

  it('falls back to the manifest when env is the unsafe default', () => {
    mkdirSync(join(dir, 'state'), { recursive: true });
    writeFileSync(
      join(dir, 'state', 'install.json'),
      JSON.stringify({ wsTokenSecret: 'manifest-secret' }),
      'utf-8',
    );
    expect(resolveJwtSecret(UNSAFE_DEFAULT_JWT_SECRET, dir)).toBe(
      'manifest-secret',
    );
  });

  it('treats an empty-string env value as unset', () => {
    mkdirSync(join(dir, 'state'), { recursive: true });
    writeFileSync(
      join(dir, 'state', 'install.json'),
      JSON.stringify({ wsTokenSecret: 'manifest-secret' }),
      'utf-8',
    );
    expect(resolveJwtSecret('', dir)).toBe('manifest-secret');
  });

  it('falls back to the unsafe default when neither env nor manifest is set', () => {
    expect(resolveJwtSecret(undefined, dir)).toBe(UNSAFE_DEFAULT_JWT_SECRET);
  });
});
