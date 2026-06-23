/**
 * WebSocket Configuration Types
 *
 * Configuration types for the WebSocket gateway, including
 * environment variables, runtime configuration, and pairing settings.
 */

import { z } from 'zod';
import type { ClientType } from '@openaidy/shared-types';
import { DEFAULT_SERVER_PORT } from '@openaidy/config';

// ============================================================================
// WebSocket Configuration Schema
// ============================================================================

/**
 * Default auth config
 */
const defaultAuthConfig = {
  required: true,
  tokenExpiry: 86400000, // 24 hours
  secret: 'change-me-in-production',
};

/**
 * WebSocket authentication configuration
 */
export const wsAuthConfigSchema = z
  .object({
    /** Whether authentication is required */
    required: z.boolean().default(true),
    /** Token expiry time in milliseconds */
    tokenExpiry: z.number().positive().default(86400000), // 24 hours
    /** Secret key for signing tokens */
    secret: z.string().min(16).default('change-me-in-production'),
  })
  .default(defaultAuthConfig);

export type WSAuthConfig = z.infer<typeof wsAuthConfigSchema>;

/**
 * Default rate limit config
 */
const defaultRateLimitConfig = {
  max: 100,
  window: 60000, // 1 minute
};

/**
 * WebSocket rate limiting configuration
 */
export const wsRateLimitConfigSchema = z
  .object({
    /** Maximum requests per window */
    max: z.number().int().positive().default(100),
    /** Window duration in milliseconds */
    window: z.number().positive().default(60000), // 1 minute
  })
  .default(defaultRateLimitConfig);

export type WSRateLimitConfig = z.infer<typeof wsRateLimitConfigSchema>;

/**
 * WebSocket gateway configuration
 */
export const webSocketConfigSchema = z.object({
  /** Whether WebSocket is enabled */
  enabled: z.boolean().default(true),
  /** Port to listen on (defaults to HTTP server port) */
  port: z.number().int().positive().default(DEFAULT_SERVER_PORT),
  /** WebSocket endpoint path */
  path: z.string().default('/ws'),
  /** Maximum concurrent connections */
  maxConnections: z.number().int().positive().default(1000),
  /** Heartbeat interval in milliseconds */
  heartbeatInterval: z.number().positive().default(30000), // 30 seconds
  /** Authentication configuration */
  auth: wsAuthConfigSchema,
  /** Rate limiting configuration */
  rateLimit: wsRateLimitConfigSchema,
});

export type WebSocketConfig = z.infer<typeof webSocketConfigSchema>;

// ============================================================================
// Pairing Configuration Schema
// ============================================================================

/**
 * Device pairing configuration
 */
export const pairingConfigSchema = z.object({
  /** Length of pairing codes */
  codeLength: z.number().int().min(4).max(12).default(6),
  /** Pairing code expiry time in milliseconds */
  codeExpiryMs: z.number().positive().default(300000), // 5 minutes
  /** Maximum pending pairing requests */
  maxPendingRequests: z.number().int().positive().default(100),
  /** Default token expiry time in milliseconds */
  defaultTokenExpiryMs: z.number().positive().default(2592000000), // 30 days
  /** Maximum token expiry time in milliseconds */
  maxTokenExpiryMs: z.number().positive().default(7776000000), // 90 days
  /** Refresh token expiry time in milliseconds */
  refreshTokenExpiryMs: z.number().positive().default(7776000000), // 90 days
  /** Maximum pairing attempts per IP */
  maxAttemptsPerIp: z.number().int().positive().default(10),
  /** Window for counting attempts in milliseconds */
  attemptWindowMs: z.number().positive().default(3600000), // 1 hour
  /** Whether admin approval is required */
  requireAdminApproval: z.boolean().default(true),
  /** Domains to auto-approve */
  autoApproveDomains: z.array(z.string()).optional(),
  /** Capabilities to auto-approve */
  autoApproveCapabilities: z.array(z.string()).optional(),
});

export type PairingConfig = z.infer<typeof pairingConfigSchema>;

// ============================================================================
// Environment Variable Parsing
// ============================================================================

/**
 * WebSocket environment variables schema
 */
export const wsEnvSchema = z.object({
  WS_ENABLED: z
    .string()
    .transform((val) => val === 'true')
    .default('true'),
  WS_PORT: z.coerce.number().int().positive().default(DEFAULT_SERVER_PORT),
  WS_PATH: z.string().default('/ws'),
  WS_MAX_CONNECTIONS: z.coerce.number().int().positive().default(1000),
  WS_HEARTBEAT_INTERVAL: z.coerce.number().positive().default(30000),
  WS_AUTH_REQUIRED: z
    .string()
    .transform((val) => val === 'true')
    .default('true'),
  WS_TOKEN_EXPIRY: z.coerce.number().positive().default(86400000),
  WS_TOKEN_SECRET: z.string().default('change-me-in-production'),
  WS_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  WS_RATE_LIMIT_WINDOW: z.coerce.number().positive().default(60000),
  // Pairing env vars
  WS_PAIRING_CODE_LENGTH: z.coerce.number().int().min(4).max(12).default(6),
  WS_PAIRING_CODE_EXPIRY_MS: z.coerce.number().positive().default(300000),
  WS_PAIRING_MAX_PENDING: z.coerce.number().int().positive().default(100),
  WS_PAIRING_TOKEN_EXPIRY_MS: z.coerce.number().positive().default(2592000000),
  WS_PAIRING_REQUIRE_ADMIN: z
    .string()
    .transform((val) => val !== 'false')
    .default('true'),
});

export type WSEnv = z.infer<typeof wsEnvSchema>;

/**
 * Parse WebSocket environment variables
 */
export function parseWSEnv(source: NodeJS.ProcessEnv): WSEnv {
  return wsEnvSchema.parse(source);
}

// ============================================================================
// Configuration Factory Functions
// ============================================================================

/**
 * Create WebSocket configuration from environment variables
 */
export function createWebSocketConfig(
  env: NodeJS.ProcessEnv = process.env,
): WebSocketConfig {
  const parsed = parseWSEnv(env);

  return {
    enabled: parsed.WS_ENABLED,
    port: parsed.WS_PORT,
    path: parsed.WS_PATH,
    maxConnections: parsed.WS_MAX_CONNECTIONS,
    heartbeatInterval: parsed.WS_HEARTBEAT_INTERVAL,
    auth: {
      required: parsed.WS_AUTH_REQUIRED,
      tokenExpiry: parsed.WS_TOKEN_EXPIRY,
      secret: parsed.WS_TOKEN_SECRET,
    },
    rateLimit: {
      max: parsed.WS_RATE_LIMIT_MAX,
      window: parsed.WS_RATE_LIMIT_WINDOW,
    },
  };
}

/**
 * Create pairing configuration from environment variables
 */
export function createPairingConfig(
  env: NodeJS.ProcessEnv = process.env,
): PairingConfig {
  const parsed = parseWSEnv(env);

  return {
    codeLength: parsed.WS_PAIRING_CODE_LENGTH,
    codeExpiryMs: parsed.WS_PAIRING_CODE_EXPIRY_MS,
    maxPendingRequests: parsed.WS_PAIRING_MAX_PENDING,
    defaultTokenExpiryMs: parsed.WS_PAIRING_TOKEN_EXPIRY_MS,
    maxTokenExpiryMs: 7776000000, // 90 days
    refreshTokenExpiryMs: 7776000000, // 90 days
    maxAttemptsPerIp: 10,
    attemptWindowMs: 3600000, // 1 hour
    requireAdminApproval: parsed.WS_PAIRING_REQUIRE_ADMIN,
  };
}

// ============================================================================
// Configuration Validation
// ============================================================================

/**
 * Validate WebSocket configuration
 *
 * Throws an error if configuration is invalid.
 */
export function validateWebSocketConfig(config: unknown): WebSocketConfig {
  return webSocketConfigSchema.parse(config);
}

/**
 * Validate pairing configuration
 *
 * Throws an error if configuration is invalid.
 */
export function validatePairingConfig(config: unknown): PairingConfig {
  return pairingConfigSchema.parse(config);
}

/**
 * Check if WebSocket configuration is valid
 */
export function isValidWebSocketConfig(
  config: unknown,
): config is WebSocketConfig {
  const result = webSocketConfigSchema.safeParse(config);
  return result.success;
}

/**
 * Check if pairing configuration is valid
 */
export function isValidPairingConfig(config: unknown): config is PairingConfig {
  const result = pairingConfigSchema.safeParse(config);
  return result.success;
}

// ============================================================================
// Default Configuration
// ============================================================================

/**
 * Default WebSocket configuration
 */
export const defaultWebSocketConfig: WebSocketConfig = {
  enabled: true,
  port: DEFAULT_SERVER_PORT,
  path: '/ws',
  maxConnections: 1000,
  heartbeatInterval: 30000,
  auth: {
    required: true,
    tokenExpiry: 86400000,
    secret: 'change-me-in-production',
  },
  rateLimit: {
    max: 100,
    window: 60000,
  },
};

/**
 * Default pairing configuration
 */
export const defaultPairingConfig: PairingConfig = {
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

// ============================================================================
// Connection Types
// ============================================================================

/**
 * Connection status
 */
export type ConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'disconnecting'
  | 'disconnected';

/**
 * Connection context information
 */
export type ConnectionContext = {
  /** Unique connection ID */
  id: string;
  /** Connection status */
  status: ConnectionStatus;
  /** Whether the connection is authenticated */
  authenticated: boolean;
  /** Client ID (set after authentication) */
  clientId?: string;
  /** Client type (set after authentication) */
  clientType?: ClientType;
  /** Client version (set after authentication) */
  clientVersion?: string;
  /** Granted capabilities */
  capabilities: string[];
  /** Active subscriptions */
  subscriptions: Set<string>;
  /** Last heartbeat timestamp */
  lastHeartbeat: number;
  /** Connection creation timestamp */
  createdAt: number;
  /** Connection metadata */
  metadata: Record<string, unknown>;
};

// ============================================================================
// Rate Limiter Types
// ============================================================================

/**
 * Rate limit info
 */
export type RateLimitInfo = {
  /** Remaining requests in current window */
  remaining: number;
  /** Unix timestamp when the window resets */
  reset: number;
  /** Maximum requests per window */
  limit: number;
};

/**
 * Rate limit check result
 */
export type RateLimitResult = {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Rate limit information */
  info: RateLimitInfo;
};
