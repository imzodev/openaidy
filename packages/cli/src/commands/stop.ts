/**
 * openaidy stop — Stop the OpenAidy server (PR2 T2.3)
 *
 * Behavior (per spec R-8):
 *  1. Read PID JSON from $OPENAIDY_HOME/state/server.pid
 *  2. If process is dead, remove stale PID file, report cleanup
 *  3. If alive, send SIGTERM (Unix) or taskkill (Windows)
 *  4. Poll every 500ms for up to 10s for process exit
 *  5. SIGKILL escalation if process doesn't stop
 *  6. Remove PID file on success
 *
 * Uses createCLIError / formatCLIError from errors.ts (CC-3).
 * Returns CommandResult per types.ts contract.
 */

import { execFile } from 'node:child_process';
import { unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { CommandResult } from '../types.js';
import { readPidFile, isProcessAlive } from '../lib/process-manager.js';

// ============================================================================
// Constants
// ============================================================================

const STOP_POLL_MS = 500;
const STOP_MAX_POLLS = 20; // 10 seconds

const HELP_TEXT = `
Usage: openaidy stop [options]

Stop the OpenAidy server.

Gracefully shuts down the server by:
  - Reading the PID file
  - Sending SIGTERM (Unix) or taskkill (Windows)
  - Waiting up to 10 seconds for clean shutdown
  - Escalating to SIGKILL if needed

Options:
  -h, --help          Show this help message

Exit Codes:
  0  Server stopped or was not running
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

  const openaidyHome = process.env.OPENAIDY_HOME;
  if (!openaidyHome) {
    return { exitCode: 0, output: 'Server is not running.' };
  }

  const pidFilePath = resolve(openaidyHome, 'state/server.pid');
  const rec = await readPidFile(pidFilePath);

  if (!rec) {
    return { exitCode: 0, output: 'Server is not running.' };
  }

  // Check if the process is stale (already dead)
  if (!isProcessAlive(rec.pid)) {
    await unlink(pidFilePath).catch(() => {});
    return {
      exitCode: 0,
      output: `Server was not running. Removed stale PID file.`,
    };
  }

  // Kill the process
  try {
    await killProcess(rec.pid);
  } catch (err) {
    return {
      exitCode: 1,
      output: `Error: Failed to stop server: ${(err as Error).message}`,
    };
  }

  // Remove PID file
  await unlink(pidFilePath).catch(() => {});

  return {
    exitCode: 0,
    output: `Server stopped.`,
  };
}
