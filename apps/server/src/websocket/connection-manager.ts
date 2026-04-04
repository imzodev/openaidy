/**
 * Connection Manager
 *
 * Tracks active WebSocket connections, handles authentication,
 * and manages connection lifecycle.
 */

import type { WebSocket } from '@fastify/websocket';
import type { ClientType } from '@openaidy/shared-types';
import {
  type WebSocketConfig,
  type RateLimitInfo,
  type RateLimitResult,
  defaultWebSocketConfig,
} from './types';

// ============================================================================
// Types
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
 * Connection context - metadata for each active connection
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
  /** Raw WebSocket reference */
  socket?: WebSocket;
};

/**
 * Rate limit check result
 */
export type { RateLimitInfo, RateLimitResult };

// ============================================================================
// Rate Limiter
// ============================================================================

/**
 * Sliding window rate limiter
 */
export class RateLimiter {
  private requests: number[] = [];
  private resetTime: number;

  constructor(
    private max: number,
    private windowMs: number,
  ) {
    this.resetTime = Date.now() + windowMs;
  }

  /**
   * Check if a request is allowed
   */
  check(): RateLimitResult {
    const now = Date.now();

    // Reset if window expired
    if (now >= this.resetTime) {
      this.requests = [];
      this.resetTime = now + this.windowMs;
    }

    // Clean old requests
    const windowStart = now - this.windowMs;
    this.requests = this.requests.filter((t) => t > windowStart);

    const remaining = Math.max(0, this.max - this.requests.length);
    const allowed = this.requests.length < this.max;

    return {
      allowed,
      info: {
        remaining,
        reset: this.resetTime,
        limit: this.max,
      },
    };
  }

  /**
   * Record a request
   */
  recordRequest(): void {
    this.requests.push(Date.now());
  }

  /**
   * Reset the rate limiter
   */
  reset(): void {
    this.requests = [];
    this.resetTime = Date.now() + this.windowMs;
  }
}

// ============================================================================
// Connection Manager
// ============================================================================

/**
 * Manages active WebSocket connections
 *
 * Handles registration, authentication, subscriptions, messaging,
 * rate limiting, and heartbeat tracking.
 */
export class ConnectionManager {
  private connections: Map<string, ConnectionContext> = new Map();
  private rateLimiters: Map<string, RateLimiter> = new Map();
  private topicIndex: Map<string, Set<string>> = new Map(); // topic -> connectionIds

  constructor(private config: WebSocketConfig = defaultWebSocketConfig) {}

  // ============================================================================
  // Connection Lifecycle
  // ============================================================================

  /**
   * Register a new connection
   */
  registerConnection(id: string, socket?: WebSocket): ConnectionContext {
    const context: ConnectionContext = {
      id,
      status: 'connected',
      authenticated: false,
      capabilities: [],
      subscriptions: new Set(),
      lastHeartbeat: Date.now(),
      createdAt: Date.now(),
      metadata: {},
      ...(socket !== undefined && { socket }),
    };

    this.connections.set(id, context);
    this.rateLimiters.set(
      id,
      new RateLimiter(this.config.rateLimit.max, this.config.rateLimit.window),
    );

    return context;
  }

  /**
   * Remove a connection
   */
  removeConnection(id: string): void {
    const ctx = this.connections.get(id);
    if (ctx) {
      // Clean up subscriptions
      for (const topic of ctx.subscriptions) {
        this.removeFromTopicIndex(topic, id);
      }
    }

    this.connections.delete(id);
    this.rateLimiters.delete(id);
  }

  /**
   * Get a connection by ID
   */
  getConnection(id: string): ConnectionContext | undefined {
    return this.connections.get(id);
  }

  /**
   * Get all connections
   */
  getAllConnections(): ConnectionContext[] {
    return Array.from(this.connections.values());
  }

  /**
   * Get connection count
   */
  getConnectionCount(): number {
    return this.connections.size;
  }

  /**
   * Check if connection exists
   */
  hasConnection(id: string): boolean {
    return this.connections.has(id);
  }

  // ============================================================================
  // Authentication
  // ============================================================================

  /**
   * Mark a connection as authenticated
   */
  authenticate(
    id: string,
    clientId: string,
    capabilities: string[] = [],
    clientType?: ClientType,
    clientVersion?: string,
  ): boolean {
    const ctx = this.connections.get(id);
    if (!ctx) return false;

    ctx.authenticated = true;
    ctx.clientId = clientId;
    ctx.capabilities = capabilities;
    if (clientType) {
      ctx.clientType = clientType;
    }
    if (clientVersion) {
      ctx.clientVersion = clientVersion;
    }

    return true;
  }

  /**
   * Check if connection is authenticated
   */
  isAuthenticated(id: string): boolean {
    const ctx = this.connections.get(id);
    return ctx?.authenticated ?? false;
  }

  /**
   * Get connection capabilities
   */
  getCapabilities(id: string): string[] {
    const ctx = this.connections.get(id);
    return ctx?.capabilities ?? [];
  }

  /**
   * Update connection metadata
   */
  updateMetadata(id: string, metadata: Record<string, unknown>): boolean {
    const ctx = this.connections.get(id);
    if (!ctx) return false;

    ctx.metadata = {
      ...ctx.metadata,
      ...metadata,
    };

    return true;
  }

  /**
   * Get connection metadata
   */
  getMetadata(id: string): Record<string, unknown> {
    const ctx = this.connections.get(id);
    return ctx?.metadata ?? {};
  }

  /**
   * Check if connection has a capability
   */
  hasCapability(id: string, capability: string): boolean {
    const ctx = this.connections.get(id);
    if (!ctx) return false;

    // Admin wildcard grants all capabilities
    if (ctx.capabilities.includes('*')) return true;

    return ctx.capabilities.includes(capability);
  }

  // ============================================================================
  // Subscriptions
  // ============================================================================

  /**
   * Subscribe a connection to a topic
   */
  subscribe(id: string, topic: string): boolean {
    const ctx = this.connections.get(id);
    if (!ctx) return false;

    ctx.subscriptions.add(topic);
    this.addToTopicIndex(topic, id);

    return true;
  }

  /**
   * Unsubscribe a connection from a topic
   */
  unsubscribe(id: string, topic: string): boolean {
    const ctx = this.connections.get(id);
    if (!ctx) return false;

    ctx.subscriptions.delete(topic);
    this.removeFromTopicIndex(topic, id);

    return true;
  }

  /**
   * Unsubscribe a connection from all topics
   */
  unsubscribeAll(id: string): void {
    const ctx = this.connections.get(id);
    if (!ctx) return;

    for (const topic of ctx.subscriptions) {
      this.removeFromTopicIndex(topic, id);
    }

    ctx.subscriptions.clear();
  }

  /**
   * Get all subscribers for a topic
   */
  getSubscribers(topic: string): ConnectionContext[] {
    const ids = this.topicIndex.get(topic);
    if (!ids) return [];

    return Array.from(ids)
      .map((id) => this.connections.get(id))
      .filter((ctx): ctx is ConnectionContext => ctx !== undefined);
  }

  /**
   * Get subscriptions for a connection
   */
  getSubscriptions(id: string): string[] {
    const ctx = this.connections.get(id);
    return ctx ? Array.from(ctx.subscriptions) : [];
  }

  // ============================================================================
  // Messaging
  // ============================================================================

  /**
   * Send a message to a specific connection
   */
  send(id: string, message: unknown): boolean {
    const ctx = this.connections.get(id);
    if (!ctx || !ctx.socket || ctx.status !== 'connected') {
      return false;
    }

    try {
      const data =
        typeof message === 'string' ? message : JSON.stringify(message);
      ctx.socket.send(data);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Broadcast a message to all connections
   */
  broadcast(message: unknown, exclude: string[] = []): number {
    const excludeSet = new Set(exclude);
    const data =
      typeof message === 'string' ? message : JSON.stringify(message);
    let sent = 0;

    for (const [id, ctx] of this.connections) {
      if (!excludeSet.has(id) && ctx.socket && ctx.status === 'connected') {
        try {
          ctx.socket.send(data);
          sent++;
        } catch {
          // Ignore send errors
        }
      }
    }

    return sent;
  }

  /**
   * Send a message to all subscribers of a topic
   */
  sendToTopic(topic: string, message: unknown): number {
    const subscribers = this.getSubscribers(topic);
    const data =
      typeof message === 'string' ? message : JSON.stringify(message);
    let sent = 0;

    for (const ctx of subscribers) {
      if (ctx.socket && ctx.status === 'connected') {
        try {
          ctx.socket.send(data);
          sent++;
        } catch {
          // Ignore send errors
        }
      }
    }

    return sent;
  }

  // ============================================================================
  // Heartbeat
  // ============================================================================

  /**
   * Update heartbeat timestamp for a connection
   */
  updateHeartbeat(id: string): void {
    const ctx = this.connections.get(id);
    if (ctx) {
      ctx.lastHeartbeat = Date.now();
    }
  }

  /**
   * Check for stale connections
   */
  checkStaleConnections(timeoutMs: number): string[] {
    const now = Date.now();
    const staleIds: string[] = [];

    for (const [id, ctx] of this.connections) {
      if (now - ctx.lastHeartbeat > timeoutMs) {
        staleIds.push(id);
      }
    }

    return staleIds;
  }

  /**
   * Get last heartbeat for a connection
   */
  getLastHeartbeat(id: string): number | undefined {
    const ctx = this.connections.get(id);
    return ctx?.lastHeartbeat;
  }

  // ============================================================================
  // Rate Limiting
  // ============================================================================

  /**
   * Check rate limit for a connection
   */
  checkRateLimit(id: string): RateLimitResult {
    const limiter = this.rateLimiters.get(id);
    if (!limiter) {
      return {
        allowed: false,
        info: {
          remaining: 0,
          reset: Date.now() + this.config.rateLimit.window,
          limit: this.config.rateLimit.max,
        },
      };
    }
    return limiter.check();
  }

  /**
   * Record a request for rate limiting
   */
  recordRequest(id: string): void {
    const limiter = this.rateLimiters.get(id);
    if (limiter) {
      limiter.recordRequest();
    }
  }

  /**
   * Reset rate limit for a connection
   */
  resetRateLimit(id: string): void {
    const limiter = this.rateLimiters.get(id);
    if (limiter) {
      limiter.reset();
    }
  }

  // ============================================================================
  // Cleanup
  // ============================================================================

  /**
   * Close all connections
   */
  closeAll(): void {
    for (const ctx of this.connections.values()) {
      if (ctx.socket) {
        try {
          ctx.socket.close();
        } catch {
          // Ignore close errors
        }
      }
    }

    this.connections.clear();
    this.rateLimiters.clear();
    this.topicIndex.clear();
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private addToTopicIndex(topic: string, connectionId: string): void {
    if (!this.topicIndex.has(topic)) {
      this.topicIndex.set(topic, new Set());
    }
    this.topicIndex.get(topic)!.add(connectionId);
  }

  private removeFromTopicIndex(topic: string, connectionId: string): void {
    const ids = this.topicIndex.get(topic);
    if (ids) {
      ids.delete(connectionId);
      if (ids.size === 0) {
        this.topicIndex.delete(topic);
      }
    }
  }
}

export default ConnectionManager;
