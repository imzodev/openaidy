import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { FastifyBaseLogger } from 'fastify';
import {
  inspectBootstrapAdminToken,
  formatTokenDisplay,
  type BootstrapAdminInspectOptions,
} from './bootstrap-admin-inspect';
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

describe('inspectBootstrapAdminToken', () => {
  let tempDir: string;
  let tokenPath: string;
  let logger: ReturnType<typeof createMockLogger>;
  let authMiddleware: AuthMiddleware;
  let jwtSecret: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'openaidy-bootstrap-inspect-'));
    tokenPath = join(tempDir, 'bootstrap-admin.json');
    logger = createMockLogger();
    jwtSecret = 'bootstrap-inspect-test-secret';
    authMiddleware = new AuthMiddleware({
      ...defaultWebSocketConfig,
      auth: {
        ...defaultWebSocketConfig.auth,
        secret: jwtSecret,
      },
    });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  async function createValidTokenRecord(): Promise<{
    clientId: string;
    token: string;
    scopes: string[];
    createdAt: string;
    expiresAt: string;
  }> {
    const clientId = 'bootstrap-admin';
    const token = await authMiddleware.generateToken({
      clientId,
      type: 'access',
      scopes: [CAPABILITIES.ADMIN],
      expiresIn: 31536000000, // 1 year
    });
    const payload = await authMiddleware.validateToken(token);
    
    return {
      clientId,
      token,
      scopes: [CAPABILITIES.ADMIN],
      createdAt: new Date(payload!.iat * 1000).toISOString(),
      expiresAt: new Date(payload!.exp * 1000).toISOString(),
    };
  }

  describe('disabled state', () => {
    it('returns disabled status when bootstrap-admin is disabled', async () => {
      const options: BootstrapAdminInspectOptions = {
        enabled: false,
        tokenPath,
        jwtSecret,
        logger,
      };

      const result = await inspectBootstrapAdminToken(options);

      expect(result.status).toBe('disabled');
      expect(result.enabled).toBe(false);
      expect(result.tokenPath).toBe(tokenPath);
      expect(result.record).toBeUndefined();
    });
  });

  describe('missing state', () => {
    it('returns missing status when token file does not exist', async () => {
      const options: BootstrapAdminInspectOptions = {
        enabled: true,
        tokenPath,
        jwtSecret,
        logger,
      };

      const result = await inspectBootstrapAdminToken(options);

      expect(result.status).toBe('missing');
      expect(result.enabled).toBe(true);
      expect(result.error).toContain('not found');
    });
  });

  describe('malformed state', () => {
    it('returns malformed status when file is not valid JSON', async () => {
      await writeFile(tokenPath, 'not valid json {{{', 'utf-8');

      const options: BootstrapAdminInspectOptions = {
        enabled: true,
        tokenPath,
        jwtSecret,
        logger,
      };

      const result = await inspectBootstrapAdminToken(options);

      expect(result.status).toBe('malformed');
      expect(result.error).toContain('invalid JSON');
    });

    it('returns malformed status when required fields are missing', async () => {
      await writeFile(tokenPath, JSON.stringify({ clientId: 'test' }), 'utf-8');

      const options: BootstrapAdminInspectOptions = {
        enabled: true,
        tokenPath,
        jwtSecret,
        logger,
      };

      const result = await inspectBootstrapAdminToken(options);

      expect(result.status).toBe('malformed');
      expect(result.error).toContain('invalid structure');
    });
  });

  describe('invalid state', () => {
    it('returns invalid status when token signature is invalid', async () => {
      const record = {
        clientId: 'bootstrap-admin',
        token: 'invalid.token.here',
        scopes: [CAPABILITIES.ADMIN],
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      };
      await writeFile(tokenPath, JSON.stringify(record), 'utf-8');

      const options: BootstrapAdminInspectOptions = {
        enabled: true,
        tokenPath,
        jwtSecret,
        logger,
      };

      const result = await inspectBootstrapAdminToken(options);

      expect(result.status).toBe('invalid');
      expect(result.error).toContain('invalid signature');
    });

    it('returns invalid status when subject does not match clientId', async () => {
      // Generate token with different clientId
      const token = await authMiddleware.generateToken({
        clientId: 'different-client',
        type: 'access',
        scopes: [CAPABILITIES.ADMIN],
        expiresIn: 86400000,
      });
      const payload = await authMiddleware.validateToken(token);
      
      const record = {
        clientId: 'bootstrap-admin', // Different from token subject
        token,
        scopes: [CAPABILITIES.ADMIN],
        createdAt: new Date(payload!.iat * 1000).toISOString(),
        expiresAt: new Date(payload!.exp * 1000).toISOString(),
      };
      await writeFile(tokenPath, JSON.stringify(record), 'utf-8');

      const options: BootstrapAdminInspectOptions = {
        enabled: true,
        tokenPath,
        jwtSecret,
        logger,
      };

      const result = await inspectBootstrapAdminToken(options);

      expect(result.status).toBe('invalid');
      expect(result.error).toContain('does not match');
    });

    it('returns invalid status when token lacks admin capability', async () => {
      const token = await authMiddleware.generateToken({
        clientId: 'bootstrap-admin',
        type: 'access',
        scopes: ['read'], // No admin scope
        expiresIn: 86400000,
      });
      const payload = await authMiddleware.validateToken(token);
      
      const record = {
        clientId: 'bootstrap-admin',
        token,
        scopes: ['read'],
        createdAt: new Date(payload!.iat * 1000).toISOString(),
        expiresAt: new Date(payload!.exp * 1000).toISOString(),
      };
      await writeFile(tokenPath, JSON.stringify(record), 'utf-8');

      const options: BootstrapAdminInspectOptions = {
        enabled: true,
        tokenPath,
        jwtSecret,
        logger,
      };

      const result = await inspectBootstrapAdminToken(options);

      expect(result.status).toBe('invalid');
      expect(result.error).toContain('admin capability');
    });
  });

  describe('expired state', () => {
    it('returns expired status when token has expired', async () => {
      const record = await createValidTokenRecord();
      // Manually set expiresAt to past
      record.expiresAt = new Date(Date.now() - 1000).toISOString();
      await writeFile(tokenPath, JSON.stringify(record), 'utf-8');

      const options: BootstrapAdminInspectOptions = {
        enabled: true,
        tokenPath,
        jwtSecret,
        logger,
      };

      const result = await inspectBootstrapAdminToken(options);

      expect(result.status).toBe('expired');
      expect(result.record).toBeDefined();
      expect(result.error).toContain('expired');
    });
  });

  describe('valid state', () => {
    it('returns valid status for a valid token', async () => {
      const record = await createValidTokenRecord();
      await writeFile(tokenPath, JSON.stringify(record), 'utf-8');

      const options: BootstrapAdminInspectOptions = {
        enabled: true,
        tokenPath,
        jwtSecret,
        logger,
      };

      const result = await inspectBootstrapAdminToken(options);

      expect(result.status).toBe('valid');
      expect(result.record).toBeDefined();
      expect(result.record?.clientId).toBe('bootstrap-admin');
      expect(result.record?.scopes).toContain(CAPABILITIES.ADMIN);
      expect(result.error).toBeUndefined();
    });

    it('does not modify or create token file', async () => {
      const record = await createValidTokenRecord();
      await writeFile(tokenPath, JSON.stringify(record), 'utf-8');
      
      const originalContent = JSON.stringify(record);

      const options: BootstrapAdminInspectOptions = {
        enabled: true,
        tokenPath,
        jwtSecret,
        logger,
      };

      await inspectBootstrapAdminToken(options);

      // Read the file again and verify it hasn't changed
      const { readFile } = await import('node:fs/promises');
      const currentContent = await readFile(tokenPath, 'utf-8');
      
      expect(currentContent.trim()).toBe(originalContent);
    });
  });
});

describe('formatTokenDisplay', () => {
  const tokenPath = '/test/token.json';

  it('formats disabled status correctly', () => {
    const result = {
      status: 'disabled' as const,
      tokenPath,
      enabled: false,
    };

    const output = formatTokenDisplay(result);

    expect(output).toContain('Status:    disabled');
    expect(output).toContain('Enabled:   false');
    expect(output).toContain(tokenPath);
    expect(output).not.toContain('Token:');
  });

  it('formats missing status correctly', () => {
    const result = {
      status: 'missing' as const,
      tokenPath,
      enabled: true,
      error: 'Token file not found',
    };

    const output = formatTokenDisplay(result);

    expect(output).toContain('Status:    missing');
    expect(output).toContain('Error: Token file not found');
  });

  it('formats valid status with token value', () => {
    const result = {
      status: 'valid' as const,
      tokenPath,
      enabled: true,
      record: {
        clientId: 'bootstrap-admin',
        token: 'test-token-value',
        scopes: ['admin'],
        createdAt: '2024-01-01T00:00:00Z',
        expiresAt: '2025-01-01T00:00:00Z',
      },
    };

    const output = formatTokenDisplay(result);

    expect(output).toContain('Status:    valid');
    expect(output).toContain('Client ID: bootstrap-admin');
    expect(output).toContain('Token:');
    expect(output).toContain('test-token-value');
  });

  it('formats expired status with token value', () => {
    const result = {
      status: 'expired' as const,
      tokenPath,
      enabled: true,
      record: {
        clientId: 'bootstrap-admin',
        token: 'expired-token-value',
        scopes: ['admin'],
        createdAt: '2024-01-01T00:00:00Z',
        expiresAt: '2024-02-01T00:00:00Z',
      },
      error: 'Token expired',
    };

    const output = formatTokenDisplay(result);

    expect(output).toContain('Status:    expired');
    expect(output).toContain('Token:');
    expect(output).toContain('expired-token-value');
    expect(output).toContain('Error: Token expired');
  });

  it('does not show token for invalid/malformed status', () => {
    const result = {
      status: 'malformed' as const,
      tokenPath,
      enabled: true,
      error: 'Invalid JSON',
    };

    const output = formatTokenDisplay(result);

    expect(output).not.toContain('Token:');
    expect(output).toContain('Error: Invalid JSON');
  });
});
