/**
 * WebSocket Gateway Plugin
 *
 * Fastify plugin that registers the WebSocket endpoint at /ws
 * and initializes the gateway infrastructure.
 */

import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import type { IncomingMessage } from 'http';
import { parse as parseUrl } from 'node:url';
import {
  type WebSocketConfig,
  type PairingConfig,
  defaultWebSocketConfig,
  defaultPairingConfig,
  createWebSocketConfig,
  createPairingConfig,
} from './types';
import {
  type WSMessage,
  type WSResponse,
  type AuthAuthenticateRequest,
  type AuthRefreshRequest,
  type AuthAuthenticatedResponse,
  type NodeRpcResponse,
  type NodeRpcError,
  WS_ERROR_CODES,
  isWSMessage,
  createWSMessage,
  createErrorResponse,
  WS_CAPABILITIES,
} from '@openaidy/shared-types';
import type { AppServices } from '../app';
import { ConnectionManager } from './connection-manager';
import { MessageRouter, type HandlerContext } from './message-router';
import { SessionHandler, registerSessionHandlers } from './handlers/session';
import { AgentHandler, registerAgentHandlers } from './handlers/agent';
import { ProviderHandler, registerProviderHandlers } from './handlers/provider';
import { NodeHandler, registerNodeHandlers } from './handlers/node';
import { PairingHandler, registerPairingHandlers } from './handlers/pairing';
import { ConfigHandler, registerConfigHandlers } from './handlers/config';
import { PresenceHandler, registerPresenceHandlers } from './handlers/presence';
import { PairingService } from './pairing-service';
import { NodeRegistry } from './node-registry';
import { PresenceManager } from './presence-manager';
import { StreamManager } from './streaming';
import { SubscriptionManager } from './subscriptions';
import { AuthMiddleware } from './middleware/auth';

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

const PUBLIC_MESSAGE_TYPES = new Set<string>([
  'auth.authenticate',
  'auth.refresh',
  'pairing.request',
  'pairing.status',
]);

const MESSAGE_CAPABILITIES: Partial<Record<string, string[]>> = {
  'session.create': [WS_CAPABILITIES.SESSIONS_WRITE],
  'session.get': [WS_CAPABILITIES.SESSIONS_READ],
  'session.list': [WS_CAPABILITIES.SESSIONS_READ],
  'session.delete': [WS_CAPABILITIES.SESSIONS_DELETE],
  'session.message': [WS_CAPABILITIES.SESSIONS_WRITE],
  'session.subscribe': [WS_CAPABILITIES.SESSIONS_READ],
  'session.unsubscribe': [WS_CAPABILITIES.SESSIONS_READ],
  'agent.list': [WS_CAPABILITIES.AGENTS_READ],
  'agent.get': [WS_CAPABILITIES.AGENTS_READ],
  'provider.list': [WS_CAPABILITIES.PROVIDERS_READ],
  'provider.models': [WS_CAPABILITIES.PROVIDERS_READ],
  'config.get': [WS_CAPABILITIES.CONFIG_READ],
  'config.update': [WS_CAPABILITIES.CONFIG_WRITE],
  'config.watch': [WS_CAPABILITIES.CONFIG_READ],
  'config.unwatch': [WS_CAPABILITIES.CONFIG_READ],
  'node.list': [WS_CAPABILITIES.NODE_DESCRIBE],
  'node.describe': [WS_CAPABILITIES.NODE_DESCRIBE],
  'node.invoke': [WS_CAPABILITIES.NODE_INVOKE],
  'node.register': [WS_CAPABILITIES.NODE_DESCRIBE],
  'node.unregister': [WS_CAPABILITIES.NODE_DESCRIBE],
  'pairing.list': [WS_CAPABILITIES.PAIRING_APPROVE],
  'pairing.approve': [WS_CAPABILITIES.PAIRING_APPROVE],
  'pairing.deny': [WS_CAPABILITIES.PAIRING_DENY],
  'presence.update': [WS_CAPABILITIES.SYSTEM_NOTIFY],
  'presence.get': [WS_CAPABILITIES.SYSTEM_NOTIFY],
  'presence.getAll': [WS_CAPABILITIES.SYSTEM_NOTIFY],
  'presence.subscribe': [WS_CAPABILITIES.SYSTEM_NOTIFY],
  'presence.unsubscribe': [WS_CAPABILITIES.SYSTEM_NOTIFY],
};

function isPublicMessageType(type: string): boolean {
  return PUBLIC_MESSAGE_TYPES.has(type);
}

function getRequiredCapabilities(type: string): string[] {
  return MESSAGE_CAPABILITIES[type] ?? [];
}

function extractHandshakeToken(
  req: FastifyRequest | IncomingMessage,
  authMiddleware: AuthMiddleware,
): string | null {
  const authHeader = req.headers?.authorization;
  if (typeof authHeader === 'string') {
    const token = authMiddleware.extractFromHeader(authHeader);
    if (token) {
      return token;
    }
  }

  const parsed = parseUrl(req.url ?? '', true);
  const query = parsed.query as Record<string, string | undefined>;
  return authMiddleware.extractFromQuery(query);
}

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
  agentHandler: AgentHandler;
  providerHandler: ProviderHandler;
  nodeHandler: NodeHandler;
  pairingHandler: PairingHandler;
  configHandler: ConfigHandler;
  presenceHandler: PresenceHandler;
  streamManager: StreamManager;
  subscriptionManager: SubscriptionManager;
  nodeRegistry: NodeRegistry;
  pairingService: PairingService;
  presenceManager: PresenceManager;
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
  pairingOpts?: Partial<PairingConfig>,
): WebSocketGateway {
  const config = { ...defaultWebSocketConfig, ...wsConfig };
  const pairingConfig = { ...defaultPairingConfig, ...pairingOpts };

  const connectionManager = new ConnectionManager(config);
  const messageRouter = new MessageRouter(fastify.log);
  
  // Create auth middleware for pairing service
  const authMiddleware = new AuthMiddleware(config);
  const pairingPersistence =
    fastify.services.pairingRequestsRepo && fastify.services.devicesRepo
      ? {
          pairingRequests: fastify.services.pairingRequestsRepo,
          devices: fastify.services.devicesRepo,
        }
      : undefined;
  
  // Create node registry and pairing service
  const nodeRegistry = new NodeRegistry({}, fastify.log);
  const pairingService = new PairingService(
    authMiddleware,
    fastify.log,
    {
      codeLength: pairingConfig.codeLength,
      requestExpiry: pairingConfig.codeExpiryMs,
      tokenExpiry: pairingConfig.defaultTokenExpiryMs,
      ...(pairingPersistence && { persistence: pairingPersistence }),
    },
  );

  // Create presence manager
  const presenceManager = new PresenceManager({}, fastify.log);

  // Create stream manager and subscription manager first (needed for session handler)
  const streamManager = new StreamManager(
    fastify.services.runEvents,
    connectionManager,
    fastify.log,
  );
  const subscriptionManager = new SubscriptionManager(connectionManager, fastify.log);

  // Create handlers with streaming support
  const sessionHandler = new SessionHandler(
    fastify.services.sessions,
    fastify.log,
    streamManager,
    fastify.services.runEvents,
  );
  const agentHandler = new AgentHandler(fastify.services.agents, fastify.log);
  const providerHandler = new ProviderHandler(fastify.services.providers, fastify.log);

  // Create node and pairing handlers
  const nodeHandler = new NodeHandler(
    nodeRegistry,
    connectionManager,
    fastify.log,
  );
  const pairingHandler = new PairingHandler(
    pairingService,
    connectionManager,
    nodeRegistry,
    fastify.log,
  );

  // Create config and presence handlers
  const configHandler = new ConfigHandler(
    fastify.services.config,
    connectionManager,
    fastify.log,
  );
  const presenceHandler = new PresenceHandler(
    presenceManager,
    connectionManager,
    fastify.log,
  );

  // Register session handlers with the message router
  registerSessionHandlers(messageRouter, sessionHandler);

  // Register agent handlers with the message router
  registerAgentHandlers(messageRouter, agentHandler);

  // Register provider handlers with the message router
  registerProviderHandlers(messageRouter, providerHandler);

  // Register node handlers with the message router
  registerNodeHandlers(messageRouter, nodeHandler);

  // Register pairing handlers with the message router
  registerPairingHandlers(messageRouter, pairingHandler);

  // Register config handlers with the message router
  registerConfigHandlers(messageRouter, configHandler);

  // Register presence handlers with the message router
  registerPresenceHandlers(messageRouter, presenceHandler);

  // Register node RPC response handlers (for node.invoke responses from nodes)
  messageRouter.registerHandler('node.rpc.response', async (connectionId, message) => {
    const rpcResponse = message as NodeRpcResponse;
    const handled = nodeHandler.handleRpcResponse(connectionId, rpcResponse);
    if (!handled) {
      return createErrorResponse(
        message.id,
        WS_ERROR_CODES.INVALID_REQUEST,
        'Unknown invocation ID or invocation already completed',
      );
    }
    // No response needed - the response is routed to the original caller
    return undefined;
  });

  messageRouter.registerHandler('node.rpc.error', async (connectionId, message) => {
    const rpcError = message as NodeRpcError;
    const handled = nodeHandler.handleRpcError(connectionId, rpcError);
    if (!handled) {
      return createErrorResponse(
        message.id,
        WS_ERROR_CODES.INVALID_REQUEST,
        'Unknown invocation ID or invocation already completed',
      );
    }
    // No response needed - the error is routed to the original caller
    return undefined;
  });

  // Register subscribe/unsubscribe handlers
  messageRouter.registerHandler('auth.authenticate', async (connectionId, message) => {
    const request = message as AuthAuthenticateRequest;
    const token = authMiddleware.extractFromPayload(request.payload);

    if (!token) {
      return createErrorResponse(
        request.id,
        WS_ERROR_CODES.AUTH_REQUIRED,
        'Authentication token is required',
      );
    }

    const result = await authMiddleware.authenticate(token);
    if (!result.success || !result.clientId) {
      return createErrorResponse(
        request.id,
        WS_ERROR_CODES.AUTH_FAILED,
        result.error?.message ?? 'Authentication failed',
      );
    }

    connectionManager.authenticate(
      connectionId,
      result.clientId,
      result.capabilities ?? [],
    );

    const payload = await authMiddleware.validateToken(token);
    if (payload) {
      connectionManager.updateMetadata(connectionId, {
        authTokenType: payload.type,
      });

      if (payload.type === 'pairing') {
        const pairingRequest = pairingService.getRequestByToken(token);
        if (pairingRequest?.nodeId) {
          connectionManager.updateMetadata(connectionId, {
            pairedNodeId: pairingRequest.nodeId,
            pairedRequestId: pairingRequest.requestId,
            pairingToken: token,
            pairedScopes: pairingRequest.scopes ?? payload.scopes,
          });
        }
      }
    }

    const expiresAt = payload?.exp
      ? new Date(payload.exp * 1000).toISOString()
      : new Date(Date.now() + config.auth.tokenExpiry).toISOString();

    return createWSMessage('auth.authenticated', {
      clientId: result.clientId,
      token,
      expiresAt,
      capabilities: result.capabilities ?? [],
    }) as AuthAuthenticatedResponse;
  });

  messageRouter.registerHandler('auth.refresh', async (connectionId, message) => {
    const request = message as AuthRefreshRequest;
    const refreshedToken = await authMiddleware.refreshToken(request.payload.refreshToken);

    if (!refreshedToken) {
      return createErrorResponse(
        request.id,
        WS_ERROR_CODES.AUTH_FAILED,
        'Invalid refresh token',
      );
    }

    const payload = await authMiddleware.validateToken(refreshedToken);
    if (!payload) {
      return createErrorResponse(
        request.id,
        WS_ERROR_CODES.AUTH_FAILED,
        'Failed to refresh token',
      );
    }

    connectionManager.authenticate(connectionId, payload.sub, payload.scopes);
    connectionManager.updateMetadata(connectionId, {
      authTokenType: payload.type,
    });

    return createWSMessage('auth.authenticated', {
      clientId: payload.sub,
      token: refreshedToken,
      expiresAt: new Date(payload.exp * 1000).toISOString(),
      capabilities: payload.scopes,
    }) as AuthAuthenticatedResponse;
  });

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
    pairingConfig: pairingConfig,
    connectionManager,
    messageRouter,
    sessionHandler,
    agentHandler,
    providerHandler,
    nodeHandler,
    pairingHandler,
    configHandler,
    presenceHandler,
    streamManager,
    subscriptionManager,
    nodeRegistry,
    pairingService,
    presenceManager,
    shutdown: async () => {
      streamManager.stop();
      subscriptionManager.cleanup();
      nodeRegistry.clear();
      pairingService.destroy();
      presenceManager.clear();
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
  await gateway.pairingService.loadPersistedState();
  const pluginAuthMiddleware = new AuthMiddleware(gateway.config);

  // Start the stream manager
  gateway.streamManager.start();

  // Store gateway in app
  fastify.decorate('websocketGateway', gateway);

  // Setup periodic cleanup tasks
  const cleanupInterval = setInterval(() => {
    // Cleanup expired pairing requests
    gateway.pairingService.cleanupExpiredRequests();
    // Cleanup stale nodes (nodes that haven't been seen in 2x heartbeat interval)
    gateway.nodeRegistry.cleanupStaleNodes(gateway.config.heartbeatInterval * 2);
    // Cleanup stale presence (presence that hasn't been updated in 3x heartbeat interval)
    gateway.presenceManager.cleanupStalePresence(gateway.config.heartbeatInterval * 3);
  }, 60000); // Every minute

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

    const handshakeToken = extractHandshakeToken(req, pluginAuthMiddleware);
    if (handshakeToken) {
      const authResult = await pluginAuthMiddleware.authenticate(handshakeToken);
      if (authResult.success && authResult.clientId) {
        gateway.connectionManager.authenticate(
          connectionId,
          authResult.clientId,
          authResult.capabilities ?? [],
        );

        const payload = await pluginAuthMiddleware.validateToken(handshakeToken);
        if (payload) {
          gateway.connectionManager.updateMetadata(connectionId, {
            authTokenType: payload.type,
          });

          if (payload.type === 'pairing') {
            const pairingRequest = gateway.pairingService.getRequestByToken(handshakeToken);
            if (pairingRequest?.nodeId) {
              gateway.connectionManager.updateMetadata(connectionId, {
                pairedNodeId: pairingRequest.nodeId,
                pairedRequestId: pairingRequest.requestId,
                pairingToken: handshakeToken,
                pairedScopes: pairingRequest.scopes ?? payload.scopes,
              });
            }
          }
        }
      } else if (gateway.config.auth.required) {
        const errorMsg = createErrorResponse(
          '0',
          WS_ERROR_CODES.AUTH_FAILED,
          authResult.error?.message ?? 'Authentication failed',
        );
        socket.send(JSON.stringify(errorMsg));
        socket.close(1008, 'Authentication failed');
        gateway.connectionManager.removeConnection(connectionId);
        return;
      }
    }

    // Create handler context
    const handlerContext: HandlerContext = {
      connectionManager: gateway.connectionManager,
      services: fastify.services,
      logger: fastify.log,
      streamManager: gateway.streamManager,
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

      const connection = gateway.connectionManager.getConnection(connectionId);
      if (!connection) {
        const errorMsg = createErrorResponse(
          message.id,
          WS_ERROR_CODES.CONNECTION_CLOSED,
          'Connection is no longer available',
        );
        socket.send(JSON.stringify(errorMsg));
        return;
      }

      if (
        gateway.config.auth.required &&
        !connection.authenticated &&
        !isPublicMessageType(message.type)
      ) {
        const errorMsg = createErrorResponse(
          message.id,
          WS_ERROR_CODES.AUTH_REQUIRED,
          'Authentication required',
        );
        socket.send(JSON.stringify(errorMsg));
        return;
      }

      const requiredCapabilities = getRequiredCapabilities(message.type);
      if (requiredCapabilities.length > 0) {
        const hasAllCapabilities = requiredCapabilities.every((capability) =>
          gateway.connectionManager.hasCapability(connectionId, capability),
        );

        if (!hasAllCapabilities) {
          const errorMsg = createErrorResponse(
            message.id,
            WS_ERROR_CODES.FORBIDDEN,
            `Missing required capabilities: ${requiredCapabilities.join(', ')}`,
          );
          socket.send(JSON.stringify(errorMsg));
          return;
        }
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
      // Clean up presence for this connection
      gateway.presenceHandler.removeConnection(connectionId);
      // Clean up pending node invocations for this connection
      gateway.nodeHandler.handleCallerDisconnect(connectionId);
      // Check if this connection was a node and clean up its invocations
      const node = gateway.nodeRegistry.getNodeByConnection(connectionId);
      if (node) {
        gateway.nodeHandler.handleNodeDisconnect(node.nodeId);
      }
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
      // Clean up presence for this connection
      gateway.presenceHandler.removeConnection(connectionId);
      // Clean up pending node invocations for this connection
      gateway.nodeHandler.handleCallerDisconnect(connectionId);
      // Check if this connection was a node and clean up its invocations
      const node = gateway.nodeRegistry.getNodeByConnection(connectionId);
      if (node) {
        gateway.nodeHandler.handleNodeDisconnect(node.nodeId);
      }
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
  fastify.get(gateway.config.path, { websocket: true }, async (connection, req) => {
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
    clearInterval(cleanupInterval);
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
