/**
 * Message Router
 *
 * Routes incoming WebSocket messages to appropriate handlers
 * and manages request-response correlation.
 */

import type { FastifyBaseLogger } from 'fastify';
import {
  type WSMessage,
  type WSRequest,
  type WSResponse,
  type WSError,
  WS_ERROR_CODES,
  isWSMessage,
  createErrorResponse,
} from '@openaidy/shared-types';
import type { ConnectionManager } from './connection-manager';

// ============================================================================
// Types
// ============================================================================

/**
 * Message handler function type
 */
export type MessageHandler = (
  connectionId: string,
  message: WSRequest,
  context: HandlerContext,
) => Promise<WSResponse | void>;

/**
 * Handler context passed to all message handlers
 */
export type HandlerContext = {
  connectionManager: ConnectionManager;
  services: unknown;
  logger: FastifyBaseLogger;
  streamManager?: import('./streaming').StreamManager;
};

/**
 * Pending request for request-response correlation
 */
type PendingRequest = {
  connectionId: string;
  createdAt: number;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout?: ReturnType<typeof setTimeout>;
};

// ============================================================================
// Message Router
// ============================================================================

/**
 * Routes incoming WebSocket messages to appropriate handlers
 */
export class MessageRouter {
  private handlers: Map<string, MessageHandler> = new Map();
  private pendingRequests: Map<string, PendingRequest> = new Map();

  constructor(
    private logger: FastifyBaseLogger,
    private requestTimeout: number = 30000, // 30 seconds
  ) {}

  // ============================================================================
  // Handler Registration
  // ============================================================================

  /**
   * Register a handler for a message type
   */
  registerHandler(type: string, handler: MessageHandler): void {
    this.handlers.set(type, handler);
    this.logger.info(`Registered handler for message type: ${type}`);
  }

  /**
   * Unregister a handler
   */
  unregisterHandler(type: string): void {
    if (this.handlers.has(type)) {
      this.handlers.delete(type);
      this.logger.info(`Unregistered handler for message type: ${type}`);
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

  /**
   * Get handler count
   */
  getHandlerCount(): number {
    return this.handlers.size;
  }

  // ============================================================================
  // Message Routing
  // ============================================================================

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
      const err = error as Error;
      this.logger.error(`Handler error for ${message.type}: ${err.message}`);
      return createErrorResponse(
        message.id,
        WS_ERROR_CODES.INTERNAL_ERROR,
        err.message || 'Internal server error',
      );
    }
  }

  /**
   * Check if a message can be routed (has a handler)
   */
  canRoute(message: unknown): boolean {
    if (!isWSMessage(message)) {
      return false;
    }
    return this.hasHandler(message.type);
  }

  // ============================================================================
  // Request-Response Correlation
  // ============================================================================

  /**
   * Create a unique request ID
   */
  createRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Track a pending request
   */
  trackRequest(
    requestId: string,
    connectionId: string,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('Request timeout'));
      }, this.requestTimeout);

      this.pendingRequests.set(requestId, {
        connectionId,
        createdAt: Date.now(),
        resolve,
        reject,
        timeout,
      });
    });
  }

  /**
   * Complete a pending request with a response
   */
  completeRequest(requestId: string, response: WSResponse): boolean {
    const pending = this.pendingRequests.get(requestId);
    if (!pending) {
      return false;
    }

    if (pending.timeout) {
      clearTimeout(pending.timeout);
    }

    pending.resolve(response);
    this.pendingRequests.delete(requestId);
    return true;
  }

  /**
   * Fail a pending request with an error
   */
  failRequest(requestId: string, error: WSError): boolean {
    const pending = this.pendingRequests.get(requestId);
    if (!pending) {
      return false;
    }

    if (pending.timeout) {
      clearTimeout(pending.timeout);
    }

    pending.reject(new Error(error.message));
    this.pendingRequests.delete(requestId);
    return true;
  }

  /**
   * Get pending request count
   */
  getPendingCount(): number {
    return this.pendingRequests.size;
  }

  /**
   * Get pending requests for a connection
   */
  getPendingForConnection(connectionId: string): string[] {
    const requestIds: string[] = [];
    for (const [requestId, pending] of this.pendingRequests) {
      if (pending.connectionId === connectionId) {
        requestIds.push(requestId);
      }
    }
    return requestIds;
  }

  // ============================================================================
  // Cleanup
  // ============================================================================

  /**
   * Clear all pending requests for a connection
   */
  clearPendingRequests(connectionId: string): number {
    let cleared = 0;
    for (const [requestId, pending] of this.pendingRequests) {
      if (pending.connectionId === connectionId) {
        if (pending.timeout) {
          clearTimeout(pending.timeout);
        }
        pending.reject(new Error('Connection closed'));
        this.pendingRequests.delete(requestId);
        cleared++;
      }
    }
    return cleared;
  }

  /**
   * Clear all pending requests
   */
  clearAll(): void {
    for (const pending of this.pendingRequests.values()) {
      if (pending.timeout) {
        clearTimeout(pending.timeout);
      }
      pending.reject(new Error('Router shutdown'));
    }
    this.pendingRequests.clear();
  }

  /**
   * Clear all handlers
   */
  clearHandlers(): void {
    this.handlers.clear();
  }
}

export default MessageRouter;
