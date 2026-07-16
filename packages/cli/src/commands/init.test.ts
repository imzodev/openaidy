/**
 * openaidy init - tests
 *
 * Verifies the contract for `openaidy init` per PR1 spec R-1..R-3, R-6:
 *  - First-run generates and persists a token file at tokenPath
 *  - Valid existing token is reused (mtime unchanged)
 *  - Expired, corrupt, or missing-field records force regeneration
 *  - Default JWT secret → exit 1 with a remediation message
 *  - Bootstrap admin disabled → exit 1
 *  - Stdout contains a parseable `Bootstrap admin token: <jwt>` line
 *  - Token file is mode 0o600 on POSIX
 *  - Cleans up tmpdir after each case
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { BootstrapAdminRecord } from '@openaidy/shared-types';

/**
 * Helper: capture stdout writes during the handler invocation.
 * The init command should print exactly one parseable token line.
 */
function captureStdout<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; stdout: string }> {
  let captured = '';
  let originalWrite: typeof process.stdout.write;
  return new Promise((resolveFn, reject) => {
    originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      captured +=
        typeof chunk === 'string'
          ? chunk
          : Buffer.from(
              chunk.buffer,
              chunk.byteOffset,
              chunk.byteLength,
            ).toString();
      return true;
    }) as typeof process.stdout.write;
    fn()
      .then((result) => {
        process.stdout.write = originalWrite;
        resolveFn({ result, stdout: captured });
      })
      .catch((err) => {
        process.stdout.write = originalWrite;
        reject(err);
      });
  });
}

describe('openaidy init', () => {
  let tempHome: string;
  let tokenPath: string;

  beforeEach(async () => {
    tempHome = join(tmpdir(), `openaidy-init-${Date.now()}-${Math.random()}`);
    await mkdir(tempHome, { recursive: true });
    tokenPath = join(tempHome, 'credentials', 'bootstrap-admin.json');
  });

  afterEach(async () => {
    await rm(tempHome, { recursive: true, force: true });
  });

  it('creates the token file and prints a parseable token line on first run', async () => {
    vi.resetModules();
    const { initHandler } = await import('./init.js');

    const env = {
      OPENAIDY_HOME: tempHome,
      WS_TOKEN_SECRET: 'unit-test-jwt-secret-not-the-default',
      BOOTSTRAP_ADMIN_ENABLED: 'true',
    } as NodeJS.ProcessEnv;

    const { result, stdout } = await captureStdout(() => initHandler([], env));

    expect(result.exitCode).toBe(0);
    expect(result.error).toBeUndefined();
    expect(stdout).toMatch(
      /^Bootstrap admin token: [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
    );

    const persisted = JSON.parse(
      await readFile(tokenPath, 'utf-8'),
    ) as BootstrapAdminRecord;
    expect(persisted.clientId).toBeTruthy();
    expect(persisted.token).toBeTruthy();
    expect(persisted.scopes).toContain('*');
    expect(typeof persisted.createdAt).toBe('string');
    expect(typeof persisted.expiresAt).toBe('string');
  });

  it('writes the token file with mode 0o600 on POSIX', async () => {
    if (process.platform === 'win32') {
      return; // POSIX-only check
    }
    vi.resetModules();
    const { initHandler } = await import('./init.js');
    await initHandler([], {
      OPENAIDY_HOME: tempHome,
      WS_TOKEN_SECRET: 'unit-test-jwt-secret-not-the-default',
      BOOTSTRAP_ADMIN_ENABLED: 'true',
    } as NodeJS.ProcessEnv);

    const stats = await stat(tokenPath);
    expect(stats.mode & 0o777).toBe(0o600);
  });

  it('reuses a valid existing token without rewriting the file', async () => {
    vi.resetModules();
    const { initHandler } = await import('./init.js');
    const env = {
      OPENAIDY_HOME: tempHome,
      WS_TOKEN_SECRET: 'unit-test-jwt-secret-not-the-default',
      BOOTSTRAP_ADMIN_ENABLED: 'true',
    } as NodeJS.ProcessEnv;

    // First run — generates
    await initHandler([], env);
    const firstBytes = await readFile(tokenPath, 'utf-8');
    const initialMtime = (await stat(tokenPath)).mtimeMs;

    // Give the FS a moment so an inadvertent rewrite would show in mtime
    await new Promise((r) => setTimeout(r, 25));

    const { result, stdout } = await captureStdout(() => initHandler([], env));

    expect(result.exitCode).toBe(0);
    expect(stdout).toMatch(/^Bootstrap admin token: /);

    const finalBytes = await readFile(tokenPath, 'utf-8');
    expect(finalBytes).toBe(firstBytes);
    expect((await stat(tokenPath)).mtimeMs).toBe(initialMtime);
  });

  it('regenerates when the existing token has expired', async () => {
    vi.resetModules();
    const { initHandler } = await import('./init.js');
    const env = {
      OPENAIDY_HOME: tempHome,
      WS_TOKEN_SECRET: 'unit-test-jwt-secret-not-the-default',
      BOOTSTRAP_ADMIN_ENABLED: 'true',
    } as NodeJS.ProcessEnv;

    await mkdir(join(tempHome, 'credentials'), { recursive: true });
    const expired: BootstrapAdminRecord = {
      clientId: 'bootstrap-admin',
      token: 'placeholder.signature.value',
      scopes: ['*'],
      createdAt: '2020-01-01T00:00:00.000Z',
      expiresAt: '2020-12-31T00:00:00.000Z',
    };
    await writeFile(tokenPath, JSON.stringify(expired), 'utf-8');

    const { result, stdout } = await captureStdout(() => initHandler([], env));

    expect(result.exitCode).toBe(0);
    expect(stdout).toMatch(/^Bootstrap admin token: /);
    expect(stdout).not.toContain('placeholder.signature.value');

    const persisted = JSON.parse(
      await readFile(tokenPath, 'utf-8'),
    ) as BootstrapAdminRecord;
    expect(persisted.expiresAt).not.toBe(expired.expiresAt);
  });

  it('regenerates when the existing file contains invalid JSON', async () => {
    vi.resetModules();
    const { initHandler } = await import('./init.js');
    const env = {
      OPENAIDY_HOME: tempHome,
      WS_TOKEN_SECRET: 'unit-test-jwt-secret-not-the-default',
      BOOTSTRAP_ADMIN_ENABLED: 'true',
    } as NodeJS.ProcessEnv;

    await mkdir(join(tempHome, 'credentials'), { recursive: true });
    await writeFile(tokenPath, '{ this is not json', 'utf-8');

    const { result, stdout } = await captureStdout(() => initHandler([], env));
    expect(result.exitCode).toBe(0);
    expect(stdout).toMatch(/^Bootstrap admin token: /);

    // After regeneration the file is valid JSON
    JSON.parse(await readFile(tokenPath, 'utf-8')) as BootstrapAdminRecord;
  });

  it('regenerates when the existing record is missing required fields', async () => {
    vi.resetModules();
    const { initHandler } = await import('./init.js');
    const env = {
      OPENAIDY_HOME: tempHome,
      WS_TOKEN_SECRET: 'unit-test-jwt-secret-not-the-default',
      BOOTSTRAP_ADMIN_ENABLED: 'true',
    } as NodeJS.ProcessEnv;

    await mkdir(join(tempHome, 'credentials'), { recursive: true });
    await writeFile(tokenPath, JSON.stringify({ clientId: 'x' }), 'utf-8');

    const { result } = await captureStdout(() => initHandler([], env));
    expect(result.exitCode).toBe(0);

    const persisted = JSON.parse(
      await readFile(tokenPath, 'utf-8'),
    ) as BootstrapAdminRecord;
    expect(persisted.token).toBeTruthy();
    expect(persisted.scopes).toContain('*');
  });

  it('exits 1 with a remediation message when JWT secret is the unsafe default', async () => {
    vi.resetModules();
    const { initHandler } = await import('./init.js');
    const env = {
      OPENAIDY_HOME: tempHome,
      // No WS_TOKEN_SECRET — config resolves to default
      BOOTSTRAP_ADMIN_ENABLED: 'true',
    } as NodeJS.ProcessEnv;

    const { result } = await captureStdout(() => initHandler([], env));

    expect(result.exitCode).toBe(1);
    expect(result.error).toMatch(/default JWT secret/i);
    expect(result.error).toContain('WS_TOKEN_SECRET');

    // No file should be written
    await expect(stat(tokenPath)).rejects.toThrow();
  });

  it('exits 1 when BOOTSTRAP_ADMIN_ENABLED=false', async () => {
    vi.resetModules();
    const { initHandler } = await import('./init.js');
    const env = {
      OPENAIDY_HOME: tempHome,
      WS_TOKEN_SECRET: 'unit-test-jwt-secret-not-the-default',
      BOOTSTRAP_ADMIN_ENABLED: 'false',
    } as NodeJS.ProcessEnv;

    const { result } = await captureStdout(() => initHandler([], env));

    expect(result.exitCode).toBe(1);
    expect(result.error).toMatch(/disabled/i);

    // No file should be written
    await expect(stat(tokenPath)).rejects.toThrow();
  });

  it('prints --help and exits 0', async () => {
    vi.resetModules();
    const { initHandler } = await import('./init.js');
    const env = {
      OPENAIDY_HOME: tempHome,
      WS_TOKEN_SECRET: 'unit-test-jwt-secret-not-the-default',
    } as NodeJS.ProcessEnv;

    const { result, stdout } = await captureStdout(() =>
      initHandler(['--help'], env),
    );
    expect(result.exitCode).toBe(0);
    expect(stdout).toContain('Usage:');
    expect(stdout).toContain('openaidy init');
  });

  // -------------------------------------------------------------------------
  // Manifest-fallback regression tests (the user-reported reinstall bug):
  // `openaidy stop && curl install.sh | bash` previously caused the server
  // to silently regenerate the bootstrap admin JWT, logging the user out.
  // The CLI's `init` command (used by the install script) must now agree
  // with the server on the same JWT secret precedence: explicit env > the
  // persisted manifest at $OPENAIDY_HOME/state/install.json > refusal.
  // -------------------------------------------------------------------------

  it('uses the manifest secret when WS_TOKEN_SECRET is unset (regression: reinstall bug)', async () => {
    vi.resetModules();
    const { initHandler } = await import('./init.js');

    // Simulate the install script having persisted the secret on a
    // previous run.
    await mkdir(join(tempHome, 'state'), { recursive: true });
    await writeFile(
      join(tempHome, 'state', 'install.json'),
      JSON.stringify({
        wsTokenSecret: 'persisted-install-secret',
        generatedAt: '2024-01-01T00:00:00Z',
      }),
      'utf-8',
    );

    const env = {
      OPENAIDY_HOME: tempHome,
      BOOTSTRAP_ADMIN_ENABLED: 'true',
      // No WS_TOKEN_SECRET — exactly the manual-init scenario.
    } as NodeJS.ProcessEnv;

    const { result, stdout } = await captureStdout(() => initHandler([], env));

    expect(result.exitCode).toBe(0);
    expect(result.error).toBeUndefined();
    expect(stdout).toMatch(
      /^Bootstrap admin token: [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
    );

    const persisted = JSON.parse(
      await readFile(tokenPath, 'utf-8'),
    ) as BootstrapAdminRecord;
    expect(persisted.token).toBeTruthy();
  });

  it('explicit WS_TOKEN_SECRET wins over the manifest', async () => {
    vi.resetModules();
    const { initHandler } = await import('./init.js');

    await mkdir(join(tempHome, 'state'), { recursive: true });
    await writeFile(
      join(tempHome, 'state', 'install.json'),
      JSON.stringify({ wsTokenSecret: 'persisted-install-secret' }),
      'utf-8',
    );

    const env = {
      OPENAIDY_HOME: tempHome,
      WS_TOKEN_SECRET: 'caller-override-secret',
      BOOTSTRAP_ADMIN_ENABLED: 'true',
    } as NodeJS.ProcessEnv;

    const { result, stdout } = await captureStdout(() => initHandler([], env));

    expect(result.exitCode).toBe(0);
    expect(stdout).toMatch(/^Bootstrap admin token: /);
  });

  it('still refuses to mint when neither env nor manifest has a real secret', async () => {
    vi.resetModules();
    const { initHandler } = await import('./init.js');

    const env = {
      OPENAIDY_HOME: tempHome,
      BOOTSTRAP_ADMIN_ENABLED: 'true',
    } as NodeJS.ProcessEnv;

    const { result } = await captureStdout(() => initHandler([], env));

    expect(result.exitCode).toBe(1);
    expect(result.error).toMatch(/default JWT secret/i);

    // No token file should be written.
    await expect(stat(tokenPath)).rejects.toThrow();
  });
});
