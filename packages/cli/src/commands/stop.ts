/**
 * openaidy stop — Stop the OpenAidy server and web frontend (PR2 T2.3)
 *
 * Behavior (per spec R-8):
 *  1. Read PID JSON from $OPENAIDY_HOME/state/server.pid
 *  2. If process is dead, remove stale PID file, report cleanup
 *  3. If alive, send SIGTERM (Unix) or taskkill (Windows)
 *  4. Poll every 500ms for up to 10s for process exit
 *  5. SIGKILL escalation if process doesn't stop
 *  6. Remove PID file on success
 *  7. Also stops the web frontend (Vite) unless --server-only
 *
 * Uses createCLIError / formatCLIError from errors.ts (CC-3).
 * Returns CommandResult per types.ts contract.
 */

import { execFile } from 'node:child_process';
import { unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import type { CommandResult } from '../types.js';
import {
  readPidFile,
  readWebPidFile,
  isProcessAlive,
} from '../lib/process-manager.js';

// ============================================================================
// Constants
// ============================================================================

const STOP_POLL_MS = 500;
const STOP_MAX_POLLS = 20; // 10 seconds

const HELP_TEXT = `
Usage: openaidy stop [options]

Stop the OpenAidy server and web frontend.

Gracefully shuts down processes by:
  - Reading PID files
  - Sending SIGTERM (Unix) or taskkill (Windows)
  - Waiting up to 10 seconds for clean shutdown
  - Escalating to SIGKILL if needed

Options:
  -h, --help          Show this help message
  --server-only       Stop only the server, leave the web frontend running

Exit Codes:
  0  Processes stopped or were not running
  1  Failed to stop
`;

// ============================================================================
// Helpers
// ============================================================================

/**
 * Wait for a process to exit by polling isProcessAlive.
 * Returns true if the process exited, false on timeout.
 */
async function waitForExit(pid: number): Promise<boolean> {
  for (let i = 0; i < STOP_MAX_POLLS; i++) {
    if (!isProcessAlive(pid)) return true;
    await new Promise((r) => setTimeout(r, STOP_POLL_MS));
  }
  return false;
}

/**
 * Send a signal to the process.
 * On Unix: SIGTERM, then SIGKILL if needed.
 * On Windows: taskkill /T /F via execFile.
 */
async function killProcess(pid: number): Promise<void> {
  if (process.platform === 'win32') {
    return new Promise((resolve, reject) => {
      execFile('taskkill', ['/pid', String(pid), '/T', '/F'], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  // Unix: SIGTERM first
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return; // process already dead
  }

  const exited = await waitForExit(pid);
  if (!exited) {
    // Escalate to SIGKILL
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // process already dead
    }
    await waitForExit(pid);
  }
}

// ============================================================================
// Handler
// ============================================================================

export async function stopHandler(args: string[]): Promise<CommandResult> {
  // Help flag
  if (args.includes('--help') || args.includes('-h')) {
    return { exitCode: 0, output: HELP_TEXT.trim() };
  }

  // --server-only: stop only the server, leave the web frontend running
  const serverOnly = args.includes('--server-only');

  // Default to ~/.openaidy so a globally-installed `openaidy` finds the running
  // server's PID file without any env setup.
  const openaidyHome =
    process.env.OPENAIDY_HOME || resolve(homedir(), '.openaidy');

  const lines: string[] = [];
  let hadError = false;

  // Stop the server
  const serverResult = await stopServer(openaidyHome);
  lines.push(serverResult.message);
  if (serverResult.error) hadError = true;

  // Stop the web frontend (unless --server-only)
  if (!serverOnly) {
    const webResult = await stopWeb(openaidyHome);
    lines.push(webResult.message);
    if (webResult.error) hadError = true;
  }

  return {
    exitCode: hadError ? 1 : 0,
    output: lines.join('\n'),
  };
}

async function stopServer(
  openaidyHome: string,
): Promise<{ message: string; error: boolean }> {
  const pidFilePath = resolve(openaidyHome, 'state/server.pid');
  const rec = await readPidFile(pidFilePath);

  if (!rec) {
    return { message: 'Server is not running.', error: false };
  }

  if (!isProcessAlive(rec.pid)) {
    await unlink(pidFilePath).catch(() => {});
    return {
      message: 'Server was not running. Removed stale PID file.',
      error: false,
    };
  }

  try {
    await killProcess(rec.pid);
  } catch (err) {
    return {
      message: `Error: Failed to stop server: ${(err as Error).message}`,
      error: true,
    };
  }

  await unlink(pidFilePath).catch(() => {});
  return { message: 'Server stopped.', error: false };
}

async function stopWeb(
  openaidyHome: string,
): Promise<{ message: string; error: boolean }> {
  const webPidPath = resolve(openaidyHome, 'state/web.pid');
  const rec = await readWebPidFile(webPidPath);

  if (!rec) {
    return { message: 'Web is not running.', error: false };
  }

  if (!isProcessAlive(rec.pid)) {
    await unlink(webPidPath).catch(() => {});
    return {
      message: 'Web was not running. Removed stale PID file.',
      error: false,
    };
  }

  try {
    await killProcess(rec.pid);
  } catch (err) {
    return {
      message: `Error: Failed to stop web: ${(err as Error).message}`,
      error: true,
    };
  }

  await unlink(webPidPath).catch(() => {});
  return { message: 'Web stopped.', error: false };
}
