/**
 * Control Plane - Bootstrap Admin Workflow Tests
 * 
 * Tests for the bootstrap admin workflow service.
 * These tests use temporary files to test the actual implementation.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  BootstrapAdminWorkflow,
  createBootstrapAdminWorkflow,
  type BootstrapAdminContext,
  type WorkflowLogger,
} from './bootstrap-admin.js';

describe('BootstrapAdminWorkflow', () => {
  let workflow: BootstrapAdminWorkflow;
  let mockContext: BootstrapAdminContext;
  let tempDir: string;
  let tokenPath: string;

  beforeEach(async () => {
    // Create temp directory
    tempDir = join(tmpdir(), `bootstrap-admin-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    tokenPath = join(tempDir, 'bootstrap-admin.json');

    mockContext = {
      enabled: true,
      tokenPath,
      jwtSecret: 'test-secret',
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
    };
    
    workflow = createBootstrapAdminWorkflow(mockContext);
  });

  afterEach(async () => {
    // Clean up temp directory
    await rm(tempDir, { recursive: true, force: true });
  });

  /**
   * Helper to create a valid JWT-like token string (not cryptographically valid)
   */
  function createTestToken(clientId: string): string {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: clientId, type: 'bootstrap' })).toString('base64url');
    const signature = 'fakesignature';
    return `${header}.${payload}.${signature}`;
  }

  describe('inspectToken()', () => {
    it('returns disabled status when bootstrap admin is disabled', async () => {
      const disabledContext: BootstrapAdminContext = {
        ...mockContext,
        enabled: false,
      };
      const disabledWorkflow = createBootstrapAdminWorkflow(disabledContext);
      
      const result = await disabledWorkflow.inspectToken();
      
      expect(result.success).toBe(true);
      expect(result.data?.status).toBe('disabled');
      expect(result.data?.enabled).toBe(false);
    });

    it('returns missing status when token file not found', async () => {
      const result = await workflow.inspectToken();
      
      expect(result.success).toBe(true);
      expect(result.data?.status).toBe('missing');
      expect(result.data?.enabled).toBe(true);
    });

    it('returns malformed status for invalid JSON', async () => {
      await writeFile(tokenPath, 'not valid json');
      
      const result = await workflow.inspectToken();
      
      expect(result.success).toBe(true);
      expect(result.data?.status).toBe('malformed');
    });

    it('returns malformed status for missing required fields', async () => {
      await writeFile(tokenPath, JSON.stringify({ clientId: 'test' }));
      
      const result = await workflow.inspectToken();
      
      expect(result.success).toBe(true);
      expect(result.data?.status).toBe('malformed');
    });

    it('returns invalid status for malformed JWT', async () => {
      const tokenData = {
        clientId: 'client-1',
        token: 'not-a-valid-jwt',
        scopes: ['admin'],
        createdAt: '2024-01-01T00:00:00Z',
        expiresAt: '2099-01-01T00:00:00Z',
      };
      await writeFile(tokenPath, JSON.stringify(tokenData));
      
      const result = await workflow.inspectToken();
      
      expect(result.success).toBe(true);
      expect(result.data?.status).toBe('invalid');
    });

    it('returns invalid status when token subject does not match clientId', async () => {
      const tokenData = {
        clientId: 'client-1',
        token: createTestToken('different-client'),
        scopes: ['admin'],
        createdAt: '2024-01-01T00:00:00Z',
        expiresAt: '2099-01-01T00:00:00Z',
      };
      await writeFile(tokenPath, JSON.stringify(tokenData));
      
      const result = await workflow.inspectToken();
      
      expect(result.success).toBe(true);
      expect(result.data?.status).toBe('invalid');
    });

    it('returns expired status for expired tokens', async () => {
      const tokenData = {
        clientId: 'client-1',
        token: createTestToken('client-1'),
        scopes: ['admin'],
        createdAt: '2020-01-01T00:00:00Z',
        expiresAt: '2020-12-31T23:59:59Z', // Expired
      };
      await writeFile(tokenPath, JSON.stringify(tokenData));
      
      const result = await workflow.inspectToken();
      
      expect(result.success).toBe(true);
      expect(result.data?.status).toBe('expired');
      expect(result.data?.record?.clientId).toBe('client-1');
    });

    it('returns valid status for valid tokens', async () => {
      const tokenData = {
        clientId: 'client-1',
        token: createTestToken('client-1'),
        scopes: ['admin', 'chat'],
        createdAt: '2024-01-01T00:00:00Z',
        expiresAt: '2099-01-01T00:00:00Z',
      };
      await writeFile(tokenPath, JSON.stringify(tokenData));
      
      const result = await workflow.inspectToken();
      
      expect(result.success).toBe(true);
      expect(result.data?.status).toBe('valid');
      expect(result.data?.record?.clientId).toBe('client-1');
      expect(result.data?.record?.scopes).toEqual(['admin', 'chat']);
    });

    it('logs info messages', async () => {
      const tokenData = {
        clientId: 'client-1',
        token: createTestToken('client-1'),
        scopes: ['admin'],
        createdAt: '2024-01-01T00:00:00Z',
        expiresAt: '2099-01-01T00:00:00Z',
      };
      await writeFile(tokenPath, JSON.stringify(tokenData));
      
      await workflow.inspectToken();
      
      expect(mockContext.logger?.info).toHaveBeenCalled();
    });
  });

  describe('getTokenPath()', () => {
    it('returns the token path from context', () => {
      expect(workflow.getTokenPath()).toBe(tokenPath);
    });
  });

  describe('isEnabled()', () => {
    it('returns enabled status from context', () => {
      expect(workflow.isEnabled()).toBe(true);
      
      const disabledWorkflow = createBootstrapAdminWorkflow({
        ...mockContext,
        enabled: false,
      });
      
      expect(disabledWorkflow.isEnabled()).toBe(false);
    });
  });
});
