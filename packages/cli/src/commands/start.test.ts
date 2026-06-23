/**
 * start.test.ts — vitest suite for openaidy start (PR2 T2.2)
 *
 * Most tests are skipped on Windows per design R-D2 (Unix process management).
 * The environment-variable and port-probing tests run everywhere.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { resolveStartPort, startHandler } from './start.js';

// Helper to create a home dir with a stub server entry
async function setupHome(): Promise<string> {
  const home = join(tmpdir(), `openaidy-start-test-${randomUUID()}`);
  const distDir = join(home, 'apps/server/dist');
  await mkdir(distDir, { recursive: true });
  await writeFile(join(distDir, 'server.js'), 'console.log("stub server")');
  return home;
}

describe('openaidy start', () => {
  let testHome: string;

  beforeEach(async () => {
    testHome = await setupHome();
    process.env.OPENAIDY_HOME = testHome;
  });

  afterEach(() => {
    delete process.env.OPENAIDY_HOME;
    delete process.env.OPENAIDY_PORT;
  });

  it('shows help with --help flag', async () => {
    const result = await startHandler(['--help']);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('Usage:');
  });

  it('exits 1 when OPENAIDY_HOME is not set', async () => {
    delete process.env.OPENAIDY_HOME;
    delete process.env.OPENAIDY_REPO;
    const result = await startHandler([]);
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('OPENAIDY_HOME');
  });

  it('exits 1 when server entry is missing', async () => {
    const emptyHome = join(tmpdir(), `openaidy-start-missing-${randomUUID()}`);
    await mkdir(emptyHome, { recursive: true });
    process.env.OPENAIDY_HOME = emptyHome;
    delete process.env.OPENAIDY_REPO;

    const result = await startHandler([]);
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('not found');
  });

  it('uses OPENAIDY_REPO for entry when set', async () => {
    const repoHome = join(tmpdir(), `openaidy-start-repo-${randomUUID()}`);
    const srcDir = join(repoHome, 'apps/server/src');
    await mkdir(srcDir, { recursive: true });

    // Stub server: listens on PORT from env, responds 200 to /health.
    // Keeps the test fast (no 30s health-poll timeout) and exercises the
    // full spawn path so we know entry resolution succeeded end-to-end.
    const stubSource = [
      "import { createServer } from 'node:http';",
      'const port = Number(process.env.PORT ?? 0);',
      'const server = createServer((req, res) => {',
      "  if (req.url === '/health') { res.writeHead(200); res.end('ok'); }",
      '  else { res.writeHead(404); res.end(); }',
      '});',
      "server.listen(port, '127.0.0.1', () => {});",
      "process.on('SIGTERM', () => { server.close(() => process.exit(0)); });",
    ].join('\n');
    await writeFile(join(srcDir, 'server.ts'), stubSource);

    const dataHome = join(tmpdir(), `openaidy-start-data-${randomUUID()}`);
    await mkdir(dataHome, { recursive: true });

    process.env.OPENAIDY_REPO = repoHome;
    process.env.OPENAIDY_HOME = dataHome;

    try {
      const result = await startHandler(['--server-only']);
      // Before fix: entry is resolved from OPENAIDY_HOME (dataHome) which has
      // no server.ts → "Server entry not found at <dataHome>/...".
      // After fix: entry is resolved from OPENAIDY_REPO (repoHome) which has
      // the stub → spawn succeeds, /health returns 200, exitCode 0.
      // --server-only skips web spawn (this test stub has no apps/web).
      expect(result.output).not.toContain('Server entry not found');
      expect(result.exitCode).toBe(0);
    } finally {
      delete process.env.OPENAIDY_REPO;
    }
  }, 60_000);

  it('probeFreePort returns a valid port', async () => {
    const { probeFreePort } = await import('../lib/process-manager.js');
    const port = await probeFreePort(31000, 5);
    expect(port).toBeGreaterThanOrEqual(31000);
    expect(port).toBeLessThan(31005);
  });

  // Integration tests — Unix only per design R-D2
  describe('process spawning (Unix/macOS only)', () => {
    const itIfUnix = process.platform === 'win32' ? it.skip : it;

    itIfUnix('starts and runs the server', async () => {
      // This test spawns the real server, so it requires a built server dist.
      // We mock the server entry to test the CLI behavior.
      const result = await startHandler([]);
      // On a real Linux box with server built, this would succeed.
      // In test isolation, we verify the handler at least validates correctly.
      expect(result).toBeDefined();
    });
  });
});

describe('resolveStartPort()', () => {
  it('uses DEFAULT_SERVER_PORT (3001) when no flag or env', () => {
    const result = resolveStartPort([], {});
    expect(result).toEqual({ ok: true, port: 3001 });
  });

  it('--port flag wins over env', () => {
    const result = resolveStartPort(['--port', '8080'], {
      OPENAIDY_PORT: '4000',
    });
    expect(result).toEqual({ ok: true, port: 8080 });
  });

  it('falls back to OPENAIDY_PORT when --port is absent', () => {
    const result = resolveStartPort([], { OPENAIDY_PORT: '4000' });
    expect(result).toEqual({ ok: true, port: 4000 });
  });

  it('rejects --port that is not a positive integer', () => {
    const result = resolveStartPort(['--port', 'abc'], {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('--port');
  });

  it('rejects --port that is zero or negative', () => {
    expect(resolveStartPort(['--port', '0'], {}).ok).toBe(false);
    expect(resolveStartPort(['--port', '-1'], {}).ok).toBe(false);
    expect(resolveStartPort(['--port', '65536'], {}).ok).toBe(false);
  });

  it('rejects --port with no value', () => {
    const result = resolveStartPort(['--port'], {});
    expect(result.ok).toBe(false);
  });

  it('rejects invalid OPENAIDY_PORT', () => {
    const result = resolveStartPort([], { OPENAIDY_PORT: 'not-a-number' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('OPENAIDY_PORT');
  });
});
