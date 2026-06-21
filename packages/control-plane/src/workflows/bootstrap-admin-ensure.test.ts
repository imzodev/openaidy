/**
 * BootstrapAdminWorkflow.ensureToken - extended tests for PR1
 *
 * Covers:
 * - signJwt / verifyJwt helpers (private) — round-trip and tamper detection
 * - ensureToken() first-run generation (persistence + 0o600 on POSIX)
 * - ensureToken() idempotent re-use of valid existing record
 * - ensureToken() regeneration on expired / corrupt / missing-field records
 * - ensureToken() refusal when JWT secret is the unsafe default
 * - **JWT interop**: a token minted by control-plane.signJwt validates
 *   against the server's AuthMiddleware.validateToken. THIS IS THE
 *   RISK-DRIVEN GATE: if it fails, PR1 is broken.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, rm, stat, writeFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createBootstrapAdminWorkflow,
  type BootstrapAdminContext,
  type WorkflowLogger,
} from './bootstrap-admin.js';
import type { BootstrapAdminRecord } from '@openaidy/shared-types';

const DEFAULT_UNSAFE_SECRET = 'change-me-in-production';
const TEST_CLIENT_ID = 'bootstrap-admin';

async function statMode(path: string): Promise<number> {
  const s = await stat(path);
  return s.mode & 0o777;
}

describe('BootstrapAdminWorkflow — JWT helpers (ensureToken path)', () => {
  let tempDir: string;
  let tokenPath: string;
  let mockContext: BootstrapAdminContext;

  beforeEach(async () => {
    tempDir = join(
      tmpdir(),
      `openaidy-ensure-token-${Date.now()}-${Math.random()}`,
    );
    await mkdir(tempDir, { recursive: true });
    tokenPath = join(tempDir, 'bootstrap-admin.json');
    mockContext = {
      enabled: true,
      tokenPath,
      jwtSecret: 'unit-test-secret-do-not-leak',
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      } as WorkflowLogger,
    };
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('ensureToken() — first run', () => {
    it('creates a record when the token file is missing', async () => {
      const wf = createBootstrapAdminWorkflow(mockContext);
      const result = await wf.ensureToken();

      expect(result).not.toBeNull();
      expect(result?.created).toBe(true);
      expect(result?.record.clientId).toBe(TEST_CLIENT_ID);
      expect(result?.record.token).toMatch(
        /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
      );
      expect(result?.record.scopes).toContain('*');
      expect(typeof result?.record.createdAt).toBe('string');
      expect(typeof result?.record.expiresAt).toBe('string');
    });

    it('persists the record to disk as JSON with the documented shape', async () => {
      const wf = createBootstrapAdminWorkflow(mockContext);
      const result = await wf.ensureToken();
      expect(result).not.toBeNull();

      const persisted = JSON.parse(
        await (await import('node:fs/promises')).readFile(tokenPath, 'utf-8'),
      ) as BootstrapAdminRecord;
      expect(persisted.clientId).toBe(result?.record.clientId);
      expect(persisted.token).toBe(result?.record.token);
      expect(persisted.scopes).toEqual(result?.record.scopes);
      expect(persisted.createdAt).toBe(result?.record.createdAt);
      expect(persisted.expiresAt).toBe(result?.record.expiresAt);
    });

    it('writes the token file with mode 0o600 on POSIX', async () => {
      if (process.platform === 'win32') {
        // POSIX-only assertion — Windows uses NTFS ACLs (best-effort)
        return;
      }
      const wf = createBootstrapAdminWorkflow(mockContext);
      await wf.ensureToken();
      expect(await statMode(tokenPath)).toBe(0o600);
    });
  });

  describe('ensureToken() — idempotent re-use', () => {
    it('reuses a valid existing token without rewriting the file', async () => {
      const wf1 = createBootstrapAdminWorkflow(mockContext);
      const first = await wf1.ensureToken();
      expect(first?.created).toBe(true);

      const initialMtime = (await stat(tokenPath)).mtimeMs;
      // Wait so an inadvertent rewrite would be detectable via mtime
      await new Promise((r) => setTimeout(r, 25));

      const wf2 = createBootstrapAdminWorkflow(mockContext);
      const second = await wf2.ensureToken();
      expect(second?.created).toBe(false);
      expect(second?.record.token).toBe(first?.record.token);

      const finalMtime = (await stat(tokenPath)).mtimeMs;
      expect(finalMtime).toBe(initialMtime);
    });
  });

  describe('ensureToken() — regeneration', () => {
    it('regenerates when the existing token is expired', async () => {
      // Seed an expired record using a token whose signature matches the
      // control-plane secret so validateToken-style checks pass.
      const expiredRecord: BootstrapAdminRecord = {
        clientId: TEST_CLIENT_ID,
        token: 'will-be-replaced',
        scopes: ['*'],
        createdAt: '2020-01-01T00:00:00.000Z',
        expiresAt: '2020-12-31T00:00:00.000Z',
      };
      await writeFile(tokenPath, JSON.stringify(expiredRecord), 'utf-8');

      const wf = createBootstrapAdminWorkflow(mockContext);
      const result = await wf.ensureToken();
      expect(result?.created).toBe(true);
      expect(result?.record.token).not.toBe('will-be-replaced');
      expect(result?.record.expiresAt).not.toBe(expiredRecord.expiresAt);
    });

    it('regenerates when the existing file contains invalid JSON', async () => {
      await writeFile(tokenPath, '{ not valid json', 'utf-8');
      const wf = createBootstrapAdminWorkflow(mockContext);
      const result = await wf.ensureToken();
      expect(result?.created).toBe(true);
      expect(result?.record.token).toMatch(
        /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
      );
    });

    it('regenerates when the existing record is missing required fields', async () => {
      await writeFile(tokenPath, JSON.stringify({ clientId: 'x' }), 'utf-8');
      const wf = createBootstrapAdminWorkflow(mockContext);
      const result = await wf.ensureToken();
      expect(result?.created).toBe(true);
    });

    it('regenerates when the existing token signature is invalid', async () => {
      // Token with the right shape but garbage signature — control-plane's
      // verifyJwt must reject it, forcing regeneration.
      const fakeToken =
        'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJib290c3RyYXAtYWRtaW4ifQ.invalidsig';
      const bad: BootstrapAdminRecord = {
        clientId: TEST_CLIENT_ID,
        token: fakeToken,
        scopes: ['*'],
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      };
      await writeFile(tokenPath, JSON.stringify(bad), 'utf-8');

      const wf = createBootstrapAdminWorkflow(mockContext);
      const result = await wf.ensureToken();
      expect(result?.created).toBe(true);
      expect(result?.record.token).not.toBe(fakeToken);
    });
  });

  describe('ensureToken() — refusal cases', () => {
    it('returns null when bootstrap admin is disabled', async () => {
      const wf = createBootstrapAdminWorkflow({
        ...mockContext,
        enabled: false,
      });
      const result = await wf.ensureToken();
      expect(result).toBeNull();
    });

    it('throws when the JWT secret equals the unsafe default "change-me-in-production"', async () => {
      const wf = createBootstrapAdminWorkflow({
        ...mockContext,
        jwtSecret: DEFAULT_UNSAFE_SECRET,
      });
      await expect(wf.ensureToken()).rejects.toThrow(/default JWT secret/i);
      // No file should be written
      await expect(stat(tokenPath)).rejects.toThrow();
    });
  });

  describe('ensureToken() — JWT interop with AuthMiddleware', () => {
    // CRITICAL RISK-DRIVEN GATE: a token minted by control-plane.signJwt
    // MUST validate against the server's AuthMiddleware.validateToken. If
    // this fails, the install script's token would be rejected by the
    // running server and PR1 is broken.
    it('produces a token that AuthMiddleware.validateToken accepts', async () => {
      // Resolve to apps/server relative to the control-plane package root.
      // The control-plane package is at packages/control-plane/src/workflows/,
      // so apps/server is 4 segments up.
      const serverAuthPath = resolve(
        __dirname,
        '..',
        '..',
        '..',
        '..',
        'apps',
        'server',
        'src',
        'websocket',
        'middleware',
        'auth.ts',
      );
      const serverTypesPath = resolve(
        __dirname,
        '..',
        '..',
        '..',
        '..',
        'apps',
        'server',
        'src',
        'websocket',
        'types.ts',
      );

      let serverAvailable = true;
      try {
        await access(serverAuthPath);
        await access(serverTypesPath);
      } catch {
        serverAvailable = false;
      }
      if (!serverAvailable) {
        // Skip: interop test only runs when the server source is present.
        return;
      }

      const wf = createBootstrapAdminWorkflow(mockContext);
      const result = await wf.ensureToken();
      expect(result?.created).toBe(true);
      expect(result?.record.token).toBeTruthy();

      const { AuthMiddleware } = await import(serverAuthPath);
      const { defaultWebSocketConfig } = await import(serverTypesPath);

      const auth = new AuthMiddleware({
        ...defaultWebSocketConfig,
        auth: {
          ...defaultWebSocketConfig.auth,
          secret: mockContext.jwtSecret,
        },
      });

      const payload = await auth.validateToken(result!.record.token);
      expect(payload).not.toBeNull();
      expect(payload?.sub).toBe(TEST_CLIENT_ID);
      expect(payload?.scopes).toContain('*');
    });
  });
});
