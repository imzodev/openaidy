/**
 * Self-update service (issue #456).
 *
 * Responsibilities:
 *  - `check()`   — ask the npm registry for the latest published version and
 *                  compare it with the running version.
 *  - `startUpdate()` — for a packaged global install only: run
 *                  `npm install -g @openaidy/app@latest`, then hand off to a
 *                  detached `openaidy restart` so the new bytes are loaded by a
 *                  fresh process. Progress is tracked in-memory and surfaced
 *                  via `getState()`.
 *
 * The dangerous side effects (spawning npm, spawning the CLI) are injected as
 * `installFn` / `restartFn` so tests exercise the state machine without ever
 * touching the real system. `fetchFn` is likewise injectable for the registry.
 */

import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import semver from 'semver';
import type { UpdateCheckResult, UpdateState } from '@openaidy/shared-types';
import { createLogger } from '../lib/logger';

const logger = createLogger('update');

/** Published package name (see scripts/build-npm-package.mjs). */
export const DEFAULT_PACKAGE_NAME = '@openaidy/app';
const DEFAULT_REGISTRY = 'https://registry.npmjs.org';
const DEFAULT_GITHUB_REPO = 'imzodev/openaidy';
/** Cap release notes so a huge changelog can't bloat the check response. */
const RELEASE_NOTES_MAX = 1000;

type FetchFn = typeof fetch;
/** Runs the install; must reject if the install fails. */
export type InstallFn = (packageName: string, version: string) => Promise<void>;
/** Hands off to a fresh process; the current process is expected to go down. */
export type RestartFn = () => void;

export interface UpdateServiceOptions {
  /** Currently-running version (semver, no `v` prefix). */
  currentVersion: string;
  packageName?: string;
  registryUrl?: string;
  /** `owner/repo` used for best-effort release-notes lookup. */
  githubRepo?: string;
  /**
   * Whether this deployment can self-update. Defaults to auto-detection
   * (true only for a packaged `@openaidy/app` global install).
   */
  canSelfUpdate?: boolean;
  fetchFn?: FetchFn;
  installFn?: InstallFn;
  restartFn?: RestartFn;
}

/**
 * Walk up from a starting directory to the nearest package.json and report
 * whether it is the published `@openaidy/app` package. A from-source / dev run
 * resolves to the monorepo root (name `openaidy`), which cannot self-update.
 */
export function detectSelfUpdatable(
  packageName: string,
  startDir?: string,
): boolean {
  const here = startDir ?? dirname(fileURLToPath(import.meta.url));
  for (let dir = here; dirname(dir) !== dir; dir = dirname(dir)) {
    const candidate = resolve(dir, 'package.json');
    if (!existsSync(candidate)) continue;
    try {
      const pkg = JSON.parse(readFileSync(candidate, 'utf-8')) as {
        name?: unknown;
      };
      if (typeof pkg.name === 'string' && pkg.name) {
        return pkg.name === packageName;
      }
    } catch {
      // malformed package.json — keep walking
    }
  }
  return false;
}

/** Default install: `npm install -g <pkg>@<version>`, rejecting on non-zero exit. */
export const defaultInstall: InstallFn = (packageName, version) =>
  new Promise<void>((resolvePromise, reject) => {
    const child = spawn('npm', ['install', '-g', `${packageName}@${version}`], {
      stdio: 'ignore',
      shell: process.platform === 'win32',
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`npm install exited with code ${code ?? 'null'}`));
    });
  });

/** Default restart: detached `openaidy restart` that outlives this process. */
export const defaultRestart: RestartFn = () => {
  const child = spawn('openaidy', ['restart'], {
    detached: true,
    stdio: 'ignore',
    shell: process.platform === 'win32',
  });
  // spawn() errors (e.g. ENOENT if `openaidy` isn't on PATH) arrive as an async
  // 'error' event; without a listener Node throws an uncaught exception that
  // would crash this process right after it committed to restarting.
  child.on('error', (err) => {
    logger.error('Failed to spawn restart process', { error: err.message });
  });
  child.unref();
};

export class UpdateService {
  private readonly currentVersion: string;
  private readonly packageName: string;
  private readonly registryUrl: string;
  private readonly githubRepo: string;
  private readonly canSelfUpdate: boolean;
  private readonly fetchFn: FetchFn;
  private readonly installFn: InstallFn;
  private readonly restartFn: RestartFn;

  private state: UpdateState = { status: 'idle' };

  constructor(opts: UpdateServiceOptions) {
    this.currentVersion = opts.currentVersion;
    this.packageName = opts.packageName ?? DEFAULT_PACKAGE_NAME;
    this.registryUrl = opts.registryUrl ?? DEFAULT_REGISTRY;
    this.githubRepo = opts.githubRepo ?? DEFAULT_GITHUB_REPO;
    this.canSelfUpdate =
      opts.canSelfUpdate ?? detectSelfUpdatable(this.packageName);
    // Defer to the global `fetch` at call time (not construction time) so a
    // test that spies on `globalThis.fetch` after the service is built is still
    // honoured.
    this.fetchFn =
      opts.fetchFn ?? ((input, init) => fetch(input, init as RequestInit));
    this.installFn = opts.installFn ?? defaultInstall;
    this.restartFn = opts.restartFn ?? defaultRestart;
  }

  getState(): UpdateState {
    return { ...this.state };
  }

  /**
   * Query the npm registry for the latest version and compare it with the
   * running one. Throws on a network/registry failure so the route can map it
   * to a 502 ("Unable to check for updates").
   */
  async check(): Promise<UpdateCheckResult> {
    const url = `${this.registryUrl}/${encodeURIComponent(this.packageName)}/latest`;
    const response = await this.fetchFn(url);
    if (!response.ok) {
      throw new Error(
        `npm registry responded ${response.status} ${response.statusText}`,
      );
    }
    const body = (await response.json()) as { version?: unknown };
    const latestVersion =
      typeof body.version === 'string' ? body.version : undefined;
    if (!latestVersion || !semver.valid(latestVersion)) {
      throw new Error('npm registry returned no valid version');
    }

    const updateAvailable =
      semver.valid(this.currentVersion) != null &&
      semver.gt(latestVersion, this.currentVersion);

    const result: UpdateCheckResult = {
      currentVersion: this.currentVersion,
      latestVersion,
      updateAvailable,
      canSelfUpdate: this.canSelfUpdate,
    };

    if (updateAvailable) {
      const releaseNotes = await this.fetchReleaseNotes(latestVersion);
      if (releaseNotes) result.releaseNotes = releaseNotes;
    }

    return result;
  }

  /** Best-effort release-notes body from the GitHub release for `v<version>`. */
  private async fetchReleaseNotes(
    version: string,
  ): Promise<string | undefined> {
    try {
      const url = `https://api.github.com/repos/${this.githubRepo}/releases/tags/v${version}`;
      const response = await this.fetchFn(url, {
        headers: { Accept: 'application/vnd.github+json' },
      });
      if (!response.ok) return undefined;
      const body = (await response.json()) as { body?: unknown };
      if (typeof body.body !== 'string' || !body.body.trim()) return undefined;
      const notes = body.body.trim();
      return notes.length > RELEASE_NOTES_MAX
        ? `${notes.slice(0, RELEASE_NOTES_MAX)}…`
        : notes;
    } catch {
      return undefined;
    }
  }

  /**
   * Trigger a self-update. Returns a discriminated result the route maps to an
   * HTTP status:
   *  - `not-supported` → 409 (dev / from-source install can't self-update)
   *  - `in-progress`   → 409 (an update is already running)
   *  - `ok`            → 202 (install kicked off; server will restart)
   *
   * The install + restart run in the background so the request returns before
   * the process goes down.
   */
  startUpdate(
    targetVersion: string,
  ):
    | { ok: true; state: UpdateState }
    | { ok: false; reason: 'not-supported' | 'in-progress' } {
    if (!this.canSelfUpdate) {
      return { ok: false, reason: 'not-supported' };
    }
    if (
      this.state.status === 'installing' ||
      this.state.status === 'restarting'
    ) {
      return { ok: false, reason: 'in-progress' };
    }

    this.state = {
      status: 'installing',
      newVersion: targetVersion,
      message: `Installing ${this.packageName}@${targetVersion}…`,
    };

    // Fire-and-forget: the endpoint responds immediately; the client observes
    // completion by the server restarting on the new version.
    void this.runUpdate(targetVersion);

    return { ok: true, state: this.getState() };
  }

  private async runUpdate(targetVersion: string): Promise<void> {
    logger.info('Starting self-update', {
      from: this.currentVersion,
      to: targetVersion,
    });
    try {
      await this.installFn(this.packageName, targetVersion);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('Self-update install failed', { error: message });
      this.state = {
        status: 'error',
        newVersion: targetVersion,
        error: message,
        message: 'Update failed; the server is still running the old version.',
      };
      return;
    }

    logger.info('Install complete; handing off to restart', {
      version: targetVersion,
    });
    this.state = {
      status: 'restarting',
      newVersion: targetVersion,
      message: 'Update installed; restarting the server…',
    };
    try {
      this.restartFn();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('Self-update restart hand-off failed', { error: message });
      this.state = {
        status: 'error',
        newVersion: targetVersion,
        error: message,
        message:
          'Update installed but the restart failed. Restart the server manually.',
      };
    }
  }
}

export function createUpdateService(opts: UpdateServiceOptions): UpdateService {
  return new UpdateService(opts);
}
