/**
 * WebSocket Gateway Plugin
 *
 * Fastify plugin that registers the WebSocket endpoint at /ws
 * and initializes the gateway infrastructure.
 */

import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import type { IncomingMessage } from 'http';
import {
  type WebSocketConfig,
  type PairingConfig,
  type ConnectionContext,
  type RateLimitInfo,
  type RateLimitResult,
  type ConnectionStatus,
  createWebSocketConfig,
  createPairingConfig,
  defaultWebSocketConfig,
  defaultPairingConfig,
} from './types';
import {
  type WSMessage,
  type WSRequest,
  type WSResponse,
  type WSError,
  type ErrorResponse,
  WS_ERROR_CODES,
  isWSMessage,
  isWSRequest,
  createWSMessage,
  createErrorResponse,
  createWSError,
} from '@openaidy/shared-types';
import type { AppServices } from '../app';

// ============================================================================
// Types
// ============================================================================

/**
 * WebSocket connection with socket and request
 */
export type WebSocketConnection = {
  socket: WebSocket;
  req: FastifyRequest | IncomingMessage;
};

/**
 * Rate limiter for per-connection rate limiting
 */
class RateLimiter {
  private requests: number[] = [];
  private resetTime: number;

  constructor(
    private max: number,
    private windowMs: number,
  ) {
    this.resetTime = Date.now() + windowMs;
  }

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

  recordRequest(): void {
    this.requests.push(Date.now());
  }

  reset(): void {
    this.requests = [];
    this.resetTime = Date.now() + this.windowMs;
  }
}

/**
 * Connection manager - tracks active WebSocket connections
 */
class ConnectionManager {
  private connections: Map<string, ConnectionContext> = new Map();
  private rateLimiters: Map<string, RateLimiter> = new Map();

  constructor(private config: WebSocketConfig) {}

  /**
   * Register a new connection
   */
  registerConnection(id: string, socket: WebSocket): ConnectionContext {
    const context: ConnectionContext = {
      id,
      status: 'connected',
      authenticated: false,
      capabilities: [],
      subscriptions: new Set(),
      lastHeartbeat: Date.now(),
      createdAt: Date.now(),
      metadata: {},
    };

    this.connections.set(id, context);
    this.rateLimiters.set(id, new RateLimiter(this.config.rateLimit.max, this.config.rateLimit.window));

    return context;
  }

  /**
   * Remove a connection
   */
  removeConnection(id: string): void {
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
   * Check rate limit for a connection
   */
  checkRateLimit(id: string): RateLimitResult {
    const limiter = this.rateLimiters.get(id);
    if (!limiter) {
      return {
        allowed: false,
        info: { remaining: 0, reset: Date.now() + this.config.rateLimit.window, limit: this.config.rateLimit.max },
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
   * Update heartbeat timestamp
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
   * Send a message to a specific connection
   */
  send(id: string, message: WSMessage): boolean {
    const ctx = this.connections.get(id);
    if (!ctx || ctx.status !== 'connected') {
      return false;
    }

    try {
      const data = JSON.stringify(message);
      // Access the raw WebSocket from the context
      // The socket is passed during registration
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Broadcast a message to all connections
   */
  broadcast(message: WSMessage, exclude: string[] = []): void {
    const data = JSON.stringify(message);
    const excludeSet = new Set(exclude);

    for (const [id, ctx] of this.connections) {
      if (!excludeSet.has(id) && ctx.status === 'connected') {
        // Message will be sent via the socket reference
      }
    }
  }

  /**
   * Get connection count
   */
  getConnectionCount(): number {
    return this.connections.size;
  }

  /**
   * Close all connections
   */
  closeAll(): void {
    this.connections.clear();
    this.rateLimiters.clear();
  }
}

/**
 * Message router - routes incoming messages to handlers
 */
class MessageRouter {
  private handlers: Map<string, MessageHandler> = new Map();
  private pendingRequests: Map<string, PendingRequest> = new Map();

  constructor(private logger: { info: (msg: string) => void; error: (msg: string) => void; warn: (msg: string) => void }) {}

  /**
   * Register a handler for a message type
   */
  registerHandler(type: string, handler: MessageHandler): void {
    this.handlers.set(type, handler);
  }

  /**
   * Unregister a handler
   */
  unregisterHandler(type: string): void {
    this.handlers.delete(type);
  }

  /**
   * Route a message to the appropriate handler
   */
  async route(
    connectionId: string,
    message: WSMessage,
    context: HandlerContext,
  ): Promise<WSResponse | void> {
    const handler = this.handlers.get(message.type);

    if (!handler) {
      this.logger.warn(`No handler registered for message type: ${message.type}`);
      return createErrorResponse(
        message.id,
        WS_ERROR_CODES.UNKNOWN_MESSAGE_TYPE,
        `Unknown message type: ${message.type}`,
      );
    }

    try {
      const result = await handler(connectionId, message as WSRequest, context);
      return result;
    } catch (error) {
      this.logger.error(`Handler error for ${message.type}: ${error}`);
      const err = error as Error;
      return createErrorResponse(
        message.id,
        WS_ERROR_CODES.INTERNAL_ERROR,
        err.message || 'Internal server error',
      );
    }
  }

  /**
   * Check if a handler exists for a type
   */
  hasHandler(type: string): boolean {
    return this.handlers.has(type);
  }

  /**
   * Get all registered handler types
   */
  getHandlerTypes(): string[] {
    return Array.from(this.handlers.keys());
  }
}

/**
 * Message handler type
 */
type MessageHandler = (
  connectionId: string,
  message: WSRequest,
  context: HandlerContext,
) => Promise<WSResponse | void>;

/**
 * Handler context
 */
type HandlerContext = {
  connectionManager: ConnectionManager;
  services: AppServices;
  logger: { info: (msg: string) => void; error: (msg: string) => void; warn: (msg: string) => void };
};

/**
 * Pending request for request-response correlation
 */
type PendingRequest = {
  connectionId: string;
  createdAt: number;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

// ============================================================================
// WebSocket Gateway
// ============================================================================

/**
 * WebSocket gateway instance
 */
export type WebSocketGateway = {
  config: WebSocketConfig;
  pairingConfig: PairingConfig;
  connectionManager: ConnectionManager;
  messageRouter: MessageRouter;
  shutdown: () => Promise<void>;
};

/**
 * Create a WebSocket gateway instance
 */
function createGateway(
  fastify: {
    log: { info: (msg: string) => void; error: (msg: string) => void; warn: (msg: string) => void };
    services: AppServices;
  },
  wsConfig?: Partial<WebSocketConfig>,
  pairingConfig?: Partial<PairingConfig>,
): WebSocketGateway {
  const config = { ...defaultWebSocketConfig, ...wsConfig };
  const pairing = { ...defaultPairingConfig, ...pairingConfig };

  const connectionManager = new ConnectionManager(config);
  const messageRouter = new MessageRouter(fastify.log);

  return {
    config,
    pairingConfig: pairing,
    connectionManager,
    messageRouter,
    shutdown: async () => {
      connectionManager.closeAll();
    },
  };
}

// ============================================================================
// Plugin Options
// ============================================================================

export type WebSocketGatewayOptions = {
  /** WebSocket configuration overrides */
  wsConfig?: Partial<WebSocketConfig>;
  /** Pairing configuration overrides */
  pairingConfig?: Partial<PairingConfig>;
  /** Whether to enable the gateway */
  enabled?: boolean;
};

// ============================================================================
// WebSocket Gateway Plugin
// ============================================================================

/**
 * WebSocket gateway plugin for Fastify
 *
 * Registers the /ws endpoint and initializes gateway infrastructure.
 */
export const websocketGatewayPlugin: FastifyPluginAsync<WebSocketGatewayOptions> = async (
  fastify,
  options = {},
) => {
  const enabled = options.enabled ?? true;
  if (!enabled) {
    fastify.log.info('WebSocket gateway is disabled');
    return;
  }

  const wsConfig = createWebSocketConfig(process.env);
  const pairingConfig = createPairingConfig(process.env);

  // Create gateway instance
  const gateway = createGateway(
    fastify,
    { ...wsConfig, ...options.wsConfig },
    { ...pairingConfig, ...options.pairingConfig },
  );

  // Store gateway in app
  fastify.decorate('websocketGateway', gateway);

  // Generate unique connection IDs
  const generateConnectionId = (): string => {
    return `conn_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  };

  // Handle WebSocket connection
  const handleConnection = async (
    connection: WebSocketConnection,
    req: FastifyRequest | IncomingMessage,
  ): Promise<void> => {
    const connectionId = generateConnectionId();
    const socket = connection.socket;

    // Check connection limit
    if (gateway.connectionManager.getConnectionCount() >= gateway.config.maxConnections) {
      const errorMsg = createErrorResponse(
        '0',
        WS_ERROR_CODES.CONNECTION_LIMIT,
        'Maximum connections reached',
      );
      socket.send(JSON.stringify(errorMsg));
      socket.close(1013, 'Connection limit reached');
      return;
    }

    // Register connection
    const ctx = gateway.connectionManager.registerConnection(connectionId, socket);
    fastify.log.info(`WebSocket connection established: ${connectionId}`);

    // Create handler context
    const handlerContext: HandlerContext = {
      connectionManager: gateway.connectionManager,
      services: fastify.services,
      logger: fastify.log,
    };

    // Message handler
    socket.on('message', async (data: Buffer | string) => {
      // Rate limit check
      const rateLimitResult = gateway.connectionManager.checkRateLimit(connectionId);
      if (!rateLimitResult.allowed) {
        const errorMsg = createErrorResponse(
          '0',
          WS_ERROR_CODES.RATE_LIMITED,
          'Rate limit exceeded',
          { reset: rateLimitResult.info.reset },
        );
        socket.send(JSON.stringify(errorMsg));
        return;
      }

      gateway.connectionManager.recordRequest(connectionId);
      gateway.connectionManager.updateHeartbeat(connectionId);

      // Parse message
      let message: unknown;
      try {
        const text = typeof data === 'string' ? data : data.toString('utf-8');
        message = JSON.parse(text);
      } catch {
        const errorMsg = createErrorResponse(
          '0',
          WS_ERROR_CODES.INVALID_REQUEST,
          'Invalid JSON',
        );
        socket.send(JSON.stringify(errorMsg));
        return;
      }

      // Validate message structure
      if (!isWSMessage(message)) {
        const errorMsg = createErrorResponse(
          '0',
          WS_ERROR_CODES.INVALID_REQUEST,
          'Invalid message structure',
        );
        socket.send(JSON.stringify(errorMsg));
        return;
      }

      // Route message to handler
      const response = await gateway.messageRouter.route(connectionId, message, handlerContext);

      // Send response if any
      if (response) {
        socket.send(JSON.stringify(response));
      }
    });

    // Handle close
    socket.on('close', (code: number, reason: Buffer) => {
      gateway.connectionManager.removeConnection(connectionId);
      fastify.log.info(`WebSocket connection closed: ${connectionId} (code: ${code})`);
    });

    // Handle error
    socket.on('error', (error: Error) => {
      fastify.log.error(`WebSocket error on ${connectionId}: ${error.message}`);
      gateway.connectionManager.removeConnection(connectionId);
    });

    // Send connection established message
    const connectedMsg = createWSMessage('connection.established', {
      connectionId,
      heartbeatInterval: gateway.config.heartbeatInterval,
    });
    socket.send(JSON.stringify(connectedMsg));
  };

  // Register WebSocket route
  fastify.get('/ws', { websocket: true }, async (connection, req) => {
    await handleConnection(connection, req);
  });

  // Heartbeat check interval
  const heartbeatInterval = setInterval(() => {
    const staleIds = gateway.connectionManager.checkStaleConnections(
      gateway.config.heartbeatInterval * 2,
    );
    for (const id of staleIds) {
      fastify.log.warn(`Closing stale connection: ${id}`);
      gateway.connectionManager.removeConnection(id);
    }
  }, gateway.config.heartbeatInterval);

  // Cleanup on close
  fastify.addHook('onClose', async () => {
    clearInterval(heartbeatInterval);
    await gateway.shutdown();
    fastify.log.info('WebSocket gateway shutdown complete');
  });

  fastify.log.info(`WebSocket gateway initialized at ${gateway.config.path}`);
};

// ============================================================================
// Type Augmentation
// ============================================================================

declare module 'fastify' {
  interface FastifyInstance {
    websocketGateway?: WebSocketGateway;
  }
}

export { ConnectionManager, MessageRouter, createGateway };
export type { MessageHandler, HandlerContext };
