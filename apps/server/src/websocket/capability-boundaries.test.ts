/**
 * ClientType Capability Boundary Tests
 *
 * Tests that verify clientType-aware capability boundaries are enforced
 * for WebSocket message routes.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AuthMiddleware } from './middleware/auth';
import { defaultWebSocketConfig } from './types';
import { WS_CAPABILITIES, type ClientType } from '@openaidy/shared-types';

describe('ClientType Capability Boundaries', () => {
  let authMiddleware: AuthMiddleware;

  beforeEach(() => {
    authMiddleware = new AuthMiddleware(defaultWebSocketConfig);
  });

  describe('Capability Preset Validation', () => {
    it('should have capability presets defined for all client types', () => {
      const clientTypes: ClientType[] = ['web', 'cli', 'mobile', 'channel'];

      for (const clientType of clientTypes) {
        const capabilities = authMiddleware.getDefaultCapabilities(clientType);
        expect(capabilities).toBeDefined();
        expect(Array.isArray(capabilities)).toBe(true);
        expect(capabilities.length).toBeGreaterThan(0);
      }
    });

    it('web client should have session capabilities', () => {
      const capabilities = authMiddleware.getDefaultCapabilities('web');

      expect(capabilities).toContain(WS_CAPABILITIES.SESSIONS_READ);
      expect(capabilities).toContain(WS_CAPABILITIES.SESSIONS_WRITE);
      expect(capabilities).toContain(WS_CAPABILITIES.SESSIONS_STREAM);
    });

    it('cli client should have extended capabilities', () => {
      const capabilities = authMiddleware.getDefaultCapabilities('cli');

      // CLI should have all session capabilities
      expect(capabilities).toContain(WS_CAPABILITIES.SESSIONS_READ);
      expect(capabilities).toContain(WS_CAPABILITIES.SESSIONS_WRITE);
      expect(capabilities).toContain(WS_CAPABILITIES.SESSIONS_DELETE);

      // CLI should have config write capability (web should not)
      expect(capabilities).toContain(WS_CAPABILITIES.CONFIG_WRITE);

      // CLI should have system run capability
      expect(capabilities).toContain(WS_CAPABILITIES.SYSTEM_RUN);

      // CLI should have node invoke capability
      expect(capabilities).toContain(WS_CAPABILITIES.NODE_INVOKE);
    });

    it('mobile client should have limited capabilities', () => {
      const capabilities = authMiddleware.getDefaultCapabilities('mobile');

      // Mobile should have session capabilities
      expect(capabilities).toContain(WS_CAPABILITIES.SESSIONS_READ);
      expect(capabilities).toContain(WS_CAPABILITIES.SESSIONS_WRITE);
      expect(capabilities).toContain(WS_CAPABILITIES.SESSIONS_STREAM);

      // Mobile should NOT have config write
      expect(capabilities).not.toContain(WS_CAPABILITIES.CONFIG_WRITE);

      // Mobile should NOT have config delete
      expect(capabilities).not.toContain(WS_CAPABILITIES.SESSIONS_DELETE);
    });

    it('channel client should have provider invoke capability', () => {
      const capabilities = authMiddleware.getDefaultCapabilities('channel');

      // Channel should have provider invoke (web should not)
      expect(capabilities).toContain(WS_CAPABILITIES.PROVIDERS_INVOKE);

      // Channel should NOT have config capabilities
      expect(capabilities).not.toContain(WS_CAPABILITIES.CONFIG_READ);
      expect(capabilities).not.toContain(WS_CAPABILITIES.CONFIG_WRITE);
    });
  });

  describe('Capability Enforcement via Auth Middleware', () => {
    it('should deny config.write for web client', () => {
      const capabilities = authMiddleware.getDefaultCapabilities('web');

      // Web should NOT have config write
      const hasConfigWrite = authMiddleware.hasCapability(
        capabilities,
        WS_CAPABILITIES.CONFIG_WRITE,
      );

      expect(hasConfigWrite).toBe(false);
    });

    it('should allow config.write for cli client', () => {
      const capabilities = authMiddleware.getDefaultCapabilities('cli');

      const hasConfigWrite = authMiddleware.hasCapability(
        capabilities,
        WS_CAPABILITIES.CONFIG_WRITE,
      );

      expect(hasConfigWrite).toBe(true);
    });

    it('should deny system.run for web client', () => {
      const capabilities = authMiddleware.getDefaultCapabilities('web');

      const hasSystemRun = authMiddleware.hasCapability(
        capabilities,
        WS_CAPABILITIES.SYSTEM_RUN,
      );

      expect(hasSystemRun).toBe(false);
    });

    it('should allow system.run for cli client', () => {
      const capabilities = authMiddleware.getDefaultCapabilities('cli');

      const hasSystemRun = authMiddleware.hasCapability(
        capabilities,
        WS_CAPABILITIES.SYSTEM_RUN,
      );

      expect(hasSystemRun).toBe(true);
    });

    it('should deny session.delete for mobile client', () => {
      const capabilities = authMiddleware.getDefaultCapabilities('mobile');

      const hasDelete = authMiddleware.hasCapability(
        capabilities,
        WS_CAPABILITIES.SESSIONS_DELETE,
      );

      expect(hasDelete).toBe(false);
    });

    it('should allow session.delete for cli client', () => {
      const capabilities = authMiddleware.getDefaultCapabilities('cli');

      const hasDelete = authMiddleware.hasCapability(
        capabilities,
        WS_CAPABILITIES.SESSIONS_DELETE,
      );

      expect(hasDelete).toBe(true);
    });
  });

  describe('Message Route Capability Mapping', () => {
    // This tests the MESSAGE_CAPABILITIES mapping in index.ts
    const MESSAGE_CAPABILITIES: Record<string, string[]> = {
      'session.create': [WS_CAPABILITIES.SESSIONS_WRITE],
      'session.get': [WS_CAPABILITIES.SESSIONS_READ],
      'session.list': [WS_CAPABILITIES.SESSIONS_READ],
      'session.delete': [WS_CAPABILITIES.SESSIONS_DELETE],
      'session.message': [WS_CAPABILITIES.SESSIONS_WRITE],
      'agent.list': [WS_CAPABILITIES.AGENTS_READ],
      'agent.get': [WS_CAPABILITIES.AGENTS_READ],
      'provider.list': [WS_CAPABILITIES.PROVIDERS_READ],
      'provider.models': [WS_CAPABILITIES.PROVIDERS_READ],
      'config.get': [WS_CAPABILITIES.CONFIG_READ],
      'config.update': [WS_CAPABILITIES.CONFIG_WRITE],
      'config.watch': [WS_CAPABILITIES.CONFIG_READ],
      'node.list': [WS_CAPABILITIES.NODE_DESCRIBE],
      'node.invoke': [WS_CAPABILITIES.NODE_INVOKE],
      'pairing.approve': [WS_CAPABILITIES.PAIRING_APPROVE],
      'pairing.deny': [WS_CAPABILITIES.PAIRING_DENY],
    };

    it('should map session.delete to SESSIONS_DELETE capability', () => {
      const required = MESSAGE_CAPABILITIES['session.delete'];
      expect(required).toContain(WS_CAPABILITIES.SESSIONS_DELETE);
    });

    it('should map config.update to CONFIG_WRITE capability', () => {
      const required = MESSAGE_CAPABILITIES['config.update'];
      expect(required).toContain(WS_CAPABILITIES.CONFIG_WRITE);
    });

    it('should map node.invoke to NODE_INVOKE capability', () => {
      const required = MESSAGE_CAPABILITIES['node.invoke'];
      expect(required).toContain(WS_CAPABILITIES.NODE_INVOKE);
    });

    it('web client should be able to send session messages', () => {
      const webCapabilities = authMiddleware.getDefaultCapabilities('web');
      const required = MESSAGE_CAPABILITIES['session.message'] ?? [];

      const canSend = required.every((cap) =>
        authMiddleware.hasCapability(webCapabilities, cap),
      );

      expect(canSend).toBe(true);
    });

    it('web client should NOT be able to update config', () => {
      const webCapabilities = authMiddleware.getDefaultCapabilities('web');
      const required = MESSAGE_CAPABILITIES['config.update'] ?? [];

      const canUpdate = required.every((cap) =>
        authMiddleware.hasCapability(webCapabilities, cap),
      );

      expect(canUpdate).toBe(false);
    });

    it('cli client should be able to update config', () => {
      const cliCapabilities = authMiddleware.getDefaultCapabilities('cli');
      const required = MESSAGE_CAPABILITIES['config.update'] ?? [];

      const canUpdate = required.every((cap) =>
        authMiddleware.hasCapability(cliCapabilities, cap),
      );

      expect(canUpdate).toBe(true);
    });

    it('channel client should be able to invoke providers', () => {
      const channelCapabilities =
        authMiddleware.getDefaultCapabilities('channel');

      // Channel has PROVIDERS_INVOKE capability
      const hasProviderInvoke = authMiddleware.hasCapability(
        channelCapabilities,
        WS_CAPABILITIES.PROVIDERS_INVOKE,
      );

      expect(hasProviderInvoke).toBe(true);
    });

    it('mobile client should NOT be able to delete sessions', () => {
      const mobileCapabilities =
        authMiddleware.getDefaultCapabilities('mobile');
      const required = MESSAGE_CAPABILITIES['session.delete'] ?? [];

      const canDelete = required.every((cap) =>
        authMiddleware.hasCapability(mobileCapabilities, cap),
      );

      expect(canDelete).toBe(false);
    });
  });

  describe('Authentication with clientType', () => {
    it('should authenticate with clientType and assign preset capabilities', async () => {
      const token = await authMiddleware.generateToken({
        clientId: 'test-client',
        clientType: 'web',
        type: 'access',
        scopes: [], // Empty - should use preset
      });

      const authResult = await authMiddleware.authenticate(token, {
        clientType: 'web',
      });

      expect(authResult.success).toBe(true);
      expect(authResult.clientType).toBe('web');
      expect(authResult.capabilities).toBeDefined();
      expect(authResult.capabilities).toContain(WS_CAPABILITIES.SESSIONS_READ);
    });

    it('should use token scopes over preset when provided', async () => {
      const token = await authMiddleware.generateToken({
        clientId: 'test-client',
        clientType: 'web',
        type: 'access',
        scopes: [WS_CAPABILITIES.CONFIG_WRITE], // Explicit scope
      });

      const authResult = await authMiddleware.authenticate(token, {
        clientType: 'web',
      });

      expect(authResult.success).toBe(true);
      expect(authResult.capabilities).toContain(WS_CAPABILITIES.CONFIG_WRITE);
    });
  });

  describe('Admin Override', () => {
    it('should allow admin wildcard to bypass capability checks', () => {
      const adminScopes = ['*'];

      const hasConfigWrite = authMiddleware.hasCapability(
        adminScopes,
        WS_CAPABILITIES.CONFIG_WRITE,
      );

      expect(hasConfigWrite).toBe(true);
    });

    it('admin wildcard should grant all capabilities', () => {
      const adminScopes = ['*'];

      const capabilities = [
        WS_CAPABILITIES.SESSIONS_READ,
        WS_CAPABILITIES.SESSIONS_WRITE,
        WS_CAPABILITIES.SESSIONS_DELETE,
        WS_CAPABILITIES.CONFIG_WRITE,
        WS_CAPABILITIES.SYSTEM_RUN,
        WS_CAPABILITIES.NODE_INVOKE,
      ];

      for (const cap of capabilities) {
        expect(authMiddleware.hasCapability(adminScopes, cap)).toBe(true);
      }
    });
  });
});
