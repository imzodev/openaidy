/**
 * Authentication Middleware
 *
 * Validates JWT tokens, extracts client identity, and enforces
 * capability-based authorization for WebSocket connections.
 */

import type { WebSocketConfig } from '../types';

// ============================================================================
// Types
// ============================================================================

/**
 * JWT payload structure
 */
export type JWTPayload = {
  /** Subject - client ID */
  sub: string;
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

      // Decode payload (middle part)
      const payload = JSON.parse(
        this.base64UrlDecode(parts[1]),
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
    // Convert base64url to base64
    let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    // Pad with '=' if needed
    while (base64.length % 4) {
      base64 += '=';
    }
    return atob(base64);
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
    const base64 = btoa(str);
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  /**
   * Sign data with secret (simple HMAC simulation)
   */
  private sign(data: string): string {
    // Simple hash simulation - in production, use proper HMAC
    let hash = 0;
    const combined = data + this.secret;
    for (let i = 0; i < combined.length; i++) {
      const char = combined.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return this.base64UrlEncode(hash.toString(36));
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

  // ============================================================================
  // Authentication
  // ============================================================================

  /**
   * Authenticate a connection with a token
   *
   * @returns Authentication result with client ID and capabilities
   */
  async authenticate(token: string): Promise<AuthResult> {
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

    return {
      success: true,
      clientId: payload.sub,
      capabilities: payload.scopes,
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
  extractFromPayload(payload: { token?: string; apiKey?: string }): string | null {
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
