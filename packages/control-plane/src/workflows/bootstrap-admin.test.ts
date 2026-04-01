/**
 * Control Plane - Bootstrap Admin Workflow Tests
 * 
 * Tests for the bootstrap admin workflow service.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  BootstrapAdminWorkflow,
  createBootstrapAdminWorkflow,
  type BootstrapAdminContext,
} from './bootstrap-admin.js';

// Mock the server module
vi.mock('@openaidy/server/bootstrap-admin-inspect', () => ({
  inspectBootstrapAdminToken: vi.fn(),
}));

describe('BootstrapAdminWorkflow', () => {
  let workflow: BootstrapAdminWorkflow;
  let mockContext: BootstrapAdminContext;

  beforeEach(() => {
    vi.clearAllMocks();
    
    mockContext = {
      enabled: true,
      tokenPath: '/test/.openaidy/credentials/bootstrap-admin.json',
      jwtSecret: 'test-secret',
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      } as any,
    };
    
    workflow = createBootstrapAdminWorkflow(mockContext);
  });

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

    it('returns valid status for valid token', async () => {
      const { inspectBootstrapAdminToken } = await import(
        '@openaidy/server/bootstrap-admin-inspect'
      );
      
      vi.mocked(inspectBootstrapAdminToken).mockResolvedValue({
        status: 'valid',
        tokenPath: mockContext.tokenPath,
        enabled: true,
        record: {
          clientId: 'test-client',
          token: 'test-token',
          scopes: ['admin'],
          createdAt: '2024-01-01T00:00:00Z',
          expiresAt: '2025-01-01T00:00:00Z',
        },
      });
      
      const result = await workflow.inspectToken();
      
      expect(result.success).toBe(true);
      expect(result.data?.status).toBe('valid');
      expect(result.data?.record?.clientId).toBe('test-client');
    });

    it('returns missing status when token file not found', async () => {
      const { inspectBootstrapAdminToken } = await import(
        '@openaidy/server/bootstrap-admin-inspect'
      );
      
      vi.mocked(inspectBootstrapAdminToken).mockResolvedValue({
        status: 'missing',
        tokenPath: mockContext.tokenPath,
        enabled: true,
        error: 'Token file not found',
      });
      
      const result = await workflow.inspectToken();
      
      expect(result.success).toBe(true);
      expect(result.data?.status).toBe('missing');
    });

    it('returns expired status for expired token', async () => {
      const { inspectBootstrapAdminToken } = await import(
        '@openaidy/server/bootstrap-admin-inspect'
      );
      
      vi.mocked(inspectBootstrapAdminToken).mockResolvedValue({
        status: 'expired',
        tokenPath: mockContext.tokenPath,
        enabled: true,
        error: 'Token expired at 2024-01-01T00:00:00Z',
        record: {
          clientId: 'test-client',
          token: 'expired-token',
          scopes: ['admin'],
          createdAt: '2023-01-01T00:00:00Z',
          expiresAt: '2024-01-01T00:00:00Z',
        },
      });
      
      const result = await workflow.inspectToken();
      
      expect(result.success).toBe(true);
      expect(result.data?.status).toBe('expired');
    });

    it('returns invalid status for invalid token', async () => {
      const { inspectBootstrapAdminToken } = await import(
        '@openaidy/server/bootstrap-admin-inspect'
      );
      
      vi.mocked(inspectBootstrapAdminToken).mockResolvedValue({
        status: 'invalid',
        tokenPath: mockContext.tokenPath,
        enabled: true,
        error: 'Token has invalid signature',
      });
      
      const result = await workflow.inspectToken();
      
      expect(result.success).toBe(true);
      expect(result.data?.status).toBe('invalid');
    });

    it('returns malformed status for malformed token file', async () => {
      const { inspectBootstrapAdminToken } = await import(
        '@openaidy/server/bootstrap-admin-inspect'
      );
      
      vi.mocked(inspectBootstrapAdminToken).mockResolvedValue({
        status: 'malformed',
        tokenPath: mockContext.tokenPath,
        enabled: true,
        error: 'Token file contains invalid JSON',
      });
      
      const result = await workflow.inspectToken();
      
      expect(result.success).toBe(true);
      expect(result.data?.status).toBe('malformed');
    });
  });

  describe('getTokenPath()', () => {
    it('returns the token path from context', () => {
      expect(workflow.getTokenPath()).toBe(mockContext.tokenPath);
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
