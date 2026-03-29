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
  defaultWebSocketConfig,
  defaultPairingConfig,
  createWebSocketConfig,
  createPairingConfig,
} from './types';
import {
  type WSMessage,
  type WSResponse,
  WS_ERROR_CODES,
  isWSMessage,
  createWSMessage,
  createErrorResponse,
} from '@openaidy/shared-types';
import type { AppServices } from '../app';
import { ConnectionManager } from './connection-manager';
import { MessageRouter, type HandlerContext } from './message-router';
import { SessionHandler, registerSessionHandlers } from './handlers/session';
import { StreamManager } from './streaming';
import { SubscriptionManager } from './subscriptions';

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
  sessionHandler: SessionHandler;
  streamManager: StreamManager;
  subscriptionManager: SubscriptionManager;
  shutdown: () => Promise<void>;
};

/**
 * Create a WebSocket gateway instance
 */
function createGateway(
  fastify: {
    log: FastifyRequest['log'];
    services: AppServices;
  },
  wsConfig?: Partial<WebSocketConfig>,
  pairingConfig?: Partial<PairingConfig>,
): WebSocketGateway {
  const config = { ...defaultWebSocketConfig, ...wsConfig };
  const pairing = { ...defaultPairingConfig, ...pairingConfig };

  const connectionManager = new ConnectionManager(config);
  const messageRouter = new MessageRouter(fastify.log);
  const sessionHandler = new SessionHandler(fastify.services.sessions, fastify.log);
  const streamManager = new StreamManager(
    fastify.services.runEvents,
    connectionManager,
    fastify.log,
  );
  const subscriptionManager = new SubscriptionManager(connectionManager, fastify.log);

  // Register session handlers with the message router
  registerSessionHandlers(messageRouter, sessionHandler);

  // Register subscribe/unsubscribe handlers
  messageRouter.registerHandler('session.subscribe', async (connectionId, message) => {
    const payload = message.payload as { sessionId: string; events?: string[] };
    const subscriptionId = subscriptionManager.createSubscription(
      connectionId,
      payload.sessionId,
      payload.events,
    );

    if (!subscriptionId) {
      return createErrorResponse(
        message.id,
        WS_ERROR_CODES.INTERNAL_ERROR,
        'Failed to create subscription',
      );
    }

    // Return the response as unknown first to satisfy type constraints
    return {
      id: message.id,
      type: 'session.subscribed',
      timestamp: new Date().toISOString(),
      payload: {
        sessionId: payload.sessionId,
        subscriptionId,
      },
    } as unknown as WSResponse;
  });

  messageRouter.registerHandler('session.unsubscribe', async (connectionId, message) => {
    const payload = message.payload as { sessionId: string };
    const subscription = subscriptionManager.findSubscription(connectionId, payload.sessionId);

    if (subscription) {
      subscriptionManager.removeSubscription(subscription.id);
    }

    return {
      id: message.id,
      type: 'session.unsubscribed',
      timestamp: new Date().toISOString(),
      payload: {
        sessionId: payload.sessionId,
      },
    } as unknown as WSResponse;
  });

  return {
    config,
    pairingConfig: pairing,
    connectionManager,
    messageRouter,
    sessionHandler,
    streamManager,
    subscriptionManager,
    shutdown: async () => {
      streamManager.stop();
      subscriptionManager.cleanup();
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

  // Start the stream manager
  gateway.streamManager.start();

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
    gateway.connectionManager.registerConnection(connectionId, socket);
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

      // Handle streaming messages specially
      if (message.type === 'session.message' && (message.payload as { stream?: boolean })?.stream) {
        // Subscribe connection to the run's stream events
        const payload = message.payload as { sessionId: string };
        // The run ID will be created by the handler, we'll subscribe after
        // For now, route to handler which will handle streaming setup
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
      // Clean up stream subscriptions
      gateway.streamManager.unsubscribeAllFromConnection(connectionId);
      // Clean up session subscriptions
      gateway.subscriptionManager.removeConnectionSubscriptions(connectionId);
      // Remove connection
      gateway.connectionManager.removeConnection(connectionId);
      // Clear pending requests
      gateway.messageRouter.clearPendingRequests(connectionId);
      fastify.log.info(`WebSocket connection closed: ${connectionId} (code: ${code})`);
    });

    // Handle error
    socket.on('error', (error: Error) => {
      fastify.log.error(`WebSocket error on ${connectionId}: ${error.message}`);
      // Clean up stream subscriptions
      gateway.streamManager.unsubscribeAllFromConnection(connectionId);
      // Clean up session subscriptions
      gateway.subscriptionManager.removeConnectionSubscriptions(connectionId);
      // Remove connection
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
    // In @fastify/websocket, connection is { socket: WebSocket } in newer versions
    // The socket is directly accessible as connection for the WebSocket handler
    const socket = (connection as unknown as { socket: WebSocket }).socket || connection as WebSocket;
    await handleConnection({ socket, req }, req);
  });

  // Heartbeat check interval
  const heartbeatInterval = setInterval(() => {
    const staleIds = gateway.connectionManager.checkStaleConnections(
      gateway.config.heartbeatInterval * 2,
    );
    for (const id of staleIds) {
      fastify.log.warn(`Closing stale connection: ${id}`);
      gateway.streamManager.unsubscribeAllFromConnection(id);
      gateway.subscriptionManager.removeConnectionSubscriptions(id);
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

// Re-export types and classes for external use
export { ConnectionManager, MessageRouter, createGateway };
export type { MessageHandler, HandlerContext } from './message-router';
export { SessionHandler, registerSessionHandlers } from './handlers/session';
export { StreamManager } from './streaming';
export { SubscriptionManager } from './subscriptions';
