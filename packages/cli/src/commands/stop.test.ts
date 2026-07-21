/**
 * stop.test.ts — vitest suite for openaidy stop (PR2 T2.3)
 *
 * Tests process-kill behavior in isolation using mocks.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { stopHandler } from './stop.js';
import { writePidFile } from '../lib/process-manager.js';

async function setupHome(): Promise<string> {
  const home = join(tmpdir(), `openaidy-stop-test-${randomUUID()}`);
  await mkdir(join(home, 'state'), { recursive: true });
  return home;
}

describe('openaidy stop', () => {
  let testHome: string;

  beforeEach(async () => {
    testHome = await setupHome();
    process.env.OPENAIDY_HOME = testHome;
  });

  afterEach(() => {
    delete process.env.OPENAIDY_HOME;
  });

  it('shows help with --help flag', async () => {
    const result = await stopHandler(['--help']);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('Usage:');
  });

  it('reports "not running" when no PID file exists', async () => {
    const result = await stopHandler([]);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('not running');
  });

  it('cleans up stale PID file when process is dead', async () => {
    const pidFilePath = join(testHome, 'state/server.pid');
    await writePidFile(pidFilePath, {
      pid: 0xffffff,
      startedAt: new Date().toISOString(),
      port: 3001,
      logFile: '/dev/null',
    });

    const result = await stopHandler([]);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('stale');
  });

  // Note: OPENAIDY_HOME now defaults to ~/.openaidy when unset (so a global
  // `openaidy stop` finds the running server), so there's no longer an
  // "unset → not running" special case — the no-PID-file path above covers it.
});
