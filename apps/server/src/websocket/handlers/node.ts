/**
 * Node Handler
 *
 * WebSocket message handlers for node operations.
 *
 * Issue #127: Implements real node.invoke RPC flow with correlation and timeout.
 */

import type { FastifyBaseLogger } from 'fastify';
import { NodeRegistry } from '../node-registry';
import {
  InvocationManager,
  type InvocationManagerOptions,
} from '../invocation-manager';
import type { ConnectionManager } from '../connection-manager';
import type { HandlerContext } from '../message-router';
import {
  type WSMessage,
  type WSResponse,
  type ErrorResponse,
  type NodeRpcResponse,
  type NodeRpcError,
  WS_ERROR_CODES,
  createWSMessage,
} from '@openaidy/shared-types';
import type { Node, NodeType } from '../node-registry';

// ============================================================================
// Server-Internal Request/Response Types
// (These have extended fields beyond shared-types or depend on server-internal Node type)
// ============================================================================

export type NodeListRequest = WSMessage<'node.list', Record<string, never>>;

export type NodeDescribeRequest = WSMessage<
  'node.describe',
  { nodeId: string }
>;

export type NodeInvokeRequest = WSMessage<
  'node.invoke',
  {
    nodeId: string;
    capability: string;
    params?: Record<string, unknown>;
    timeout?: number;
  }
>;

export type NodeRegisterRequest = WSMessage<
  'node.register',
  {
    name: string;
    type: NodeType;
    capabilities: string[];
    metadata?: Record<string, unknown>;
    connectionId?: string;
    tokenHash?: string;
    scopes?: string[];
  }
>;

export type NodeUnregisterRequest = WSMessage<
  'node.unregister',
  {
    nodeId: string;
  }
>;

export type NodeListResponse = WSMessage<
  'node.list',
  {
    nodes: Node[];
  }
>;

export type NodeDescribeResponse = WSMessage<
  'node.describe',
  {
    node: Node;
  }
>;

export type NodeInvokeResponse = WSMessage<
  'node.invoke',
  {
    result: unknown;
    duration: number;
  }
>;

export type NodeRegisterResponse = WSMessage<
  'node.registered',
  {
    node: Node;
  }
>;

export type NodeUnregisterResponse = WSMessage<
  'node.unregistered',
  {
    nodeId: string;
  }
>;

// ============================================================================
// Node Handler
// ============================================================================

export class NodeHandler {
  private nodeRegistry: NodeRegistry;
  private connectionManager: ConnectionManager;
  private logger: FastifyBaseLogger;
  private invocationManager: InvocationManager;

  constructor(
    nodeRegistry: NodeRegistry,
    connectionManager: ConnectionManager,
    logger: FastifyBaseLogger,
    invocationManagerOptions?: InvocationManagerOptions,
  ) {
    this.nodeRegistry = nodeRegistry;
    this.connectionManager = connectionManager;
    this.logger = logger;
    this.invocationManager = new InvocationManager(
      connectionManager,
      logger,
      invocationManagerOptions,
    );
  }

  // ============================================================================
  // Node List
  // ============================================================================

  async handleList(
    connectionId: string,
    request: NodeListRequest,
    _ctx: HandlerContext,
  ): Promise<NodeListResponse | ErrorResponse> {
    try {
      this.logger.info({ connectionId }, 'Listing nodes via WebSocket');

      const nodes = this.nodeRegistry.getAllNodes();

      return {
        ...createWSMessage('node.list', {
          nodes: nodes.map((node) => ({
            nodeId: node.nodeId,
            name: node.name,
            type: node.type,
            status: node.status,
            capabilities: node.capabilities,
            connectionId: node.connectionId,
          })),
        }),
      } as NodeListResponse;
    } catch (error) {
      return this.handleError('node.list', request.id, error);
    }
  }

  // ============================================================================
  // Node Describe
  // ============================================================================

  async handleDescribe(
    connectionId: string,
    request: NodeDescribeRequest,
    _ctx: HandlerContext,
  ): Promise<NodeDescribeResponse | ErrorResponse> {
    try {
      this.logger.info(
        { connectionId, nodeId: request.payload.nodeId },
        'Describing node via WebSocket',
      );

      const node = this.nodeRegistry.getNode(request.payload.nodeId);
      if (!node) {
        return {
          ...createWSMessage('error', {
            requestId: request.id,
            error: {
              code: WS_ERROR_CODES.NOT_FOUND,
              message: `Node not found: ${request.payload.nodeId}`,
            },
          }),
        } as ErrorResponse;
      }

      return {
        ...createWSMessage('node.describe', {
          node,
        }),
      } as NodeDescribeResponse;
    } catch (error) {
      return this.handleError('node.describe', request.id, error);
    }
  }

  // ============================================================================
  // Node Invoke
  // ============================================================================

  async handleInvoke(
    connectionId: string,
    request: NodeInvokeRequest,
    _ctx: HandlerContext,
  ): Promise<NodeInvokeResponse | ErrorResponse> {
    try {
      this.logger.info(
        {
          connectionId,
          nodeId: request.payload.nodeId,
          capability: request.payload.capability,
        },
        'Invoking node capability via WebSocket',
      );

      const node = this.nodeRegistry.getNode(request.payload.nodeId);
      if (!node) {
        return {
          ...createWSMessage('error', {
            requestId: request.id,
            error: {
              code: WS_ERROR_CODES.NOT_FOUND,
              message: `Node not found: ${request.payload.nodeId}`,
            },
          }),
        } as ErrorResponse;
      }

      // Check if node is online
      if (node.status !== 'online') {
        return {
          ...createWSMessage('error', {
            requestId: request.id,
            error: {
              code: WS_ERROR_CODES.SERVICE_UNAVAILABLE,
              message: `Node is not online: ${node.status}`,
            },
          }),
        } as ErrorResponse;
      }

      // Check if node has the capability
      if (!node.capabilities.includes(request.payload.capability)) {
        return {
          ...createWSMessage('error', {
            requestId: request.id,
            error: {
              code: WS_ERROR_CODES.INSUFFICIENT_CAPABILITY,
              message: `Node does not have capability: ${request.payload.capability}`,
            },
          }),
        } as ErrorResponse;
      }

      // Check if node has a connection
      if (!node.connectionId) {
        return {
          ...createWSMessage('error', {
            requestId: request.id,
            error: {
              code: WS_ERROR_CODES.SERVICE_UNAVAILABLE,
              message: 'Node is not connected',
            },
          }),
        } as ErrorResponse;
      }

      // Start invocation through the invocation manager
      const result = this.invocationManager.startInvocation(
        request.payload.nodeId,
        node.connectionId,
        connectionId,
        request.id,
        request.payload.capability,
        request.payload.params ?? {},
        request.payload.timeout,
      );

      if (!result.ok) {
        return {
          ...createWSMessage('error', {
            requestId: request.id,
            error: {
              code: result.error.code,
              message: result.error.message,
            },
          }),
        } as ErrorResponse;
      }

      // Create the RPC request to send to the node
      const rpcRequest = this.invocationManager.createRpcRequest(
        result.invocationId,
      );
      if (!rpcRequest) {
        // Should not happen, but handle gracefully
        this.invocationManager.failInvocation(
          result.invocationId,
          WS_ERROR_CODES.INTERNAL_ERROR,
          'Failed to create RPC request',
        );
        return {
          ...createWSMessage('error', {
            requestId: request.id,
            error: {
              code: WS_ERROR_CODES.INTERNAL_ERROR,
              message: 'Failed to create RPC request',
            },
          }),
        } as ErrorResponse;
      }

      // Send the RPC request to the node
      const sent = this.connectionManager.send(node.connectionId, rpcRequest);
      if (!sent) {
        // Failed to send to node
        this.invocationManager.failInvocation(
          result.invocationId,
          WS_ERROR_CODES.SERVICE_UNAVAILABLE,
          'Failed to send request to node',
        );
        return {
          ...createWSMessage('error', {
            requestId: request.id,
            error: {
              code: WS_ERROR_CODES.SERVICE_UNAVAILABLE,
              message: 'Failed to send request to node',
            },
          }),
        } as ErrorResponse;
      }

      this.logger.info(
        {
          connectionId,
          nodeId: request.payload.nodeId,
          capability: request.payload.capability,
          invocationId: result.invocationId,
        },
        'Node invocation request sent',
      );

      // Wait for the response (with timeout handled by InvocationManager)
      return result.promise as Promise<NodeInvokeResponse | ErrorResponse>;
    } catch (error) {
      return this.handleError('node.invoke', request.id, error);
    }
  }

  // ============================================================================
  // Node RPC Response Handling
  // ============================================================================

  /**
   * Handle a node.rpc.response from a node
   *
   * This should be called when a node sends a response to a pending invocation.
   */
  handleRpcResponse(connectionId: string, message: NodeRpcResponse): boolean {
    if (
      !this.invocationManager.isExpectedResponder(
        message.payload.invocationId,
        connectionId,
      )
    ) {
      this.logger.warn(
        {
          connectionId,
          invocationId: message.payload.invocationId,
        },
        'Rejected node.rpc.response from unexpected connection',
      );
      return false;
    }

    return this.invocationManager.handleResponse(message);
  }

  /**
   * Handle a node.rpc.error from a node
   *
   * This should be called when a node sends an error for a pending invocation.
   */
  handleRpcError(connectionId: string, message: NodeRpcError): boolean {
    if (
      !this.invocationManager.isExpectedResponder(
        message.payload.invocationId,
        connectionId,
      )
    ) {
      this.logger.warn(
        {
          connectionId,
          invocationId: message.payload.invocationId,
        },
        'Rejected node.rpc.error from unexpected connection',
      );
      return false;
    }

    return this.invocationManager.handleError(message);
  }

  /**
   * Clean up invocations when a node disconnects
   */
  handleNodeDisconnect(nodeId: string): number {
    return this.invocationManager.failNodeInvocations(
      nodeId,
      'Node disconnected',
    );
  }

  /**
   * Clean up invocations when a caller disconnects
   */
  handleCallerDisconnect(connectionId: string): number {
    return this.invocationManager.cleanupCallerConnection(connectionId);
  }

  /**
   * Get the invocation manager (for testing/debugging)
   */
  getInvocationManager(): InvocationManager {
    return this.invocationManager;
  }

  // ============================================================================
  // Node Register
  // ============================================================================

  async handleRegister(
    connectionId: string,
    request: NodeRegisterRequest,
    _ctx: HandlerContext,
  ): Promise<NodeRegisterResponse | ErrorResponse> {
    try {
      this.logger.info(
        { connectionId, name: request.payload.name },
        'Registering node via WebSocket',
      );

      const metadata = this.connectionManager.getMetadata(connectionId);
      const claimedNodeId =
        typeof metadata.pairedNodeId === 'string'
          ? metadata.pairedNodeId
          : undefined;
      const claimedScopes = Array.isArray(metadata.pairedScopes)
        ? metadata.pairedScopes.filter(
            (scope): scope is string => typeof scope === 'string',
          )
        : undefined;
      const tokenHash =
        typeof metadata.pairingToken === 'string'
          ? metadata.pairingToken.substring(0, 16)
          : request.payload.tokenHash;

      const nodeId =
        claimedNodeId ??
        `node-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const capabilities = claimedScopes ?? request.payload.capabilities;

      const existingNode = this.nodeRegistry.getNode(nodeId);
      if (existingNode) {
        this.nodeRegistry.updateNode(nodeId, {
          name: request.payload.name,
          type: request.payload.type,
          status: 'online',
          capabilities,
          metadata: request.payload.metadata || {},
          connectionId,
          lastSeen: Date.now(),
          ...(tokenHash !== undefined && { tokenHash }),
          ...(claimedScopes !== undefined && { scopes: claimedScopes }),
        });

        return {
          ...createWSMessage('node.registered', {
            node: this.nodeRegistry.getNode(nodeId)!,
          }),
        } as NodeRegisterResponse;
      }

      const node: Node = {
        nodeId,
        name: request.payload.name,
        type: request.payload.type,
        status: 'online',
        capabilities,
        metadata: request.payload.metadata || {},
        connectionId,
        registeredAt: Date.now(),
        lastSeen: Date.now(),
        ...(tokenHash !== undefined && { tokenHash }),
        ...((claimedScopes ?? request.payload.scopes) !== undefined && {
          scopes: claimedScopes ?? request.payload.scopes,
        }),
      };

      this.nodeRegistry.registerNode(node);

      return {
        ...createWSMessage('node.registered', {
          node,
        }),
      } as NodeRegisterResponse;
    } catch (error) {
      return this.handleError('node.register', request.id, error);
    }
  }

  // ============================================================================
  // Node Unregister
  // ============================================================================

  async handleUnregister(
    connectionId: string,
    request: NodeUnregisterRequest,
    _ctx: HandlerContext,
  ): Promise<NodeUnregisterResponse | ErrorResponse> {
    try {
      this.logger.info(
        { connectionId, nodeId: request.payload.nodeId },
        'Unregistering node via WebSocket',
      );

      const node = this.nodeRegistry.getNode(request.payload.nodeId);
      if (!node) {
        return {
          ...createWSMessage('error', {
            requestId: request.id,
            error: {
              code: WS_ERROR_CODES.NOT_FOUND,
              message: `Node not found: ${request.payload.nodeId}`,
            },
          }),
        } as ErrorResponse;
      }

      this.nodeRegistry.unregisterNode(request.payload.nodeId);

      return {
        ...createWSMessage('node.unregistered', {
          nodeId: request.payload.nodeId,
        }),
      } as NodeUnregisterResponse;
    } catch (error) {
      return this.handleError('node.unregister', request.id, error);
    }
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private handleError(
    handler: string,
    requestId: string,
    error: unknown,
  ): ErrorResponse {
    this.logger.error({ err: error }, `Error in ${handler}`);

    return {
      ...createWSMessage('error', {
        requestId,
        error: {
          code: WS_ERROR_CODES.INTERNAL_ERROR,
          message:
            error instanceof Error ? error.message : 'Internal server error',
        },
      }),
    } as ErrorResponse;
  }
}

// ============================================================================
// Handler Registration
// ============================================================================

export function registerNodeHandlers(
  router: {
    registerHandler: (
      type: string,
      handler: (
        connId: string,
        msg: WSMessage,
        ctx: HandlerContext,
      ) => Promise<WSResponse | void>,
    ) => void;
  },
  handler: NodeHandler,
): void {
  router.registerHandler(
    'node.list',
    (connId, msg, ctx) =>
      handler.handleList(
        connId,
        msg as NodeListRequest,
        ctx,
      ) as Promise<WSResponse>,
  );

  router.registerHandler(
    'node.describe',
    (connId, msg, ctx) =>
      handler.handleDescribe(
        connId,
        msg as NodeDescribeRequest,
        ctx,
      ) as Promise<WSResponse>,
  );

  router.registerHandler(
    'node.invoke',
    (connId, msg, ctx) =>
      handler.handleInvoke(
        connId,
        msg as NodeInvokeRequest,
        ctx,
      ) as Promise<WSResponse>,
  );

  router.registerHandler(
    'node.register',
    (connId, msg, ctx) =>
      handler.handleRegister(
        connId,
        msg as NodeRegisterRequest,
        ctx,
      ) as Promise<WSResponse>,
  );

  router.registerHandler(
    'node.unregister',
    (connId, msg, ctx) =>
      handler.handleUnregister(
        connId,
        msg as NodeUnregisterRequest,
        ctx,
      ) as Promise<WSResponse>,
  );
}

// ============================================================================
// Factory Function
// ============================================================================

export function createNodeHandler(
  nodeRegistry: NodeRegistry,
  connectionManager: ConnectionManager,
  logger: FastifyBaseLogger,
): NodeHandler {
  return new NodeHandler(nodeRegistry, connectionManager, logger);
}
