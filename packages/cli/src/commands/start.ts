/**
 * openaidy start — Start the OpenAidy server and web frontend (PR2 T2.2)
 *
 * Behavior (per spec R-7):
 *  1. Resolve the listen port (--port flag > OPENAIDY_PORT env > 3001)
 *  2. Resolve apps/server/dist/server.js from OPENAIDY_REPO
 *  3. Spawn detached child with OPENAIDY_PORT propagated to its env
 *  4. Write PID JSON envelope to $OPENAIDY_HOME/state/server.pid
 *  5. Poll GET http://localhost:<port>/health every 500ms (max 30s)
 *  6. Install SIGINT/SIGTERM trap that forwards to child
 *  7. Print "Server running on http://localhost:<port>"
 *  8. Unless --server-only: spawn Vite dev server for apps/web
 *     and write $OPENAIDY_HOME/state/web.pid
 *
 * With --integrated: build the web bundle first, then start only the
 * server. The server reads OPENAIDY_WEB_DIST and serves the built bundle
 * itself (same-origin). This is the recommended production mode.
 *
 * Design per R-D2: process spawning tested on Unix/macOS only.
 * Windows covered by scripts/smoke-install.ps1 (manual).
 * Uses createCLIError / formatCLIError from errors.ts (CC-3).
 * Returns CommandResult per types.ts contract.
 */

import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { unlink } from 'node:fs/promises';
import { request } from 'node:http';
import type { CommandResult } from '../types.js';
import { writePidFile, writeWebPidFile } from '../lib/process-manager.js';
import { DEFAULT_SERVER_PORT } from '@openaidy/config';

// ============================================================================
// Constants
// ============================================================================

const HEALTH_POLL_MS = 500;
const HEALTH_MAX_POLLS = 60; // 30 seconds
const WEB_DEFAULT_URL = 'http://localhost:5173';
const WEB_READY_POLL_MS = 500;
const WEB_READY_MAX_POLLS = 30; // 15 seconds

const HELP_TEXT = `
Usage: openaidy start [options]

Start the OpenAidy server and web frontend as background processes.

The server binds to a port resolved in this order:
  1. --port <N> flag (highest priority)
  2. OPENAIDY_PORT environment variable
  3. Default: ${DEFAULT_SERVER_PORT}

The WebSocket gateway rides on the same port (same-origin architecture).

Automatically:
  - Spawns the server as a detached child on the resolved port
  - Polls /health until ready
  - Spawns the web frontend (Vite) unless --server-only or --integrated
  - Installs signal handlers for graceful shutdown

Options:
  -h, --help          Show this help message
  --port <N>          Listen port (default: ${DEFAULT_SERVER_PORT};
                      env OPENAIDY_PORT wins if set)
  --server-only       Start only the server, skip the web frontend
  --integrated        Build the web bundle first and have the server
                      serve it directly (same-origin). The Vite dev
                      server is NOT spawned. Requires pnpm.

Exit Codes:
  0  Server started and healthy (and web started unless --server-only)
  1  --port or OPENAIDY_PORT invalid, server entry missing, web build
     failed (--integrated), or health check timed out
`;

// ============================================================================
// Port resolution
// ============================================================================

/**
 * Resolve the listen port from CLI args and env.
 *
 * Precedence: --port flag > OPENAIDY_PORT env > DEFAULT_SERVER_PORT.
 * Exported for testing.
 */
export function resolveStartPort(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): { ok: true; port: number } | { ok: false; error: string } {
  const portIdx = args.indexOf('--port');
  if (portIdx !== -1) {
    const portVal = args[portIdx + 1];
    const parsed = Number(portVal);
    if (
      portVal === undefined ||
      !Number.isInteger(parsed) ||
      parsed <= 0 ||
      parsed > 65535
    ) {
      return {
        ok: false,
        error: `Error: --port must be a positive integer (1-65535). Got "${portVal ?? ''}".`,
      };
    }
    return { ok: true, port: parsed };
  }
  if (env.OPENAIDY_PORT) {
    const parsed = Number(env.OPENAIDY_PORT);
    if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
      return {
        ok: false,
        error: `Error: OPENAIDY_PORT must be a positive integer (1-65535). Got "${env.OPENAIDY_PORT}".`,
      };
    }
    return { ok: true, port: parsed };
  }
  return { ok: true, port: DEFAULT_SERVER_PORT };
}

// ============================================================================
// Health check
// ============================================================================

/**
 * Poll GET /health until the server responds with 200.
 * Resolves true on success, false on timeout.
 */
function pollHealth(port: number, maxPolls: number): Promise<boolean> {
  return new Promise((resolve) => {
    let attempts = 0;

    const poll = () => {
      attempts++;
      const req = request(
        `http://127.0.0.1:${port}/health`,
        { method: 'GET', timeout: 2000 },
        (res) => {
          if (res.statusCode === 200) {
            resolve(true);
          } else if (attempts >= maxPolls) {
            resolve(false);
          } else {
            setTimeout(poll, HEALTH_POLL_MS);
          }
        },
      );

      req.on('error', () => {
        if (attempts >= maxPolls) {
          resolve(false);
        } else {
          setTimeout(poll, HEALTH_POLL_MS);
        }
      });

      req.end();
    };

    poll();
  });
}

// ============================================================================
// Handler
// ============================================================================

export async function startHandler(args: string[]): Promise<CommandResult> {
  // Help flag
  if (args.includes('--help') || args.includes('-h')) {
    return { exitCode: 0, output: HELP_TEXT.trim() };
  }

  // --server-only: skip web frontend
  const serverOnly = args.includes('--server-only');

  // --integrated: build the web bundle and have the server serve it
  // directly (same-origin). Implies --server-only (Vite is not spawned).
  const integrated = args.includes('--integrated');
  if (serverOnly && integrated) {
    return {
      exitCode: 1,
      output: 'Error: --server-only and --integrated are mutually exclusive.',
    };
  }

  // Resolve OPENAIDY_HOME
  const openaidyHome = process.env.OPENAIDY_HOME;
  if (!openaidyHome) {
    return {
      exitCode: 1,
      output:
        'Error: OPENAIDY_HOME is not set. Run from the install directory or set OPENAIDY_HOME.',
    };
  }

  // Resolve server entry point (source .ts — tsx handles ESM resolution).
  // OPENAIDY_REPO points at the cloned repo (code root). When unset — e.g. an
  // older Windows wrapper that only exported OPENAIDY_HOME — fall back to
  // OPENAIDY_HOME so existing installs keep working.
  const repoRoot = process.env.OPENAIDY_REPO ?? openaidyHome;
  const serverEntry = resolve(repoRoot, 'apps/server/src/server.ts');
  try {
    await import('node:fs/promises').then((fs) => fs.access(serverEntry));
  } catch {
    return {
      exitCode: 1,
      output: `Error: Server entry not found at ${serverEntry}. Has the repo been cloned and built?`,
    };
  }

  // Use node --import tsx to enable ESM extensionless resolution
  // This is more reliable cross-platform than spawning tsx directly
  const nodeBin = process.execPath;

  // Resolve the listen port. CLI flag wins, then env, then default. We
  // never probe a free port — the user declares the port so the server
  // and the web client agree on the same origin.
  const portResult = resolveStartPort(args, process.env);
  if (!portResult.ok) {
    return { exitCode: 1, output: portResult.error };
  }
  const port = portResult.port;

  // Ensure state directory and build paths
  const stateDir = resolve(openaidyHome, 'state');
  const logFile = resolve(openaidyHome, 'logs', 'server.log');
  const pidFilePath = resolve(stateDir, 'server.pid');

  // Ensure log directory exists
  await import('node:fs/promises').then((fs) =>
    fs.mkdir(resolve(openaidyHome, 'logs'), { recursive: true }),
  );

  // ==========================================================================
  // --integrated: build web bundle before spawning server
  // ==========================================================================
  //
  // In integrated mode the server serves the built web bundle directly via
  // @fastify/static. We must produce apps/web/dist before starting the
  // server, otherwise the server will refuse to start (missing index.html).
  // Build synchronously so a failure aborts startup with a clear error
  // before we leave a half-running server behind.
  let webDistPath: string | undefined;
  if (integrated) {
    webDistPath = resolve(repoRoot, 'apps', 'web', 'dist');
    const buildResult = spawnSync('pnpm', ['--filter', 'web', 'build'], {
      cwd: repoRoot,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: {
        ...process.env,
        OPENAIDY_HOME: openaidyHome,
        OPENAIDY_REPO: repoRoot,
      },
    });
    if (buildResult.error) {
      return {
        exitCode: 1,
        output:
          `Error: failed to spawn \`pnpm --filter web build\`: ${buildResult.error.message}. ` +
          'Is pnpm installed and on PATH?',
      };
    }
    if (buildResult.status !== 0) {
      return {
        exitCode: 1,
        output:
          `Error: web bundle build failed (exit ${buildResult.status ?? 'unknown'}). ` +
          'Fix the build errors above and retry. The server was NOT started.',
      };
    }
  }

  // Spawn detached child via node --import tsx (handles ESM + extensionless imports).
  // Pass OPENAIDY_PORT through explicitly so the server's zod env schema finds it.
  // Also pass WS_PORT = OPENAIDY_PORT so the websocket gateway's separate
  // env schema (apps/server/src/websocket/types.ts wsEnvSchema) reads the
  // same value; the gateway shares the HTTP listener in this architecture.
  // In --integrated mode, also pass OPENAIDY_WEB_DIST so the server's
  // static plugin can locate the bundle we just built.
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    OPENAIDY_PORT: String(port),
    PORT: String(port),
    WS_PORT: String(port),
    OPENAIDY_HOME: openaidyHome,
  };
  if (webDistPath) {
    childEnv['OPENAIDY_WEB_DIST'] = webDistPath;
  }
  const child = spawn(nodeBin, ['--import', 'tsx', serverEntry], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
    env: childEnv,
  });

  // Capture stdout/stderr to log file
  const logStream = await import('node:fs').then((fs) =>
    fs.createWriteStream(logFile, { flags: 'a' }),
  );
  if (child.stdout) child.stdout.pipe(logStream);
  if (child.stderr) child.stderr.pipe(logStream);

  // Write PID file
  const rec = {
    pid: child.pid!,
    startedAt: new Date().toISOString(),
    port,
    logFile,
  };
  await writePidFile(pidFilePath, rec);

  // Unref the child so it can outlive the CLI process
  child.unref();

  // Install signal handlers for graceful shutdown
  const cleanup = () => {
    try {
      process.kill(child.pid!, 'SIGTERM');
    } catch {
      /* ignore */
    }
    unlink(pidFilePath).catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  // Poll /health
  const healthy = await pollHealth(port, HEALTH_MAX_POLLS);

  if (!healthy) {
    return {
      exitCode: 1,
      output: `Error: Server started but /health did not respond within 30 seconds. Check ${logFile} for errors.`,
    };
  }

  // ==========================================================================
  // Web frontend
  // ==========================================================================
  //
  // In --integrated mode the server serves the built web bundle itself, so
  // there's no separate Vite process to start. Otherwise (the default),
  // spawn a Vite dev server unless --server-only was passed.

  if (integrated) {
    return {
      exitCode: 0,
      output: [
        '',
        'Server running on http://localhost:' + port,
        '  PID:  ' + child.pid,
        '  Log:  ' + logFile,
        '  Web:  served from ' + webDistPath,
        '',
        'Open http://localhost:' + port + ' in your browser to get started.',
        'Use "openaidy stop" to stop the server.',
        '',
      ].join('\n'),
    };
  }

  const webInfo = serverOnly ? null : await startWeb(repoRoot, openaidyHome);

  if (serverOnly) {
    return {
      exitCode: 0,
      output: [
        '',
        'Server running on http://localhost:' + port,
        '',
        '  PID:  ' + child.pid,
        '  Log:  ' + logFile,
        '',
        'Open http://localhost:' + port + ' in your browser to get started.',
        'Use "openaidy stop" to stop the server.',
        'Pass --server-only=false (or omit the flag) to also start the web frontend.',
        'Pass --integrated to have the server serve the built web bundle itself.',
        '',
      ].join('\n'),
    };
  }

  if (!webInfo) {
    // Web failed to start — server is up, surface the failure but don't
    // tear down the server. The user can still hit the API + WS.
    return {
      exitCode: 1,
      output: [
        '',
        'Server running on http://localhost:' + port,
        '  PID:  ' + child.pid,
        '  Log:  ' + logFile,
        '',
        'Warning: Web frontend failed to start. Check apps/web/ exists',
        'and pnpm is installed. The server is still running.',
        '',
      ].join('\n'),
    };
  }

  return {
    exitCode: 0,
    output: [
      '',
      'Server running on http://localhost:' + port,
      '  PID:  ' + child.pid,
      '  Log:  ' + logFile,
      '',
      'Web running on    ' + webInfo.url,
      '  PID:  ' + webInfo.pid,
      '  Log:  ' + webInfo.logFile,
      '',
      'Open ' + webInfo.url + ' in your browser to get started.',
      'Use "openaidy stop" to stop both server and web.',
      'Use "openaidy stop --server-only" to stop only the server.',
      '',
    ].join('\n'),
  };
}

// ============================================================================
// Web frontend (Vite dev server)
// ============================================================================

/**
 * Start the Vite dev server for apps/web as a detached child process.
 * Writes the PID to $OPENAIDY_HOME/state/web.pid so `openaidy stop` can
 * terminate it. Polls the web URL until it responds 200 (max ~15s) so
 * we don't return success while Vite is still bundling.
 *
 * Returns the web PID record on success, null on failure.
 */
async function startWeb(
  repoRoot: string,
  openaidyHome: string,
): Promise<{
  pid: number;
  url: string;
  logFile: string;
} | null> {
  const webDir = resolve(repoRoot, 'apps/web');
  // Verify the web app exists
  try {
    await import('node:fs/promises').then((fs) =>
      fs.access(resolve(webDir, 'package.json')),
    );
  } catch {
    return null;
  }

  // Ensure logs dir exists (server already created it, but be safe).
  const logsDir = resolve(openaidyHome, 'logs');
  await import('node:fs/promises').then((fs) =>
    fs.mkdir(logsDir, { recursive: true }),
  );
  const webLogFile = resolve(logsDir, 'web.log');
  const webPidPath = resolve(openaidyHome, 'state', 'web.pid');

  // Spawn Vite detached. Use `pnpm dev` so the dev script from
  // apps/web/package.json runs unchanged. Propagate OPENAIDY_PORT so
  // vite.config.ts can configure the dev proxy without requiring the
  // user to set it in a .env file.
  const child = spawn('pnpm', ['dev'], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
    cwd: webDir,
    env: {
      ...process.env,
      OPENAIDY_HOME: openaidyHome,
      OPENAIDY_REPO: repoRoot,
      OPENAIDY_PORT: String(port),
    },
  });

  // Pipe web output to its own log file.
  const webLogStream = await import('node:fs').then((fs) =>
    fs.createWriteStream(webLogFile, { flags: 'a' }),
  );
  if (child.stdout) child.stdout.pipe(webLogStream);
  if (child.stderr) child.stderr.pipe(webLogStream);

  child.unref();

  // Wait for Vite to bind to its port by polling the URL.
  const ready = await pollWebReady(WEB_DEFAULT_URL, WEB_READY_MAX_POLLS);
  if (!ready) {
    // Vite didn't come up — kill the process and clean up the PID file.
    try {
      process.kill(child.pid!, 'SIGTERM');
    } catch {
      /* ignore */
    }
    return null;
  }

  const rec = {
    pid: child.pid!,
    startedAt: new Date().toISOString(),
    url: WEB_DEFAULT_URL,
    logFile: webLogFile,
  };
  await writeWebPidFile(webPidPath, rec);

  return rec;
}

/**
 * Poll a URL until it responds 200. Resolves true on success, false on timeout.
 */
function pollWebReady(url: string, maxPolls: number): Promise<boolean> {
  return new Promise((resolve) => {
    let attempts = 0;
    const parsed = new URL(url);

    const poll = () => {
      attempts++;
      const req = request(
        {
          hostname: parsed.hostname,
          port: parsed.port,
          path: parsed.pathname,
          method: 'GET',
          timeout: 2000,
        },
        (res) => {
          // Vite serves 200 on / even when bundling; any HTTP response means it's up.
          if (res.statusCode && res.statusCode < 500) {
            resolve(true);
          } else if (attempts >= maxPolls) {
            resolve(false);
          } else {
            setTimeout(poll, WEB_READY_POLL_MS);
          }
        },
      );

      req.on('error', () => {
        if (attempts >= maxPolls) {
          resolve(false);
        } else {
          setTimeout(poll, WEB_READY_POLL_MS);
        }
      });

      req.end();
    };

    poll();
  });
}
