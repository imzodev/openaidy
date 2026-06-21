/**
 * openaidy start — Start the OpenAidy server (PR2 T2.2)
 *
 * Behavior (per spec R-7):
 *  1. Probe free port in 3000–3009 range
 *  2. Resolve apps/server/dist/server.js from OPENAIDY_HOME
 *  3. Spawn detached child with chosen PORT
 *  4. Write PID JSON envelope to $OPENAIDY_HOME/state/server.pid
 *  5. Poll GET http://localhost:<port>/health every 500ms (max 30s)
 *  6. Install SIGINT/SIGTERM trap that forwards to child
 *  7. Print "Server running on http://localhost:<port>"
 *
 * Design per R-D2: process spawning tested on Unix/macOS only.
 * Windows covered by scripts/smoke-install.ps1 (manual).
 * Uses createCLIError / formatCLIError from errors.ts (CC-3).
 * Returns CommandResult per types.ts contract.
 */

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { unlink } from 'node:fs/promises';
import { request } from 'node:http';
import type { CommandResult } from '../types.js';
import { probeFreePort, writePidFile } from '../lib/process-manager.js';

// ============================================================================
// Constants
// ============================================================================

const PORT_START = 3000;
const PORT_TRIES = 10;
const HEALTH_POLL_MS = 500;
const HEALTH_MAX_POLLS = 60; // 30 seconds

const HELP_TEXT = `
Usage: openaidy start [options]

Start the OpenAidy server as a background process.

Automatically:
  - Finds a free port (3000–3009)
  - Spawns the server as a detached child
  - Polls /health until ready
  - Installs signal handlers for graceful shutdown

Options:
  -h, --help          Show this help message

Exit Codes:
  0  Server started and healthy
  1  Port range exhausted, server entry missing, or health check timed out
`;

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

  // Probe free port
  let port: number;
  try {
    port = await probeFreePort(PORT_START, PORT_TRIES);
  } catch {
    return {
      exitCode: 1,
      output: `Error: No free port found in range ${PORT_START}-${PORT_START + PORT_TRIES - 1}. Stop any existing server or specify a different port range.`,
    };
  }

  // Ensure state directory and build paths
  const stateDir = resolve(openaidyHome, 'state');
  const logFile = resolve(openaidyHome, 'logs', 'server.log');
  const pidFilePath = resolve(stateDir, 'server.pid');

  // Ensure log directory exists
  await import('node:fs/promises').then((fs) =>
    fs.mkdir(resolve(openaidyHome, 'logs'), { recursive: true }),
  );

  // Spawn detached child via node --import tsx (handles ESM + extensionless imports)
  const child = spawn(nodeBin, ['--import', 'tsx', serverEntry], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      PORT: String(port),
      OPENAIDY_HOME: openaidyHome,
    },
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
      '',
    ].join('\n'),
  };
}
