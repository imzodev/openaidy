import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { FastifyBaseLogger } from 'fastify';
import { BootstrapAdminManager } from './bootstrap-admin';
import { AuthMiddleware } from './websocket/middleware/auth';
import { defaultWebSocketConfig } from './websocket/types';
import { CAPABILITIES } from './websocket/middleware/auth';

const createMockLogger = (): FastifyBaseLogger =>
  ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: vi.fn(() => createMockLogger()),
    level: 'info',
    silent: false,
  }) as unknown as FastifyBaseLogger;

describe('BootstrapAdminManager', () => {
  let tempDir: string;
  let tokenPath: string;
  let logger: ReturnType<typeof createMockLogger>;
  let authMiddleware: AuthMiddleware;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'openaidy-bootstrap-admin-'));
    tokenPath = join(tempDir, 'bootstrap-admin.json');
    logger = createMockLogger();
    authMiddleware = new AuthMiddleware({
      ...defaultWebSocketConfig,
      auth: {
        ...defaultWebSocketConfig.auth,
        secret: 'bootstrap-admin-test-secret',
      },
    });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('creates and persists a bootstrap admin token on first run', async () => {
    const manager = new BootstrapAdminManager(authMiddleware, logger, {
      enabled: true,
      tokenPath,
      clientId: 'bootstrap-admin',
      tokenExpiryMs: 31536000000,
    });

    const result = await manager.ensureToken();

    expect(result).not.toBeNull();
    expect(result?.created).toBe(true);
    expect(result?.record.clientId).toBe('bootstrap-admin');
    expect(result?.record.scopes).toContain(CAPABILITIES.ADMIN);

    const persisted = JSON.parse(await readFile(tokenPath, 'utf-8')) as {
      clientId: string;
      token: string;
      scopes: string[];
    };
    expect(persisted.clientId).toBe('bootstrap-admin');
    expect(persisted.scopes).toContain(CAPABILITIES.ADMIN);

    const payload = await authMiddleware.validateToken(persisted.token);
    expect(payload?.sub).toBe('bootstrap-admin');
    expect(payload?.scopes).toContain(CAPABILITIES.ADMIN);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('reuses an existing valid bootstrap admin token', async () => {
    const firstManager = new BootstrapAdminManager(authMiddleware, logger, {
      enabled: true,
      tokenPath,
      clientId: 'bootstrap-admin',
      tokenExpiryMs: 31536000000,
    });
    const firstResult = await firstManager.ensureToken();

    const secondLogger = createMockLogger();
    const secondManager = new BootstrapAdminManager(
      authMiddleware,
      secondLogger,
      {
        enabled: true,
        tokenPath,
        clientId: 'bootstrap-admin',
        tokenExpiryMs: 31536000000,
      },
    );
    const secondResult = await secondManager.ensureToken();

    expect(firstResult).not.toBeNull();
    expect(secondResult).not.toBeNull();
    expect(secondResult?.created).toBe(false);
    expect(secondResult?.record.token).toBe(firstResult?.record.token);
    expect(secondLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'bootstrap-admin',
        tokenPath,
      }),
      'Bootstrap admin token loaded',
    );
  });

  it('returns null when bootstrap admin is disabled', async () => {
    const manager = new BootstrapAdminManager(authMiddleware, logger, {
      enabled: false,
      tokenPath,
      clientId: 'bootstrap-admin',
      tokenExpiryMs: 31536000000,
    });

    const result = await manager.ensureToken();

    expect(result).toBeNull();
    expect(manager.getRecord()).toBeNull();
  });

  describe('maybeRenewToken()', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('does nothing when the token has plenty of time left', async () => {
      const manager = new BootstrapAdminManager(authMiddleware, logger, {
        enabled: true,
        tokenPath,
        clientId: 'bootstrap-admin',
        tokenExpiryMs: 31536000000, // 1 year
      });
      const first = await manager.ensureToken();

      const result = await manager.maybeRenewToken();

      expect(result).toBeNull();
      expect(manager.getRecord()?.token).toBe(first?.record.token);
    });

    it('returns null when no token has been loaded yet', async () => {
      const manager = new BootstrapAdminManager(authMiddleware, logger, {
        enabled: true,
        tokenPath,
        clientId: 'bootstrap-admin',
        tokenExpiryMs: 31536000000,
      });

      expect(await manager.maybeRenewToken()).toBeNull();
    });

    it('returns null when disabled', async () => {
      const manager = new BootstrapAdminManager(authMiddleware, logger, {
        enabled: false,
        tokenPath,
        clientId: 'bootstrap-admin',
        tokenExpiryMs: 31536000000,
      });

      expect(await manager.maybeRenewToken()).toBeNull();
    });

    it('re-mints and persists a fresh token once within the renewal threshold', async () => {
      vi.useFakeTimers();

      const manager = new BootstrapAdminManager(authMiddleware, logger, {
        enabled: true,
        tokenPath,
        clientId: 'bootstrap-admin',
        tokenExpiryMs: 1000, // 1s lifetime, 20% threshold => 200ms remaining
      });
      const first = await manager.ensureToken();
      expect(first?.created).toBe(true);

      // 850ms in: 150ms remaining, under the 200ms threshold.
      await vi.advanceTimersByTimeAsync(850);

      const renewed = await manager.maybeRenewToken();

      expect(renewed).not.toBeNull();
      expect(renewed?.created).toBe(true);
      expect(renewed?.record.token).not.toBe(first?.record.token);
      expect(manager.getRecord()?.token).toBe(renewed?.record.token);

      const persisted = JSON.parse(await readFile(tokenPath, 'utf-8')) as {
        token: string;
      };
      expect(persisted.token).toBe(renewed?.record.token);
    });
  });

  describe('startAutoRenew() / stopAutoRenew()', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('periodically renews the token once due, and stops on stopAutoRenew()', async () => {
      // Real timers + real (short) delays here: the interval callback
      // fires-and-forgets an async chain that does real fs I/O
      // (persistBootstrapAdminRecord), which fake timers don't drive —
      // only JS timers/Date, not the libuv fs completion queue. Mixing
      // the two left a renewal write in flight when the next test's
      // tempDir cleanup ran, racing an ENOTEMPTY. Polling with real
      // waits sidesteps that entirely.
      // JWT exp/iat are whole-second Unix timestamps, so tokenExpiryMs
      // below ~1000 rounds down to 0 added seconds (an already-expired
      // token). 2s keeps the math meaningful while staying fast.
      const manager = new BootstrapAdminManager(authMiddleware, logger, {
        enabled: true,
        tokenPath,
        clientId: 'bootstrap-admin',
        tokenExpiryMs: 2000, // 2s lifetime, 20% threshold => 400ms remaining
        renewalCheckIntervalMs: 150,
      });
      const first = await manager.ensureToken();

      manager.startAutoRenew();

      const deadline = Date.now() + 4000;
      while (
        manager.getRecord()?.token === first?.record.token &&
        Date.now() < deadline
      ) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      const renewedToken = manager.getRecord()?.token;
      expect(renewedToken).not.toBe(first?.record.token);

      manager.stopAutoRenew();

      // Nothing more should change once the timer is stopped.
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(manager.getRecord()?.token).toBe(renewedToken);
    }, 10000);

    it('does not start a second timer if already running, and is a no-op when disabled', () => {
      const enabledManager = new BootstrapAdminManager(authMiddleware, logger, {
        enabled: true,
        tokenPath,
        clientId: 'bootstrap-admin',
        tokenExpiryMs: 31536000000,
      });
      expect(() => {
        enabledManager.startAutoRenew();
        enabledManager.startAutoRenew();
        enabledManager.stopAutoRenew();
      }).not.toThrow();

      const disabledManager = new BootstrapAdminManager(
        authMiddleware,
        logger,
        {
          enabled: false,
          tokenPath,
          clientId: 'bootstrap-admin',
          tokenExpiryMs: 31536000000,
        },
      );
      expect(() => {
        disabledManager.startAutoRenew();
        disabledManager.stopAutoRenew();
      }).not.toThrow();
    });
  });
});
