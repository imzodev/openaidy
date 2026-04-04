/**
 * Authentication Middleware
 *
 * Validates JWT tokens, extracts client identity, and enforces
 * capability-based authorization for WebSocket connections.
 */

import type { WebSocketConfig } from '../types';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ClientType } from '@openaidy/shared-types';
import { getCapabilityPreset } from '../capability-presets';

// ============================================================================
// Types
// ============================================================================

/**
 * JWT payload structure
 */
export type JWTPayload = {
  /** Subject - client ID */
  sub: string;
  /** Client type */
  clientType?: ClientType;
  /** Client version */
  clientVersion?: string;
  /** Token type */
  type: 'access' | 'refresh' | 'pairing';
  /** Granted scopes/capabilities */
  scopes: string[];
  /** Expiration timestamp (seconds) */
  exp: number;
  /** Issued at timestamp (seconds) */
  iat: number;
  /** Issuer */
  iss?: string;
  /** JWT ID */
  jti?: string;
};

/**
 * Token generation options
 */
export type TokenOptions = {
  /** Client ID */
  clientId: string;
  /** Client type */
  clientType?: ClientType;
  /** Client version */
  clientVersion?: string;
  /** Token type */
  type: JWTPayload['type'];
  /** Granted capabilities */
  scopes: string[];
  /** Expiration time in milliseconds */
  expiresIn?: number;
  /** JWT ID */
  jti?: string;
};

/**
 * Authentication result
 */
export type AuthResult = {
  success: boolean;
  clientId?: string;
  clientType?: ClientType;
  clientVersion?: string;
  capabilities?: string[];
  error?: {
    code: string;
    message: string;
  };
};

/**
 * Capability constants
 */
export const CAPABILITIES = {
  // Session capabilities
  SESSIONS_READ: 'sessions.read',
  SESSIONS_WRITE: 'sessions.write',
  SESSIONS_STREAM: 'sessions.stream',
  SESSIONS_DELETE: 'sessions.delete',

  // Agent capabilities
  AGENTS_READ: 'agents.read',
  AGENTS_INVOKE: 'agents.invoke',

  // Provider capabilities
  PROVIDERS_READ: 'providers.read',
  PROVIDERS_INVOKE: 'providers.invoke',

  // Node capabilities
  NODE_INVOKE: 'node.invoke',
  NODE_DESCRIBE: 'node.describe',

  // Config capabilities
  CONFIG_READ: 'config.read',
  CONFIG_WRITE: 'config.write',

  // Pairing capabilities
  PAIRING_APPROVE: 'pairing.approve',
  PAIRING_DENY: 'pairing.deny',

  // System capabilities
  SYSTEM_RUN: 'system.run',
  SYSTEM_NOTIFY: 'system.notify',

  // Admin wildcard
  ADMIN: '*',
} as const;

export type Capability = (typeof CAPABILITIES)[keyof typeof CAPABILITIES];

export type AuthenticateOptions = {
  clientType?: ClientType;
  clientVersion?: string;
};

// ============================================================================
// Auth Middleware Class
// ============================================================================

/**
 * Authentication middleware for WebSocket connections
 *
 * Handles JWT token validation, capability checking, and token management.
 */
export class AuthMiddleware {
  private secret: string;
  private tokenExpiry: number;

  constructor(config: WebSocketConfig) {
    this.secret = config.auth.secret;
    this.tokenExpiry = config.auth.tokenExpiry;
  }

  // ============================================================================
  // Token Validation
  // ============================================================================

  /**
   * Validate a JWT token
   *
   * @returns JWT payload if valid, null if invalid
   */
  async validateToken(token: string): Promise<JWTPayload | null> {
    try {
      if (!this.verifyToken(token)) {
        return null;
      }

      const payload = this.decodeToken(token);

      if (!payload) {
        return null;
      }

      // Check expiration
      if (payload.exp && payload.exp * 1000 < Date.now()) {
        return null;
      }

      // Validate required fields
      if (!payload.sub || !payload.scopes || !Array.isArray(payload.scopes)) {
        return null;
      }

      return payload;
    } catch {
      return null;
    }
  }

  /**
   * Decode a JWT token without validation
   */
  private decodeToken(token: string): JWTPayload | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) {
        return null;
      }

      const payloadPart = parts[1];
      if (!payloadPart) {
        return null;
      }

      // Decode payload (middle part)
      const payload = JSON.parse(
        this.base64UrlDecode(payloadPart),
      ) as JWTPayload;

      return payload;
    } catch {
      return null;
    }
  }

  /**
   * Decode base64url string
   */
  private base64UrlDecode(str: string): string {
    return Buffer.from(str, 'base64url').toString('utf-8');
  }

  // ============================================================================
  // Token Generation
  // ============================================================================

  /**
   * Generate a JWT token
   */
  async generateToken(options: TokenOptions): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const expiresIn = options.expiresIn ?? this.tokenExpiry;
    const exp = now + Math.floor(expiresIn / 1000);

    const payload: JWTPayload = {
      sub: options.clientId,
      type: options.type,
      scopes: options.scopes,
      iat: now,
      exp,
      jti: options.jti ?? crypto.randomUUID(),
      ...(options.clientType ? { clientType: options.clientType } : {}),
      ...(options.clientVersion
        ? { clientVersion: options.clientVersion }
        : {}),
    };

    return this.encodeToken(payload);
  }

  /**
   * Encode a JWT payload
   */
  private encodeToken(payload: JWTPayload): string {
    const header = { alg: 'HS256', typ: 'JWT' };
    const headerB64 = this.base64UrlEncode(JSON.stringify(header));
    const payloadB64 = this.base64UrlEncode(JSON.stringify(payload));
    const signature = this.sign(`${headerB64}.${payloadB64}`);

    return `${headerB64}.${payloadB64}.${signature}`;
  }

  /**
   * Encode string to base64url
   */
  private base64UrlEncode(str: string): string {
    return Buffer.from(str, 'utf-8').toString('base64url');
  }

  /**
   * Sign data with secret (simple HMAC simulation)
   */
  private sign(data: string): string {
    return createHmac('sha256', this.secret).update(data).digest('base64url');
  }

  /**
   * Verify token signature
   */
  private verifyToken(token: string): boolean {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) {
        return false;
      }

      const [header, payload, signature] = parts;
      if (!header || !payload || !signature) {
        return false;
      }
      const expectedSignature = this.sign(`${header}.${payload}`);
      const provided = Buffer.from(signature, 'utf-8');
      const expected = Buffer.from(expectedSignature, 'utf-8');

      if (provided.length !== expected.length) {
        return false;
      }

      return timingSafeEqual(provided, expected);
    } catch {
      return false;
    }
  }

  /**
   * Refresh an access token using a refresh token
   */
  async refreshToken(refreshToken: string): Promise<string | null> {
    const payload = await this.validateToken(refreshToken);

    if (!payload || payload.type !== 'refresh') {
      return null;
    }

    // Generate new access token with same scopes
    return this.generateToken({
      clientId: payload.sub,
      type: 'access',
      scopes: payload.scopes,
      ...(payload.clientType ? { clientType: payload.clientType } : {}),
      ...(payload.clientVersion
        ? { clientVersion: payload.clientVersion }
        : {}),
    });
  }

  // ============================================================================
  // Capability Checking
  // ============================================================================

  /**
   * Check if a capability is granted
   */
  hasCapability(scopes: string[], capability: string): boolean {
    // Admin wildcard grants all capabilities
    if (scopes.includes(CAPABILITIES.ADMIN)) {
      return true;
    }

    return scopes.includes(capability);
  }

  /**
   * Check if any of the capabilities are granted
   */
  hasAnyCapability(scopes: string[], capabilities: string[]): boolean {
    return capabilities.some((cap) => this.hasCapability(scopes, cap));
  }

  /**
   * Check if all capabilities are granted
   */
  hasAllCapabilities(scopes: string[], capabilities: string[]): boolean {
    return capabilities.every((cap) => this.hasCapability(scopes, cap));
  }

  /**
   * Get default capabilities for a client type
   */
  getDefaultCapabilities(clientType: ClientType): string[] {
    return getCapabilityPreset(clientType);
  }

  // ============================================================================
  // Authentication
  // ============================================================================

  /**
   * Authenticate a connection with a token
   *
   * @returns Authentication result with client ID and capabilities
   */
  async authenticate(
    token: string,
    options: AuthenticateOptions = {},
  ): Promise<AuthResult> {
    const payload = await this.validateToken(token);

    if (!payload) {
      return {
        success: false,
        error: {
          code: 'AUTH_FAILED',
          message: 'Invalid or expired token',
        },
      };
    }

    const clientType = payload.clientType ?? options.clientType ?? 'cli';
    const capabilities =
      payload.scopes.length > 0
        ? payload.scopes
        : getCapabilityPreset(clientType);

    return {
      success: true,
      clientId: payload.sub,
      clientType,
      capabilities,
      ...((payload.clientVersion ?? options.clientVersion)
        ? { clientVersion: payload.clientVersion ?? options.clientVersion }
        : {}),
    };
  }

  /**
   * Check authorization for a required capability
   */
  authorize(
    requiredCapability: string,
    capabilities: string[],
  ): { authorized: boolean; error?: { code: string; message: string } } {
    if (!this.hasCapability(capabilities, requiredCapability)) {
      return {
        authorized: false,
        error: {
          code: 'INSUFFICIENT_CAPABILITY',
          message: `Missing required capability: ${requiredCapability}`,
        },
      };
    }

    return { authorized: true };
  }

  // ============================================================================
  // Token Extraction
  // ============================================================================

  /**
   * Extract token from Authorization header
   */
  extractFromHeader(authHeader: string): string | null {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }

    return authHeader.slice(7).trim();
  }

  /**
   * Extract token from query string
   */
  extractFromQuery(query: Record<string, string | undefined>): string | null {
    return query.token ?? null;
  }

  /**
   * Extract token from message payload
   */
  extractFromPayload(payload: {
    token?: string;
    apiKey?: string;
  }): string | null {
    return payload.token ?? null;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create an auth middleware instance
 */
export function createAuthMiddleware(config: WebSocketConfig): AuthMiddleware {
  return new AuthMiddleware(config);
}

export default AuthMiddleware;
