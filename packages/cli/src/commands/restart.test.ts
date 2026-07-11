/**
 * restart.test.ts — vitest suite for openaidy restart.
 *
 * The handler delegates to `stopHandler` then `startHandler`. To exercise the
 * restart wiring without spawning real server processes, we drive scenarios
 * where:
 *  - stop cleanly exits (no PID file → "not running")
 *  - start fails fast on missing server entry → exit 1
 *  - mutual exclusion is checked BEFORE stop runs
 *  - port is preserved from a stale PID file
 *
 * These are the meaningful restart-level behaviors. The deep test coverage
 * of stop/start lives in their own suites; this file only asserts the glue.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { writePidFile } from '../lib/process-manager.js';

// Mock the stop + start handlers so we can drive their return values
// without spinning up real processes. The mocks live at module scope so
// the SUT (restart.ts) — which dynamically imports them — picks them up
// via the vi.mock factory below.
vi.mock('./stop.js', () => ({
  stopHandler: vi.fn(),
}));
vi.mock('./start.js', () => ({
  startHandler: vi.fn(),
}));

// Import AFTER mocks so the SUT resolves the mocked modules.
import { restartHandler } from './restart.js';
import { stopHandler } from './stop.js';
import { startHandler } from './start.js';

const mockedStop = vi.mocked(stopHandler);
const mockedStart = vi.mocked(startHandler);

async function setupHome(): Promise<string> {
  const home = join(tmpdir(), `openaidy-restart-test-${randomUUID()}`);
  await mkdir(join(home, 'state'), { recursive: true });
  return home;
}

describe('openaidy restart', () => {
  let testHome: string;

  beforeEach(async () => {
    testHome = await setupHome();
    process.env.OPENAIDY_HOME = testHome;
    vi.resetAllMocks();
  });

  afterEach(() => {
    delete process.env.OPENAIDY_HOME;
  });

  it('shows help with --help flag', async () => {
    const result = await restartHandler(['--help']);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('Usage:');
    expect(result.output).toContain('restart');
    // Help should not invoke the underlying handlers.
    expect(mockedStop).not.toHaveBeenCalled();
    expect(mockedStart).not.toHaveBeenCalled();
  });

  it('rejects --server-only + --integrated BEFORE running stop', async () => {
    const result = await restartHandler(['--server-only', '--integrated']);
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('mutually exclusive');
    expect(result.output).toContain('NOT restarted');
    // Critical: no process was killed.
    expect(mockedStop).not.toHaveBeenCalled();
    expect(mockedStart).not.toHaveBeenCalled();
  });

  it('preserves the previous port from the PID file when --port is omitted', async () => {
    // Write a PID file with port 4242.
    await writePidFile(join(testHome, 'state/server.pid'), {
      pid: 0xffffff,
      startedAt: new Date().toISOString(),
      port: 4242,
      logFile: '/dev/null',
    });

    mockedStop.mockResolvedValue({ exitCode: 0, output: 'Server stopped.' });
    mockedStart.mockResolvedValue({
      exitCode: 0,
      output: 'Server running on http://localhost:4242',
    });

    const result = await restartHandler([]);
    expect(result.exitCode).toBe(0);
    expect(mockedStart).toHaveBeenCalledTimes(1);
    const forwardedArgs = mockedStart.mock.calls[0]?.[0] as string[];
    expect(forwardedArgs).toContain('--port');
    expect(forwardedArgs).toContain('4242');
    // stop got the original args (no --port injection there).
    const stopArgs = mockedStop.mock.calls[0]?.[0] as string[];
    expect(stopArgs).not.toContain('--port');
  });

  it('honors an explicit --port and does NOT override it with the PID file port', async () => {
    await writePidFile(join(testHome, 'state/server.pid'), {
      pid: 0xffffff,
      startedAt: new Date().toISOString(),
      port: 4242,
      logFile: '/dev/null',
    });

    mockedStop.mockResolvedValue({ exitCode: 0, output: 'Server stopped.' });
    mockedStart.mockResolvedValue({
      exitCode: 0,
      output: 'Server running on http://localhost:4000',
    });

    const result = await restartHandler(['--port', '4000']);
    expect(result.exitCode).toBe(0);
    const forwardedArgs = mockedStart.mock.calls[0]?.[0] as string[];
    expect(forwardedArgs).toContain('4000');
    // Exactly one --port value, and it is 4000, not 4242.
    expect(forwardedArgs.filter((a) => a === '--port')).toHaveLength(1);
  });

  it('does NOT call start when stop fails', async () => {
    mockedStop.mockResolvedValue({
      exitCode: 1,
      output: 'Error: failed to stop server',
    });

    const result = await restartHandler([]);
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('failed to stop server');
    expect(mockedStop).toHaveBeenCalledTimes(1);
    expect(mockedStart).not.toHaveBeenCalled();
  });

  it('returns the start error and surfaces the stop output when stop succeeds but start fails', async () => {
    mockedStop.mockResolvedValue({ exitCode: 0, output: 'Server stopped.' });
    mockedStart.mockResolvedValue({
      exitCode: 1,
      output: 'Error: server entry not found at /tmp/missing/server.ts',
    });

    const result = await restartHandler([]);
    expect(result.exitCode).toBe(1);
    // Both outputs present so the user sees what happened.
    expect(result.output).toContain('Server stopped.');
    expect(result.output).toContain('server entry not found');
  });

  it('returns 0 when both stop and start succeed (not-running + start works)', async () => {
    // No PID file → stop returns 0 with "not running"
    mockedStop.mockResolvedValue({
      exitCode: 0,
      output: 'Server is not running.',
    });
    mockedStart.mockResolvedValue({
      exitCode: 0,
      output: 'Server running on http://localhost:3001',
    });

    const result = await restartHandler([]);
    expect(result.exitCode).toBe(0);
    expect(mockedStop).toHaveBeenCalledTimes(1);
    expect(mockedStart).toHaveBeenCalledTimes(1);
  });
});
