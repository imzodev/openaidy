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
});
