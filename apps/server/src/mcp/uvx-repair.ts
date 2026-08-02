/**
 * Repair for a broken `uvx` MCP server environment.
 *
 * A `uvx <package>` server re-resolves its Python dependencies on every launch
 * and caches the result per machine. A package whose requirement is unbounded
 * (`mcp[cli]>=1.6.0`) therefore behaves differently depending on *when* the
 * environment was first resolved: once an upstream dependency ships a breaking
 * major, every environment resolved after that date dies at import time, while
 * environments resolved earlier keep working indefinitely. The user's config is
 * identical in both cases, which is what makes this so hard to diagnose — the
 * MCP client only ever sees `Connection closed`.
 *
 * The repair is to stop resolving afresh: provision a *persistent* uv tool
 * environment resolved as of the day the server package itself was published
 * (`uv tool install --exclude-newer`), which is the dependency set its author
 * released against. `uvx` then reuses that environment on every later launch.
 *
 * Deliberately nothing about the server config changes. `command` and `args`
 * stay exactly as the vendor documents them — no pins, no resolver flags, no
 * extra fields for the user to know about.
 */

import { spawn } from 'node:child_process';
import type { FastifyBaseLogger } from 'fastify';

/** Runs a command; resolves with its outcome rather than throwing. */
export type CommandRunner = (
  command: string,
  args: string[],
) => Promise<{ ok: boolean; stderr: string }>;

/** Looks up the publication date (ISO 8601) of a package's latest release. */
export type ReleaseDateLookup = (packageName: string) => Promise<string | null>;

/**
 * Attempts to repair the environment of one server. Resolves true when the
 * environment was rebuilt and a retry is worth attempting.
 */
export type UvxEnvironmentRepairer = (input: {
  serverId: string;
  command: string;
  args: string[];
  stderr: string;
}) => Promise<boolean>;

/**
 * The package a `uvx` invocation runs, or null when this isn't one.
 *
 * Accepts `uvx` under any path or extension (`/usr/local/bin/uvx`, `uvx.exe`)
 * and skips leading option flags, so `uvx --python 3.12 pkg` resolves to `pkg`.
 * A flag's value is indistinguishable from a package name without knowing
 * every uv option, so a config that passes flags before the package is left
 * alone rather than guessed at.
 */
export function parseUvxPackage(
  command: string,
  args: readonly string[],
): string | null {
  const base = command
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    ?.replace(/\.(exe|cmd|bat)$/i, '');
  if (base !== 'uvx') return null;

  const first = args[0];
  if (first === undefined || first.startsWith('-')) return null;

  // Strip any version specifier: `pkg==1.2.3`, `pkg@latest`, `pkg[extra]`.
  const name = first.split(/[=<>!~@[]/)[0]?.trim();
  return name && name.length > 0 ? name : null;
}

/**
 * Whether a failed launch looks like a broken dependency set rather than a
 * misconfigured server.
 *
 * A Python import error at module scope means the code and its installed
 * dependencies disagree — exactly what a drifted resolution produces. A missing
 * API key or a bad argument produces different output and must not trigger a
 * reinstall.
 */
export function looksLikeBrokenEnvironment(stderr: string): boolean {
  return (
    /ModuleNotFoundError\b/.test(stderr) ||
    /\bImportError\b/.test(stderr) ||
    /cannot import name\b/.test(stderr)
  );
}

/**
 * `--exclude-newer` bound for a release published at `isoDate`: the following
 * day, so the release itself stays available (uv compares against the whole
 * timestamp, and a package published later in the day would otherwise be
 * excluded by its own date).
 */
export function exclusiveUpperBound(isoDate: string): string | null {
  const published = new Date(isoDate);
  if (Number.isNaN(published.getTime())) return null;
  published.setUTCDate(published.getUTCDate() + 1);
  return published.toISOString().slice(0, 10);
}

/**
 * Read the latest release date of a package from the PyPI JSON API.
 *
 * Only reached on the repair path, so a slow or unreachable index costs a
 * failed connection its timeout and nothing else.
 */
export function createPypiReleaseDateLookup(
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 5000,
): ReleaseDateLookup {
  return async (packageName) => {
    try {
      const response = await fetchImpl(
        `https://pypi.org/pypi/${encodeURIComponent(packageName)}/json`,
        { signal: AbortSignal.timeout(timeoutMs) },
      );
      if (!response.ok) return null;
      const body = (await response.json()) as {
        urls?: Array<{ upload_time_iso_8601?: string }>;
      };
      for (const file of body.urls ?? []) {
        if (file.upload_time_iso_8601) return file.upload_time_iso_8601;
      }
      return null;
    } catch {
      return null;
    }
  };
}

/**
 * Default {@link CommandRunner}: spawns the command and collects its stderr.
 * `shell: false` so nothing in the argument list is interpreted by a shell.
 */
export function createProcessRunner(timeoutMs = 300_000): CommandRunner {
  return (command, args) =>
    new Promise((resolve) => {
      const child = spawn(command, args, { shell: false, windowsHide: true });
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill();
        resolve({ ok: false, stderr: `${command} timed out` });
      }, timeoutMs);
      timer.unref?.();

      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({ ok: false, stderr: err.message });
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ ok: code === 0, stderr });
      });
    });
}

export type UvxRepairerOptions = {
  logger?: FastifyBaseLogger | undefined;
  run: CommandRunner;
  lookupReleaseDate: ReleaseDateLookup;
};

/**
 * Build the repairer used by {@link McpClientService}.
 *
 * Returns false — leaving the original connection error to be reported — when
 * the server isn't a `uvx` one, when the failure doesn't look like a broken
 * dependency set, when the release date can't be determined, or when the
 * reinstall itself fails. Every one of those paths is logged, because a silent
 * repair attempt is worse than none.
 */
export function createUvxEnvironmentRepairer(
  options: UvxRepairerOptions,
): UvxEnvironmentRepairer {
  const { logger, run, lookupReleaseDate } = options;

  return async ({ serverId, command, args, stderr }) => {
    const packageName = parseUvxPackage(command, args);
    if (!packageName) return false;
    if (!looksLikeBrokenEnvironment(stderr)) return false;

    const releasedAt = await lookupReleaseDate(packageName);
    if (!releasedAt) {
      logger?.warn(
        { serverId, packageName },
        'Cannot repair MCP server environment: release date unavailable',
      );
      return false;
    }

    const excludeNewer = exclusiveUpperBound(releasedAt);
    if (!excludeNewer) {
      logger?.warn(
        { serverId, packageName, releasedAt },
        'Cannot repair MCP server environment: unparseable release date',
      );
      return false;
    }

    logger?.info(
      { serverId, packageName, excludeNewer },
      'Rebuilding MCP server environment with dependencies as of its release',
    );

    // `--force` because this path only runs when the environment is already
    // known broken: without it uv reports "already installed" for a tool whose
    // requirement set is unchanged and rebuilds nothing.
    const result = await run('uv', [
      'tool',
      'install',
      '--force',
      '--exclude-newer',
      excludeNewer,
      packageName,
    ]);

    if (!result.ok) {
      logger?.warn(
        { serverId, packageName, error: result.stderr },
        'Failed to rebuild MCP server environment',
      );
      return false;
    }

    logger?.info(
      { serverId, packageName },
      'MCP server environment rebuilt; retrying connection',
    );
    return true;
  };
}
