/**
 * process-manager.ts — PID file helpers, process liveness, port probing (PR2 T2.1)
 *
 * Cross-platform utilities for managing the OpenAidy server child process.
 * All file operations use atomic tmp+rename to prevent partial writes.
 *
 * Exports:
 *   ServerPidRecord  — JSON envelope for PID file
 *   readPidFile()    — read and parse a PID file
 *   writePidFile()   — atomically write a PID file (tmp+rename)
 *   isProcessAlive() — check if a PID is alive via kill(pid, 0)
 *   probeFreePort()  — find a free TCP port in a range
 */

import { writeFile, rename, mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname } from 'node:path';

// ============================================================================
// Types
// ============================================================================

export type ServerPidRecord = {
  pid: number;
  startedAt: string; // ISO 8601
  port: number;
  logFile: string; // absolute path
};

// ============================================================================
// PID file helpers
// ============================================================================

/**
 * Read and parse a ServerPidRecord from a JSON file.
 * Returns null if the file doesn't exist or is unparseable.
 */
export async function readPidFile(
  path: string,
): Promise<ServerPidRecord | null> {
  try {
    const raw = await readFile(path, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    if (
      typeof parsed.pid !== 'number' ||
      typeof parsed.startedAt !== 'string' ||
      typeof parsed.port !== 'number' ||
      typeof parsed.logFile !== 'string'
    ) {
      return null;
    }

    return parsed as ServerPidRecord;
  } catch {
    return null;
  }
}

/**
 * Atomically write a ServerPidRecord to a JSON file.
 * Creates parent directories on demand. Uses tmp+rename for atomicity.
 */
export async function writePidFile(
  path: string,
  rec: ServerPidRecord,
): Promise<void> {
  // Ensure parent directory exists
  await mkdir(dirname(path), { recursive: true });

  const tmp = `${path}.tmp.${process.pid}`;
  const content = JSON.stringify(rec, null, 2);

  await writeFile(tmp, content, 'utf-8');
  await rename(tmp, path);
}

// ============================================================================
// Process liveness
// ============================================================================

/**
 * Check if a process is alive by sending signal 0.
 * Returns true if the process exists, false otherwise.
 * This is synchronous because process.kill is sync on both Unix and Windows.
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ESRCH') {
      return false;
    }
    // EPERM means the process exists but we don't have permission to signal it
    // which is fine — it's alive.
    if ((err as NodeJS.ErrnoException).code === 'EPERM') {
      return true;
    }
    return false;
  }
}

// ============================================================================
// Port probing
// ============================================================================

/**
 * Probe for a free TCP port starting from `start`, trying up to `tries` ports.
 * Returns the first port that successfully binds and closes.
 */
export async function probeFreePort(
  start: number,
  tries: number,
): Promise<number> {
  for (let port = start; port < start + tries; port++) {
    const free = await isPortFree(port);
    if (free) return port;
  }
  throw new Error(`No free port found in range ${start}-${start + tries - 1}`);
}

/**
 * Check if a single TCP port is free by trying to bind to it.
 * Returns true if the port is free.
 */
function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}
