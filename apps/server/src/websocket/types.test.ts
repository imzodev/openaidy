import { describe, it, expect } from 'vitest';
import {
  webSocketConfigSchema,
  pairingConfigSchema,
  wsEnvSchema,
  createWebSocketConfig,
  createPairingConfig,
  validateWebSocketConfig,
  validatePairingConfig,
  isValidWebSocketConfig,
  isValidPairingConfig,
  defaultWebSocketConfig,
  defaultPairingConfig,
  type WebSocketConfig,
  type PairingConfig,
  type WSEnv,
} from './types';

describe('websocket types', () => {
  describe('webSocketConfigSchema', () => {
    it('should parse valid config', () => {
      const config = {
        enabled: true,
        port: 3001,
        path: '/ws',
        maxConnections: 1000,
        heartbeatInterval: 30000,
        auth: {
          required: true,
          tokenExpiry: 86400000,
          secret: 'my-super-secret-key-12345',
        },
        rateLimit: {
          max: 100,
          window: 60000,
        },
      };

      const result = webSocketConfigSchema.parse(config);
      expect(result.enabled).toBe(true);
      expect(result.port).toBe(3001);
      expect(result.path).toBe('/ws');
    });

    it('should apply defaults for missing fields (except port, which is now required per port-config-refactor)', () => {
      const config = { port: 3001 };
      const result = webSocketConfigSchema.parse(config);

      expect(result.enabled).toBe(true);
      expect(result.port).toBe(3001);
      expect(result.path).toBe('/ws');
      expect(result.maxConnections).toBe(1000);
      expect(result.heartbeatInterval).toBe(30000);
      expect(result.auth.required).toBe(true);
      expect(result.rateLimit.max).toBe(100);
    });

    it('should reject when port is missing (no silent 3001 fallback)', () => {
      const config = {};
      expect(() => webSocketConfigSchema.parse(config)).toThrow();
    });

    it('should reject invalid port', () => {
      const config = { port: -1 };
      expect(() => webSocketConfigSchema.parse(config)).toThrow();
    });

    it('should reject invalid path', () => {
      const config = { path: 123 };
      expect(() => webSocketConfigSchema.parse(config)).toThrow();
    });

    it('should reject zero maxConnections', () => {
      const config = { maxConnections: 0 };
      expect(() => webSocketConfigSchema.parse(config)).toThrow();
    });

    it('should reject secret shorter than 16 chars', () => {
      const config = {
        auth: { secret: 'short' },
      };
      expect(() => webSocketConfigSchema.parse(config)).toThrow();
    });
  });

  describe('pairingConfigSchema', () => {
    it('should parse valid config', () => {
      const config = {
        codeLength: 6,
        codeExpiryMs: 300000,
        maxPendingRequests: 100,
        defaultTokenExpiryMs: 2592000000,
        maxTokenExpiryMs: 7776000000,
        refreshTokenExpiryMs: 7776000000,
        maxAttemptsPerIp: 10,
        attemptWindowMs: 3600000,
        requireAdminApproval: true,
      };

      const result = pairingConfigSchema.parse(config);
      expect(result.codeLength).toBe(6);
      expect(result.requireAdminApproval).toBe(true);
    });

    it('should apply defaults for missing fields', () => {
      const config = {};
      const result = pairingConfigSchema.parse(config);

      expect(result.codeLength).toBe(6);
      expect(result.codeExpiryMs).toBe(300000);
      expect(result.requireAdminApproval).toBe(true);
    });

    it('should reject codeLength less than 4', () => {
      const config = { codeLength: 3 };
      expect(() => pairingConfigSchema.parse(config)).toThrow();
    });

    it('should reject codeLength greater than 12', () => {
      const config = { codeLength: 13 };
      expect(() => pairingConfigSchema.parse(config)).toThrow();
    });

    it('should allow optional auto-approve domains', () => {
      const config = {
        autoApproveDomains: ['example.com', 'trusted.org'],
      };
      const result = pairingConfigSchema.parse(config);
      expect(result.autoApproveDomains).toEqual(['example.com', 'trusted.org']);
    });

    it('should allow optional auto-approve capabilities', () => {
      const config = {
        autoApproveCapabilities: ['sessions.read', 'sessions.write'],
      };
      const result = pairingConfigSchema.parse(config);
      expect(result.autoApproveCapabilities).toEqual([
        'sessions.read',
        'sessions.write',
      ]);
    });
  });

  describe('wsEnvSchema', () => {
    it('should parse valid env vars', () => {
      const env = {
        WS_ENABLED: 'true',
        WS_PORT: '3001',
        WS_PATH: '/ws',
        WS_MAX_CONNECTIONS: '1000',
        WS_HEARTBEAT_INTERVAL: '30000',
        WS_AUTH_REQUIRED: 'true',
        WS_TOKEN_EXPIRY: '86400000',
        WS_TOKEN_SECRET: 'my-super-secret-key-12345',
        WS_RATE_LIMIT_MAX: '100',
        WS_RATE_LIMIT_WINDOW: '60000',
      };

      const result = wsEnvSchema.parse(env);
      expect(result.WS_ENABLED).toBe(true);
      expect(result.WS_PORT).toBe(3001);
      expect(result.WS_PATH).toBe('/ws');
    });

    it('should apply defaults for missing env vars (except WS_PORT, which is now required per port-config-refactor)', () => {
      const env = { WS_PORT: '3001' };
      const result = wsEnvSchema.parse(env);

      expect(result.WS_ENABLED).toBe(true);
      expect(result.WS_PORT).toBe(3001);
      expect(result.WS_PATH).toBe('/ws');
      expect(result.WS_MAX_CONNECTIONS).toBe(1000);
    });

    it('should reject when WS_PORT is missing (no silent 3001 fallback)', () => {
      const env = {};
      expect(() => wsEnvSchema.parse(env)).toThrow();
    });

    it('should parse "false" string as boolean false', () => {
      const env = { WS_ENABLED: 'false', WS_AUTH_REQUIRED: 'false' };
      const result = wsEnvSchema.parse(env);

      expect(result.WS_ENABLED).toBe(false);
      expect(result.WS_AUTH_REQUIRED).toBe(false);
    });

    it('should coerce string numbers to numbers', () => {
      const env = {
        WS_PORT: '8080',
        WS_MAX_CONNECTIONS: '500',
        WS_RATE_LIMIT_MAX: '200',
      };
      const result = wsEnvSchema.parse(env);

      expect(typeof result.WS_PORT).toBe('number');
      expect(result.WS_PORT).toBe(8080);
      expect(result.WS_MAX_CONNECTIONS).toBe(500);
      expect(result.WS_RATE_LIMIT_MAX).toBe(200);
    });
  });

  describe('createWebSocketConfig', () => {
    it('should create config from env vars', () => {
      const env = {
        WS_ENABLED: 'true',
        WS_PORT: '8080',
        WS_PATH: '/websocket',
        WS_MAX_CONNECTIONS: '500',
        WS_TOKEN_SECRET: 'my-production-secret-key!',
      };

      const config = createWebSocketConfig(env);

      expect(config.enabled).toBe(true);
      expect(config.port).toBe(8080);
      expect(config.path).toBe('/websocket');
      expect(config.maxConnections).toBe(500);
      expect(config.auth.secret).toBe('my-production-secret-key!');
    });

    it('should use defaults for missing env vars', () => {
      const config = createWebSocketConfig({});

      expect(config.enabled).toBe(true);
      expect(config.port).toBe(3001);
      expect(config.path).toBe('/ws');
      expect(config.maxConnections).toBe(1000);
    });

    it('should create nested auth config', () => {
      const env = {
        WS_AUTH_REQUIRED: 'false',
        WS_TOKEN_EXPIRY: '3600000',
      };
      const config = createWebSocketConfig(env);

      expect(config.auth.required).toBe(false);
      expect(config.auth.tokenExpiry).toBe(3600000);
    });

    it('should create nested rateLimit config', () => {
      const env = {
        WS_RATE_LIMIT_MAX: '200',
        WS_RATE_LIMIT_WINDOW: '120000',
      };
      const config = createWebSocketConfig(env);

      expect(config.rateLimit.max).toBe(200);
      expect(config.rateLimit.window).toBe(120000);
    });
  });

  describe('createPairingConfig', () => {
    it('should create config from env vars', () => {
      const env = {
        WS_PAIRING_CODE_LENGTH: '8',
        WS_PAIRING_CODE_EXPIRY_MS: '600000',
        WS_PAIRING_REQUIRE_ADMIN: 'false',
      };

      const config = createPairingConfig(env);

      expect(config.codeLength).toBe(8);
      expect(config.codeExpiryMs).toBe(600000);
      expect(config.requireAdminApproval).toBe(false);
    });

    it('should use defaults for missing env vars', () => {
      const config = createPairingConfig({});

      expect(config.codeLength).toBe(6);
      expect(config.codeExpiryMs).toBe(300000);
      expect(config.requireAdminApproval).toBe(true);
    });
  });

  describe('validateWebSocketConfig', () => {
    it('should validate and return valid config', () => {
      const config = {
        enabled: true,
        port: 3001,
        auth: { secret: 'my-super-secret-key!' },
        rateLimit: {},
      };

      const result = validateWebSocketConfig(config);
      expect(result.enabled).toBe(true);
    });

    it('should throw for invalid config', () => {
      const config = {
        port: -1,
      };

      expect(() => validateWebSocketConfig(config)).toThrow();
    });
  });

  describe('validatePairingConfig', () => {
    it('should validate and return valid config', () => {
      const config = {
        codeLength: 6,
        requireAdminApproval: true,
      };

      const result = validatePairingConfig(config);
      expect(result.codeLength).toBe(6);
    });

    it('should throw for invalid config', () => {
      const config = {
        codeLength: 2, // Too short
      };

      expect(() => validatePairingConfig(config)).toThrow();
    });
  });

  describe('isValidWebSocketConfig', () => {
    it('should return true for valid config', () => {
      const config = {
        enabled: true,
        port: 3001,
        auth: { secret: 'my-super-secret-key!' },
        rateLimit: { max: 100, window: 60000 },
      };

      expect(isValidWebSocketConfig(config)).toBe(true);
    });

    it('should return false for invalid config', () => {
      const config = {
        port: 'not-a-number',
      };

      expect(isValidWebSocketConfig(config)).toBe(false);
    });

    it('should return false for null', () => {
      expect(isValidWebSocketConfig(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isValidWebSocketConfig(undefined)).toBe(false);
    });
  });

  describe('isValidPairingConfig', () => {
    it('should return true for valid config', () => {
      const config = {
        codeLength: 6,
      };

      expect(isValidPairingConfig(config)).toBe(true);
    });

    it('should return false for invalid config', () => {
      const config = {
        codeLength: 20, // Too long
      };

      expect(isValidPairingConfig(config)).toBe(false);
    });
  });

  describe('defaultWebSocketConfig', () => {
    it('should have all expected properties', () => {
      expect(defaultWebSocketConfig.enabled).toBe(true);
      expect(defaultWebSocketConfig.port).toBe(3001);
      expect(defaultWebSocketConfig.path).toBe('/ws');
      expect(defaultWebSocketConfig.maxConnections).toBe(1000);
      expect(defaultWebSocketConfig.heartbeatInterval).toBe(30000);
      expect(defaultWebSocketConfig.auth.required).toBe(true);
      expect(defaultWebSocketConfig.auth.tokenExpiry).toBe(86400000);
      expect(defaultWebSocketConfig.rateLimit.max).toBe(100);
      expect(defaultWebSocketConfig.rateLimit.window).toBe(60000);
    });

    it('should be a valid WebSocketConfig', () => {
      expect(isValidWebSocketConfig(defaultWebSocketConfig)).toBe(true);
    });
  });

  describe('defaultPairingConfig', () => {
    it('should have all expected properties', () => {
      expect(defaultPairingConfig.codeLength).toBe(6);
      expect(defaultPairingConfig.codeExpiryMs).toBe(300000);
      expect(defaultPairingConfig.maxPendingRequests).toBe(100);
      expect(defaultPairingConfig.defaultTokenExpiryMs).toBe(2592000000);
      expect(defaultPairingConfig.requireAdminApproval).toBe(true);
      expect(defaultPairingConfig.maxAttemptsPerIp).toBe(10);
    });

    it('should be a valid PairingConfig', () => {
      expect(isValidPairingConfig(defaultPairingConfig)).toBe(true);
    });
  });

  describe('Type inference', () => {
    it('should correctly infer WebSocketConfig type', () => {
      const config: WebSocketConfig = defaultWebSocketConfig;
      expect(config.enabled).toBeDefined();
      expect(config.port).toBeDefined();
      expect(config.auth).toBeDefined();
      expect(config.rateLimit).toBeDefined();
    });

    it('should correctly infer PairingConfig type', () => {
      const config: PairingConfig = defaultPairingConfig;
      expect(config.codeLength).toBeDefined();
      expect(config.codeExpiryMs).toBeDefined();
      expect(config.requireAdminApproval).toBeDefined();
    });

    it('should correctly infer WSEnv type', () => {
      const env: WSEnv = wsEnvSchema.parse({ WS_PORT: '3001' });
      expect(env.WS_ENABLED).toBeDefined();
      expect(env.WS_PORT).toBeDefined();
      expect(env.WS_PATH).toBeDefined();
    });
  });

  describe('Edge cases', () => {
    it('should handle empty string env vars', () => {
      const env = {
        WS_ENABLED: '',
        WS_AUTH_REQUIRED: '',
      };
      const result = wsEnvSchema.parse(env);

      // Empty string is not 'true', so should be false
      expect(result.WS_ENABLED).toBe(false);
      expect(result.WS_AUTH_REQUIRED).toBe(false);
    });

    it('should handle very large port numbers', () => {
      const config = { port: 65535, auth: {}, rateLimit: {} };
      const result = webSocketConfigSchema.parse(config);
      expect(result.port).toBe(65535);
    });

    it('should handle custom paths', () => {
      const config = { path: '/api/v1/websocket', auth: {}, rateLimit: {} };
      const result = webSocketConfigSchema.parse(config);
      expect(result.path).toBe('/api/v1/websocket');
    });

    it('should handle zero values correctly', () => {
      // Zero should be rejected for positive numbers
      expect(() =>
        webSocketConfigSchema.parse({ maxConnections: 0 }),
      ).toThrow();
      expect(() =>
        webSocketConfigSchema.parse({ heartbeatInterval: 0 }),
      ).toThrow();
    });
  });
});
