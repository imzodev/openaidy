import { describe, it, expect, beforeEach } from 'vitest';
import {
  AuthMiddleware,
  createAuthMiddleware,
  CAPABILITIES,
  type JWTPayload,
} from './auth';
import { defaultWebSocketConfig } from '../types';

describe('AuthMiddleware', () => {
  let middleware: AuthMiddleware;

  beforeEach(() => {
    middleware = createAuthMiddleware(defaultWebSocketConfig);
  });

  // ============================================================================
  // Token Generation
  // ============================================================================

  describe('generateToken', () => {
    it('should generate a valid token', async () => {
      const token = await middleware.generateToken({
        clientId: 'client-123',
        type: 'access',
        scopes: ['sessions.read', 'sessions.write'],
      });

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.split('.').length).toBe(3); // JWT has 3 parts
    });

    it('should include payload data in token', async () => {
      const token = await middleware.generateToken({
        clientId: 'client-123',
        type: 'access',
        scopes: ['admin'],
      });

      const payload = await middleware.validateToken(token);

      expect(payload).toBeDefined();
      expect(payload?.sub).toBe('client-123');
      expect(payload?.type).toBe('access');
      expect(payload?.scopes).toEqual(['admin']);
    });

    it('should set expiration time', async () => {
      const token = await middleware.generateToken({
        clientId: 'client-123',
        type: 'access',
        scopes: [],
        expiresIn: 3600000, // 1 hour
      });

      const payload = await middleware.validateToken(token);

      expect(payload?.exp).toBeDefined();
      expect(payload!.exp * 1000).toBeGreaterThan(Date.now());
    });

    it('should use default expiration if not specified', async () => {
      const token = await middleware.generateToken({
        clientId: 'client-123',
        type: 'access',
        scopes: [],
      });

      const payload = await middleware.validateToken(token);

      // Default is 24 hours
      expect(payload?.exp).toBeDefined();
    });

    it('should generate different tokens for different payloads', async () => {
      const token1 = await middleware.generateToken({
        clientId: 'client-1',
        type: 'access',
        scopes: [],
      });

      const token2 = await middleware.generateToken({
        clientId: 'client-2',
        type: 'access',
        scopes: [],
      });

      expect(token1).not.toBe(token2);
    });

    it('should generate refresh token', async () => {
      const token = await middleware.generateToken({
        clientId: 'client-123',
        type: 'refresh',
        scopes: [],
      });

      const payload = await middleware.validateToken(token);

      expect(payload?.type).toBe('refresh');
    });

    it('should generate pairing token', async () => {
      const token = await middleware.generateToken({
        clientId: 'device-123',
        type: 'pairing',
        scopes: ['pairing.approve'],
      });

      const payload = await middleware.validateToken(token);

      expect(payload?.type).toBe('pairing');
    });
  });

  // ============================================================================
  // Token Validation
  // ============================================================================

  describe('validateToken', () => {
    it('should validate a valid token', async () => {
      const token = await middleware.generateToken({
        clientId: 'client-123',
        type: 'access',
        scopes: ['sessions.read'],
      });

      const payload = await middleware.validateToken(token);

      expect(payload).toBeDefined();
      expect(payload?.sub).toBe('client-123');
      expect(payload?.scopes).toEqual(['sessions.read']);
    });

    it('should reject invalid token format', async () => {
      const payload = await middleware.validateToken('invalid-token');

      expect(payload).toBeNull();
    });

    it('should reject malformed JWT', async () => {
      const payload = await middleware.validateToken('a.b.c');

      expect(payload).toBeNull();
    });

    it('should reject token with tampered payload', async () => {
      const token = await middleware.generateToken({
        clientId: 'client-123',
        type: 'access',
        scopes: ['sessions.read'],
      });

      const parts = token.split('.');
      expect(parts).toHaveLength(3);

      const [header, payload, signature] = parts as [string, string, string];
      const decodedPayload = JSON.parse(
        Buffer.from(payload, 'base64url').toString('utf-8'),
      ) as JWTPayload;
      decodedPayload.scopes = ['config.write'];

      const tamperedPayload = Buffer.from(
        JSON.stringify(decodedPayload),
        'utf-8',
      ).toString('base64url');

      const tamperedToken = `${header}.${tamperedPayload}.${signature}`;
      const result = await middleware.validateToken(tamperedToken);

      expect(result).toBeNull();
    });

    it('should reject expired token', async () => {
      // Create token that expired 1 second ago
      const token = await middleware.generateToken({
        clientId: 'client-123',
        type: 'access',
        scopes: [],
        expiresIn: -1000, // Expired
      });

      const payload = await middleware.validateToken(token);

      expect(payload).toBeNull();
    });

    it('should reject token with missing subject', async () => {
      const malformedPayload = {
        type: 'access',
        scopes: [],
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
      };

      // Manually create malformed token (no 'sub' field)
      const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replace(/=/g, '');
      const payload = btoa(JSON.stringify(malformedPayload)).replace(/=/g, '');
      const malformedToken = `${header}.${payload}.signature`;

      const result = await middleware.validateToken(malformedToken);

      expect(result).toBeNull();
    });
  });

  // ============================================================================
  // Token Refresh
  // ============================================================================

  describe('refreshToken', () => {
    it('should refresh token with valid refresh token', async () => {
      const refreshToken = await middleware.generateToken({
        clientId: 'client-123',
        type: 'refresh',
        scopes: ['sessions.read', 'sessions.write'],
      });

      const newToken = await middleware.refreshToken(refreshToken);

      expect(newToken).toBeDefined();

      const payload = await middleware.validateToken(newToken!);
      expect(payload?.sub).toBe('client-123');
      expect(payload?.type).toBe('access');
      expect(payload?.scopes).toEqual(['sessions.read', 'sessions.write']);
    });

    it('should reject refresh with access token', async () => {
      const accessToken = await middleware.generateToken({
        clientId: 'client-123',
        type: 'access',
        scopes: [],
      });

      const newToken = await middleware.refreshToken(accessToken);

      expect(newToken).toBeNull();
    });

    it('should reject refresh with invalid token', async () => {
      const newToken = await middleware.refreshToken('invalid-token');

      expect(newToken).toBeNull();
    });
  });

  // ============================================================================
  // Capability Checking
  // ============================================================================

  describe('hasCapability', () => {
    it('should return true if capability is granted', () => {
      const scopes = ['sessions.read', 'sessions.write'];

      expect(middleware.hasCapability(scopes, 'sessions.read')).toBe(true);
      expect(middleware.hasCapability(scopes, 'sessions.write')).toBe(true);
    });

    it('should return false if capability is not granted', () => {
      const scopes = ['sessions.read'];

      expect(middleware.hasCapability(scopes, 'sessions.delete')).toBe(false);
      expect(middleware.hasCapability(scopes, 'admin')).toBe(false);
    });

    it('should return true for admin wildcard', () => {
      const scopes = ['*'];

      expect(middleware.hasCapability(scopes, 'sessions.read')).toBe(true);
      expect(middleware.hasCapability(scopes, 'admin')).toBe(true);
      expect(middleware.hasCapability(scopes, 'any-capability')).toBe(true);
    });

    it('should return false for empty scopes', () => {
      expect(middleware.hasCapability([], 'sessions.read')).toBe(false);
    });
  });

  describe('hasAnyCapability', () => {
    it('should return true if any capability is granted', () => {
      const scopes = ['sessions.read'];

      expect(
        middleware.hasAnyCapability(scopes, ['sessions.read', 'sessions.write']),
      ).toBe(true);
    });

    it('should return false if no capabilities are granted', () => {
      const scopes = ['sessions.read'];

      expect(
        middleware.hasAnyCapability(scopes, ['sessions.write', 'sessions.delete']),
      ).toBe(false);
    });

    it('should work with admin wildcard', () => {
      const scopes = ['*'];

      expect(
        middleware.hasAnyCapability(scopes, ['sessions.read', 'admin']),
      ).toBe(true);
    });
  });

  describe('hasAllCapabilities', () => {
    it('should return true if all capabilities are granted', () => {
      const scopes = ['sessions.read', 'sessions.write'];

      expect(
        middleware.hasAllCapabilities(scopes, ['sessions.read', 'sessions.write']),
      ).toBe(true);
    });

    it('should return false if some capabilities are missing', () => {
      const scopes = ['sessions.read'];

      expect(
        middleware.hasAllCapabilities(scopes, ['sessions.read', 'sessions.write']),
      ).toBe(false);
    });

    it('should work with admin wildcard', () => {
      const scopes = ['*'];

      expect(
        middleware.hasAllCapabilities(scopes, ['sessions.read', 'admin', 'config.read']),
      ).toBe(true);
    });
  });

  // ============================================================================
  // Authentication
  // ============================================================================

  describe('authenticate', () => {
    it('should authenticate with valid token', async () => {
      const token = await middleware.generateToken({
        clientId: 'client-123',
        type: 'access',
        scopes: ['sessions.read', 'sessions.write'],
      });

      const result = await middleware.authenticate(token);

      expect(result.success).toBe(true);
      expect(result.clientId).toBe('client-123');
      expect(result.capabilities).toEqual(['sessions.read', 'sessions.write']);
    });

    it('should reject invalid token', async () => {
      const result = await middleware.authenticate('invalid-token');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.code).toBe('AUTH_FAILED');
    });

    it('should reject expired token', async () => {
      const token = await middleware.generateToken({
        clientId: 'client-123',
        type: 'access',
        scopes: [],
        expiresIn: -1000,
      });

      const result = await middleware.authenticate(token);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('AUTH_FAILED');
    });
  });

  // ============================================================================
  // Authorization
  // ============================================================================

  describe('authorize', () => {
    it('should authorize if capability is granted', () => {
      const capabilities = ['sessions.read', 'sessions.write'];

      const result = middleware.authorize('sessions.read', capabilities);

      expect(result.authorized).toBe(true);
    });

    it('should reject if capability is missing', () => {
      const capabilities = ['sessions.read'];

      const result = middleware.authorize('sessions.delete', capabilities);

      expect(result.authorized).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.code).toBe('INSUFFICIENT_CAPABILITY');
    });

    it('should authorize with admin wildcard', () => {
      const capabilities = ['*'];

      const result = middleware.authorize('any-capability', capabilities);

      expect(result.authorized).toBe(true);
    });
  });

  // ============================================================================
  // Token Extraction
  // ============================================================================

  describe('extractFromHeader', () => {
    it('should extract token from Bearer header', () => {
      const token = middleware.extractFromHeader('Bearer my-token-123');

      expect(token).toBe('my-token-123');
    });

    it('should return null for non-Bearer header', () => {
      const token = middleware.extractFromHeader('Basic dXNlcjpwYXNz');

      expect(token).toBeNull();
    });

    it('should return null for empty header', () => {
      const token = middleware.extractFromHeader('');

      expect(token).toBeNull();
    });

    it('should handle extra whitespace', () => {
      const token = middleware.extractFromHeader('Bearer   my-token-123  ');

      expect(token).toBe('my-token-123');
    });
  });

  describe('extractFromQuery', () => {
    it('should extract token from query string', () => {
      const token = middleware.extractFromQuery({ token: 'my-token-123' });

      expect(token).toBe('my-token-123');
    });

    it('should return null if no token in query', () => {
      const token = middleware.extractFromQuery({ other: 'value' });

      expect(token).toBeNull();
    });

    it('should return null for undefined token', () => {
      const token = middleware.extractFromQuery({ token: undefined });

      expect(token).toBeNull();
    });
  });

  describe('extractFromPayload', () => {
    it('should extract token from payload', () => {
      const token = middleware.extractFromPayload({ token: 'my-token-123' });

      expect(token).toBe('my-token-123');
    });

    it('should return null if no token in payload', () => {
      const token = middleware.extractFromPayload({});

      expect(token).toBeNull();
    });
  });
});

// ============================================================================
// Capability Constants
// ============================================================================

describe('CAPABILITIES', () => {
  it('should have session capabilities', () => {
    expect(CAPABILITIES.SESSIONS_READ).toBe('sessions.read');
    expect(CAPABILITIES.SESSIONS_WRITE).toBe('sessions.write');
    expect(CAPABILITIES.SESSIONS_STREAM).toBe('sessions.stream');
    expect(CAPABILITIES.SESSIONS_DELETE).toBe('sessions.delete');
  });

  it('should have agent capabilities', () => {
    expect(CAPABILITIES.AGENTS_READ).toBe('agents.read');
    expect(CAPABILITIES.AGENTS_INVOKE).toBe('agents.invoke');
  });

  it('should have provider capabilities', () => {
    expect(CAPABILITIES.PROVIDERS_READ).toBe('providers.read');
    expect(CAPABILITIES.PROVIDERS_INVOKE).toBe('providers.invoke');
  });

  it('should have node capabilities', () => {
    expect(CAPABILITIES.NODE_INVOKE).toBe('node.invoke');
    expect(CAPABILITIES.NODE_DESCRIBE).toBe('node.describe');
  });

  it('should have config capabilities', () => {
    expect(CAPABILITIES.CONFIG_READ).toBe('config.read');
    expect(CAPABILITIES.CONFIG_WRITE).toBe('config.write');
  });

  it('should have pairing capabilities', () => {
    expect(CAPABILITIES.PAIRING_APPROVE).toBe('pairing.approve');
    expect(CAPABILITIES.PAIRING_DENY).toBe('pairing.deny');
  });

  it('should have system capabilities', () => {
    expect(CAPABILITIES.SYSTEM_RUN).toBe('system.run');
    expect(CAPABILITIES.SYSTEM_NOTIFY).toBe('system.notify');
  });

  it('should have admin wildcard', () => {
    expect(CAPABILITIES.ADMIN).toBe('*');
  });
});

// ============================================================================
// Factory Function
// ============================================================================

describe('createAuthMiddleware', () => {
  it('should create AuthMiddleware instance', () => {
    const middleware = createAuthMiddleware(defaultWebSocketConfig);

    expect(middleware).toBeInstanceOf(AuthMiddleware);
  });
});
