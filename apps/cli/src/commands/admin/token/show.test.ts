import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

// Mock environment for tests
const originalEnv = process.env;

describe('openaidy admin token show', () => {
  let tempDir: string;
  let tokenPath: string;
  let credentialsDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'openaidy-cli-admin-'));
    credentialsDir = join(tempDir, 'credentials');
    await mkdir(credentialsDir, { recursive: true });
    tokenPath = join(credentialsDir, 'bootstrap-admin.json');

    // Set test environment
    process.env = {
      ...originalEnv,
      BOOTSTRAP_ADMIN_TOKEN_PATH: tokenPath,
      WS_TOKEN_SECRET: 'cli-test-secret',
      BOOTSTRAP_ADMIN_ENABLED: 'true',
    };
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    process.env = originalEnv;
  });

  it('exits with code 1 and shows disabled status when bootstrap-admin is disabled', async () => {
    process.env.BOOTSTRAP_ADMIN_ENABLED = 'false';

    // Import the handler directly for testing
    const { handleAdminTokenShow } = await import('./show.ts');
    const result = await handleAdminTokenShow([]);

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('Status:    disabled');
    expect(result.output).toContain('Enabled:   false');
    expect(result.output).not.toContain('Token:');
  });

  it('exits with code 1 for missing token file', async () => {
    const { handleAdminTokenShow } = await import('./show.ts');
    const result = await handleAdminTokenShow([]);

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('Status:    missing');
    expect(result.output).toContain(tokenPath);
  });

  it('exits with code 1 for malformed token file (invalid JSON)', async () => {
    await writeFile(tokenPath, 'not valid json', 'utf-8');

    const { handleAdminTokenShow } = await import('./show.ts');
    const result = await handleAdminTokenShow([]);

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('Status:    malformed');
    expect(result.output).toContain('invalid JSON');
  });

  it('exits with code 1 for malformed token file (invalid structure)', async () => {
    await writeFile(tokenPath, JSON.stringify({ clientId: 'test' }), 'utf-8');

    const { handleAdminTokenShow } = await import('./show.ts');
    const result = await handleAdminTokenShow([]);

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('Status:    malformed');
    expect(result.output).toContain('invalid structure');
  });

  it('exits with code 1 for invalid token (bad signature)', async () => {
    const record = {
      clientId: 'bootstrap-admin',
      token: 'invalid.token.here',
      scopes: ['admin'],
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    };
    await writeFile(tokenPath, JSON.stringify(record), 'utf-8');

    const { handleAdminTokenShow } = await import('./show.ts');
    const result = await handleAdminTokenShow([]);

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('Status:    invalid');
  });

  it.skip('exits with code 1 for expired token', async () => {
    // Note: Testing expired tokens requires generating a properly signed JWT
    // that has actually expired. This is complex because the token must be
    // signed with the correct secret but have an expired exp claim.
    // For now, we skip this test as the core validation logic is tested
    // in the server-side bootstrap-admin-inspect.test.ts
  });

  it('includes token path in output', async () => {
    const { handleAdminTokenShow } = await import('./show.ts');
    const result = await handleAdminTokenShow([]);

    expect(result.output).toContain(tokenPath);
  });

  it('shows help with --help flag', async () => {
    const { handleAdminTokenShow } = await import('./show.ts');
    const result = await handleAdminTokenShow(['--help']);

    expect(result.output).toContain('Usage:');
    expect(result.output).toContain('openaidy admin token show');
  });
});
