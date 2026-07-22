import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

const spawnMock = vi.fn();
vi.mock('node:child_process', () => ({ spawn: spawnMock }));

const {
  createUpdateService,
  detectSelfUpdatable,
  defaultInstall,
  defaultRestart,
} = await import('./service');

/** A fake ChildProcess: an EventEmitter with the bits defaultInstall/defaultRestart touch. */
function fakeChild() {
  const child = new EventEmitter() as EventEmitter & { unref: () => void };
  child.unref = vi.fn();
  return child;
}

/**
 * Build a fake `fetch` that answers the npm registry `/latest` endpoint with
 * `latest`, and (optionally) the GitHub release endpoint with `notes`.
 */
function fakeFetch(opts: {
  latest?: string;
  registryOk?: boolean;
  notes?: string | null;
}) {
  const { latest = '0.4.0', registryOk = true, notes = null } = opts;
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('registry.npmjs.org')) {
      return {
        ok: registryOk,
        status: registryOk ? 200 : 503,
        statusText: registryOk ? 'OK' : 'Service Unavailable',
        json: async () => ({ version: latest }),
      } as Response;
    }
    if (url.includes('api.github.com')) {
      return {
        ok: notes != null,
        status: notes != null ? 200 : 404,
        statusText: notes != null ? 'OK' : 'Not Found',
        json: async () => ({ body: notes }),
      } as Response;
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

/** A promise whose resolve/reject can be triggered from the test. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((r) => setImmediate(r));

describe('UpdateService.check', () => {
  it('reports an update when the registry has a newer version', async () => {
    const svc = createUpdateService({
      currentVersion: '0.3.8',
      canSelfUpdate: true,
      fetchFn: fakeFetch({ latest: '0.4.0' }),
    });
    const result = await svc.check();
    expect(result.currentVersion).toBe('0.3.8');
    expect(result.latestVersion).toBe('0.4.0');
    expect(result.updateAvailable).toBe(true);
    expect(result.canSelfUpdate).toBe(true);
  });

  it('reports no update when already on the latest version', async () => {
    const svc = createUpdateService({
      currentVersion: '0.4.0',
      fetchFn: fakeFetch({ latest: '0.4.0' }),
    });
    const result = await svc.check();
    expect(result.updateAvailable).toBe(false);
  });

  it('includes best-effort release notes when GitHub has them', async () => {
    const svc = createUpdateService({
      currentVersion: '0.3.8',
      fetchFn: fakeFetch({
        latest: '0.4.0',
        notes: 'Bug fixes and improvements',
      }),
    });
    const result = await svc.check();
    expect(result.releaseNotes).toBe('Bug fixes and improvements');
  });

  it('omits release notes when GitHub has none (does not throw)', async () => {
    const svc = createUpdateService({
      currentVersion: '0.3.8',
      fetchFn: fakeFetch({ latest: '0.4.0', notes: null }),
    });
    const result = await svc.check();
    expect(result.releaseNotes).toBeUndefined();
  });

  it('throws when the registry request fails', async () => {
    const svc = createUpdateService({
      currentVersion: '0.3.8',
      fetchFn: fakeFetch({ registryOk: false }),
    });
    await expect(svc.check()).rejects.toThrow(/registry responded 503/);
  });
});

describe('UpdateService.startUpdate', () => {
  it('refuses when the deployment cannot self-update', () => {
    const install = vi.fn();
    const svc = createUpdateService({
      currentVersion: '0.3.8',
      canSelfUpdate: false,
      installFn: install,
      restartFn: vi.fn(),
    });
    const result = svc.startUpdate('0.4.0');
    expect(result).toEqual({ ok: false, reason: 'not-supported' });
    expect(install).not.toHaveBeenCalled();
  });

  it('installs then restarts on success', async () => {
    const install = vi.fn().mockResolvedValue(undefined);
    const restart = vi.fn();
    const svc = createUpdateService({
      currentVersion: '0.3.8',
      canSelfUpdate: true,
      installFn: install,
      restartFn: restart,
    });

    const result = svc.startUpdate('0.4.0');
    expect(result.ok).toBe(true);
    // Immediately after triggering, state is 'installing'.
    expect(svc.getState().status).toBe('installing');

    await flush();

    expect(install).toHaveBeenCalledWith('@openaidy/app', '0.4.0');
    expect(restart).toHaveBeenCalledOnce();
    expect(svc.getState().status).toBe('restarting');
    expect(svc.getState().newVersion).toBe('0.4.0');
  });

  it('reports an error and does not restart when install fails', async () => {
    const install = vi.fn().mockRejectedValue(new Error('EACCES'));
    const restart = vi.fn();
    const svc = createUpdateService({
      currentVersion: '0.3.8',
      canSelfUpdate: true,
      installFn: install,
      restartFn: restart,
    });

    svc.startUpdate('0.4.0');
    await flush();

    expect(restart).not.toHaveBeenCalled();
    const state = svc.getState();
    expect(state.status).toBe('error');
    expect(state.error).toContain('EACCES');
  });

  it('reports an error when the restart hand-off throws', async () => {
    const install = vi.fn().mockResolvedValue(undefined);
    const restart = vi.fn().mockImplementation(() => {
      throw new Error('spawn openaidy ENOENT');
    });
    const svc = createUpdateService({
      currentVersion: '0.3.8',
      canSelfUpdate: true,
      installFn: install,
      restartFn: restart,
    });

    svc.startUpdate('0.4.0');
    await flush();

    expect(restart).toHaveBeenCalledOnce();
    const state = svc.getState();
    expect(state.status).toBe('error');
    expect(state.error).toContain('ENOENT');
  });

  it('rejects a second update while one is in progress', async () => {
    const gate = deferred<void>();
    const install = vi.fn().mockReturnValue(gate.promise);
    const svc = createUpdateService({
      currentVersion: '0.3.8',
      canSelfUpdate: true,
      installFn: install,
      restartFn: vi.fn(),
    });

    const first = svc.startUpdate('0.4.0');
    expect(first.ok).toBe(true);
    const second = svc.startUpdate('0.4.0');
    expect(second).toEqual({ ok: false, reason: 'in-progress' });

    gate.resolve();
    await flush();
    expect(install).toHaveBeenCalledOnce();
  });
});

describe('detectSelfUpdatable', () => {
  it('is false for the monorepo (dev) — name is not @openaidy/app', () => {
    // Walking up from this test file lands on the repo-root package.json,
    // whose name is "openaidy", not the published "@openaidy/app".
    expect(detectSelfUpdatable('@openaidy/app')).toBe(false);
  });
});

describe('defaultInstall / defaultRestart (real spawn wiring)', () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  it('passes the version as a single argv element, never shell-concatenated', async () => {
    const child = fakeChild();
    spawnMock.mockReturnValue(child);

    const install = defaultInstall('@openaidy/app', '1.2.3');
    const [cmd, args, opts] = spawnMock.mock.calls[0]!;
    expect(cmd).toBe('npm');
    // The version reaches spawn as one argv element — no shell string is built
    // out of it, so it can't be split into extra shell tokens even if malformed.
    expect(args).toEqual(['install', '-g', '@openaidy/app@1.2.3']);
    expect((opts as { shell?: boolean }).shell).toBe(false);

    child.emit('exit', 0);
    await expect(install).resolves.toBeUndefined();
  });

  it('defaultInstall rejects (not throws) on a spawn error event', async () => {
    const child = fakeChild();
    spawnMock.mockReturnValue(child);

    const install = defaultInstall('@openaidy/app', '1.2.3');
    child.emit('error', new Error('ENOENT'));
    await expect(install).rejects.toThrow('ENOENT');
  });

  it('defaultRestart does not throw when the spawned process errors', () => {
    const child = fakeChild();
    spawnMock.mockReturnValue(child);

    // Before the fix, an unhandled 'error' event on a fire-and-forget spawn
    // crashes the process with an uncaught exception — assert it no longer does.
    expect(() => defaultRestart()).not.toThrow();
    expect(() => child.emit('error', new Error('ENOENT'))).not.toThrow();
    expect(child.unref).toHaveBeenCalled();
  });
});
