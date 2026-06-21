/**
 * process-manager.test.ts — vitest suite for PID helpers
 *
 * T2.1 acceptance criteria — all 6 cases must pass.
 * Cases 3-5 are skipped on Windows (SO_REUSEADDR port-binding quirk per R-D2).
 */

import { describe, it, expect } from 'vitest';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import {
  isProcessAlive,
  readPidFile,
  writePidFile,
  probeFreePort,
  type ServerPidRecord,
} from './process-manager.js';

function tmpPath(): string {
  return join(tmpdir(), `openaidy-pm-test-${randomUUID()}`);
}

describe('process-manager', () => {
  // ── isProcessAlive ────────────────────────────────────────────────────────

  describe('isProcessAlive', () => {
    it('returns true for the current process', () => {
      expect(isProcessAlive(process.pid)).toBe(true);
    });

    it('returns false for a synthetic dead PID', () => {
      // PID 0xFFFFFF is virtually guaranteed to not exist
      expect(isProcessAlive(0xffffff)).toBe(false);
    });
  });

  // ── readPidFile / writePidFile ────────────────────────────────────────────

  describe('PID file round-trip', () => {
    it('readPidFile returns null for non-existent file', async () => {
      const result = await readPidFile(tmpPath());
      expect(result).toBeNull();
    });

    it('writePidFile + readPidFile round-trips the JSON envelope', async () => {
      const path = tmpPath();
      const rec: ServerPidRecord = {
        pid: 12345,
        startedAt: '2026-06-21T00:00:00.000Z',
        port: 3001,
        logFile: '/tmp/openaidy/server.log',
      };

      await writePidFile(path, rec);
      const read = await readPidFile(path);

      expect(read).not.toBeNull();
      expect(read!.pid).toBe(12345);
      expect(read!.port).toBe(3001);
      expect(read!.startedAt).toBe('2026-06-21T00:00:00.000Z');
      expect(read!.logFile).toBe('/tmp/openaidy/server.log');

      // Cleanup
      await unlink(path).catch(() => {});
    });

    it('writePidFile creates parent directories on demand', async () => {
      const deep = join(
        tmpdir(),
        `openaidy-deep-${randomUUID()}`,
        'sub',
        'server.pid',
      );
      const rec: ServerPidRecord = {
        pid: 1,
        startedAt: new Date().toISOString(),
        port: 3000,
        logFile: '/dev/null',
      };

      await writePidFile(deep, rec);
      const read = await readPidFile(deep);
      expect(read).not.toBeNull();
      expect(read!.pid).toBe(1);

      // Cleanup
      await unlink(deep).catch(() => {});
    });
  });

  // ── probeFreePort ─────────────────────────────────────────────────────────

  describe('probeFreePort', () => {
    it('returns a port that successfully binds', async () => {
      const port = await probeFreePort(30000, 5);
      expect(port).toBeGreaterThanOrEqual(30000);
      expect(port).toBeLessThan(30005);

      // Verify we can actually bind to it
      await new Promise<void>((resolve, reject) => {
        const server = createServer();
        server.once('error', reject);
        server.once('listening', () => {
          server.close(() => resolve());
        });
        server.listen(port, '127.0.0.1');
      });
    });

    it('skips a busy port and returns the next free one', async () => {
      // Bind port 30100
      const occupied = createServer();
      await new Promise<void>((resolve) =>
        occupied.listen(30100, '127.0.0.1', resolve),
      );

      try {
        // Probe should skip 30100 and find 30101
        const port = await probeFreePort(30100, 5);
        expect(port).toBeGreaterThanOrEqual(30101);
      } finally {
        occupied.close();
      }
    });
  });
});
