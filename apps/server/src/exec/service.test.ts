import { describe, it, expect } from 'vitest';
import { createExecService } from './service';

const IS_WINDOWS = process.platform === 'win32';

/** A command that runs for several seconds on the current platform. */
const LONG_RUNNING = IS_WINDOWS ? 'ping -n 6 127.0.0.1' : 'sleep 5';

describe('ExecService.run', () => {
  it('captures stdout and a zero exit code', async () => {
    const exec = createExecService();
    const result = await exec.run('echo hello');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('hello');
    expect(result.timedOut).toBe(false);
    expect(result.cancelled).toBeFalsy();
  });

  it('streams output through onOutput as it arrives', async () => {
    const exec = createExecService();
    const chunks: Array<{ stream: string; data: string }> = [];

    const result = await exec.run('echo streamed', undefined, {
      onOutput: (chunk) => chunks.push(chunk),
    });

    expect(result.exitCode).toBe(0);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.some((c) => c.stream === 'stdout')).toBe(true);
    expect(chunks.map((c) => c.data).join('')).toContain('streamed');
  });

  it('blocks dangerous commands before spawning', async () => {
    const exec = createExecService();
    const result = await exec.run('rm -rf /');

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Command blocked');
    expect(result.cancelled).toBeFalsy();
  });

  it('returns cancelled immediately when the signal is already aborted', async () => {
    const exec = createExecService();
    const controller = new AbortController();
    controller.abort();

    const result = await exec.run('echo nope', undefined, {
      signal: controller.signal,
    });

    expect(result.cancelled).toBe(true);
    expect(result.exitCode).toBe(130);
    expect(result.stdout).toBe('');
  });

  it('cancels an in-flight command via the abort signal (SIGTERM, then grace)', async () => {
    const exec = createExecService({ timeoutMs: 30_000 });
    const controller = new AbortController();

    const promise = exec.run(LONG_RUNNING, undefined, {
      signal: controller.signal,
    });
    // Give the child time to spawn, then ask it to stop.
    setTimeout(() => controller.abort(), 150);

    const result = await promise;

    expect(result.cancelled).toBe(true);
    expect(result.exitCode).toBe(130);
    // The grace period is 2s; a killed process must resolve well before the
    // 30s timeout, proving cancel took effect rather than the command finishing.
    expect(result.timedOut).toBe(false);
  }, 10_000);

  it('reports timedOut when a command exceeds the timeout', async () => {
    const exec = createExecService({ timeoutMs: 200 });
    const result = await exec.run(LONG_RUNNING);

    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBe(124);
    expect(result.cancelled).toBeFalsy();
  }, 10_000);
});
