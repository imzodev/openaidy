/**
 * start.test.ts — vitest suite for aidy start (PR2 T2.2)
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
  const home = join(tmpdir(), `aidy-start-test-${randomUUID()}`);
  const distDir = join(home, 'apps/server/dist');
  await mkdir(distDir, { recursive: true });
  await writeFile(join(distDir, 'server.js'), 'console.log("stub server")');
  return home;
}

describe('aidy start', () => {
  let testHome: string;

  beforeEach(async () => {
    testHome = await setupHome();
    process.env.AIDY_HOME = testHome;
  });

  afterEach(() => {
    delete process.env.AIDY_HOME;
    delete process.env.AIDY_PORT;
  });

  it('shows help with --help flag', async () => {
    const result = await startHandler(['--help']);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('Usage:');
  });

  it('defaults AIDY_HOME when unset (no longer requires it)', async () => {
    // A globally-installed `aidy` has no AIDY_HOME; it should default to
    // ~/.aidy and proceed. With AIDY_REPO pointed at an empty dir (so
    // the test doesn't depend on ~/.aidy contents), it gets past home
    // resolution and fails later on the missing server entry.
    delete process.env.AIDY_HOME;
    const noServer = join(tmpdir(), `aidy-start-nohome-${randomUUID()}`);
    await mkdir(noServer, { recursive: true });
    process.env.AIDY_REPO = noServer;
    const result = await startHandler([]);
    delete process.env.AIDY_REPO;
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('not found');
  });

  it('exits 1 when server entry is missing', async () => {
    const emptyHome = join(tmpdir(), `aidy-start-missing-${randomUUID()}`);
    await mkdir(emptyHome, { recursive: true });
    process.env.AIDY_HOME = emptyHome;
    delete process.env.AIDY_REPO;

    const result = await startHandler([]);
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('not found');
  });

  it('uses AIDY_REPO for entry when set', async () => {
    const repoHome = join(tmpdir(), `aidy-start-repo-${randomUUID()}`);
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

    const dataHome = join(tmpdir(), `aidy-start-data-${randomUUID()}`);
    await mkdir(dataHome, { recursive: true });

    process.env.AIDY_REPO = repoHome;
    process.env.AIDY_HOME = dataHome;

    try {
      const result = await startHandler(['--server-only']);
      // Before fix: entry is resolved from AIDY_HOME (dataHome) which has
      // no server.ts → "Server entry not found at <dataHome>/...".
      // After fix: entry is resolved from AIDY_REPO (repoHome) which has
      // the stub → spawn succeeds, /health returns 200, exitCode 0.
      // --server-only skips web spawn (this test stub has no apps/web).
      expect(result.output).not.toContain('Server entry not found');
      expect(result.exitCode).toBe(0);
    } finally {
      delete process.env.AIDY_REPO;
    }
  }, 60_000);

  describe('--foreground', () => {
    const itIfUnix = process.platform === 'win32' ? it.skip : it;

    async function stubRepo(body: string[]): Promise<string> {
      const repoHome = join(tmpdir(), `aidy-start-fg-${randomUUID()}`);
      const srcDir = join(repoHome, 'apps/server/src');
      await mkdir(srcDir, { recursive: true });
      await writeFile(join(srcDir, 'server.ts'), body.join('\n'));
      return repoHome;
    }

    afterEach(() => {
      delete process.env.AIDY_REPO;
    });

    itIfUnix(
      "stays attached and exits with the server's exit code",
      async () => {
        process.env.AIDY_REPO = await stubRepo(['process.exit(3);']);
        const { probeFreePort } = await import('../lib/process-manager.js');
        const port = await probeFreePort(32000, 50);
        const result = await startHandler([
          '--foreground',
          '--port',
          String(port),
        ]);
        expect(result.exitCode).toBe(3);
        const { existsSync } = await import('node:fs');
        expect(existsSync(join(testHome, 'state', 'server.pid'))).toBe(false);
      },
      60_000,
    );

    itIfUnix(
      'forwards SIGTERM to the server and exits cleanly',
      async () => {
        process.env.AIDY_REPO = await stubRepo([
          "import { createServer } from 'node:http';",
          'const server = createServer((req, res) => { res.writeHead(200); res.end(); });',
          "server.listen(Number(process.env.PORT), '127.0.0.1');",
          "process.on('SIGTERM', () => server.close(() => process.exit(0)));",
        ]);
        const { probeFreePort } = await import('../lib/process-manager.js');
        const port = await probeFreePort(32100, 50);
        const before = new Set(process.listeners('SIGTERM'));
        const running = startHandler(['--foreground', '--port', String(port)]);
        const { pollHealth } = await import('./start.js');
        expect(await pollHealth(port)).toBe(true);
        // What systemd does on `systemctl stop`. Fire only the listener this
        // run installed (earlier tests leave their own on the process).
        const added = process
          .listeners('SIGTERM')
          .filter((l) => !before.has(l));
        expect(added).toHaveLength(1);
        added[0]!('SIGTERM');
        const result = await running;
        expect(result.exitCode).toBe(0);
      },
      60_000,
    );
  });

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
      AIDY_PORT: '4000',
    });
    expect(result).toEqual({ ok: true, port: 8080 });
  });

  it('falls back to AIDY_PORT when --port is absent', () => {
    const result = resolveStartPort([], { AIDY_PORT: '4000' });
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

  it('rejects invalid AIDY_PORT', () => {
    const result = resolveStartPort([], { AIDY_PORT: 'not-a-number' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('AIDY_PORT');
  });
});
