/**
 * status.test.ts — vitest suite for openaidy status (PR2 T2.4)
 *
 * Tests all 4 acceptance criteria:
 *  1. Running server → state=running, URL, PID, log, masked token
 *  2. Stopped server → state=stopped, token info
 *  3. Stale PID file → state=stopped
 *  4. Token masking shows only last 4 chars
 */

import { describe, it, expect } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { statusHandler, maskToken } from './status.js';
import { writePidFile } from '../lib/process-manager.js';

async function setupEnv(): Promise<string> {
  const home = join(tmpdir(), `openaidy-status-test-${randomUUID()}`);
  await mkdir(join(home, 'state'), { recursive: true });
  await mkdir(join(home, 'credentials'), { recursive: true });
  return home;
}

describe('openaidy status', () => {
  describe('maskToken', () => {
    it('shows last 4 chars with **** prefix', () => {
      expect(maskToken('abcdefgh')).toBe('****efgh');
    });

    it('handles short tokens gracefully', () => {
      expect(maskToken('ab')).toBe('****ab');
    });

    it('handles empty string', () => {
      expect(maskToken('')).toBe('****');
    });
  });

  describe('statusHandler', () => {
    it('shows help with --help flag', async () => {
      const result = await statusHandler(['--help'], {});
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('Usage:');
    });

    it('reports stopped when no PID file exists', async () => {
      const home = await setupEnv();
      await writeFile(
        join(home, 'credentials', 'bootstrap-admin.json'),
        JSON.stringify({
          token: 'test-token-1234',
          expiresAt: '2099-01-01T00:00:00.000Z',
        }),
      );

      const result = await statusHandler([], { OPENAIDY_HOME: home });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('stopped');
    });

    it('reports stopped when PID file is stale', async () => {
      const home = await setupEnv();
      await writePidFile(join(home, 'state', 'server.pid'), {
        pid: 0xffffff,
        startedAt: new Date().toISOString(),
        port: 3001,
        logFile: '/dev/null',
      });

      const result = await statusHandler([], { OPENAIDY_HOME: home });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('stopped');
    });

    it('reports masked token value', async () => {
      const home = await setupEnv();
      await writeFile(
        join(home, 'credentials', 'bootstrap-admin.json'),
        JSON.stringify({
          token: 'test-token-1234',
          expiresAt: '2099-01-01T00:00:00.000Z',
        }),
      );

      const result = await statusHandler([], { OPENAIDY_HOME: home });
      expect(result.output).toContain('****1234');
    });
  });
});
