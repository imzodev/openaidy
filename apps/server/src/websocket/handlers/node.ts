/**
 * Node Handler
 *
 * WebSocket message handlers for node operations.
 */

import type { FastifyBaseLogger } from 'fastify';
import { NodeRegistry } from '../node-registry';
import type { ConnectionManager } from '../connection-manager';
import type { HandlerContext } from '../message-router';
import {
  type WSMessage,
  type WSResponse,
  type ErrorResponse,
  WS_ERROR_CODES,
  createWSMessage,
} from '@openaidy/shared-types';
import type { Node, NodeType } from '../node-registry';

// ============================================================================
// Request/Response Types
// ============================================================================

export type NodeListRequest = WSMessage<'node.list', {}>;

export type NodeDescribeRequest = WSMessage<'node.describe', { nodeId: string }>;

export type NodeInvokeRequest = WSMessage<'node.invoke', {
  nodeId: string;
  capability: string;
  params?: Record<string, unknown>;
  timeout?: number;
}>;

export type NodeRegisterRequest = WSMessage<'node.register', {
  name: string;
  type: NodeType;
  capabilities: string[];
  metadata?: Record<string, unknown>;
  connectionId?: string;
  tokenHash?: string;
  scopes?: string[];
}>;

export type NodeUnregisterRequest = WSMessage<'node.unregister', {
  nodeId: string;
}>;

export type NodeListResponse = WSMessage<'node.list', {
  nodes: Node[];
}>;

export type NodeDescribeResponse = WSMessage<'node.describe', {
  node: Node;
}>;

export type NodeInvokeResponse = WSMessage<'node.invoke', {
  result: unknown;
  duration: number;
}>;

export type NodeRegisterResponse = WSMessage<'node.registered', {
  node: Node;
}>;

export type NodeUnregisterResponse = WSMessage<'node.unregistered', {
  nodeId: string;
}>;

// ============================================================================
// Node Handler
// ============================================================================

export class NodeHandler {
  private nodeRegistry: NodeRegistry;
  private connectionManager: ConnectionManager;
  private logger: FastifyBaseLogger;

  constructor(
    nodeRegistry: NodeRegistry,
    connectionManager: ConnectionManager,
    logger: FastifyBaseLogger,
  ) {
    this.nodeRegistry = nodeRegistry;
    this.connectionManager = connectionManager;
    this.logger = logger;
  }

  // ============================================================================
  // Node List
  // ============================================================================

  async handleList(
    connectionId: string,
    request: NodeListRequest,
    ctx: HandlerContext,
  ): Promise<NodeListResponse | ErrorResponse> {
    try {
      this.logger.info({ connectionId }, 'Listing nodes via WebSocket');

      const nodes = this.nodeRegistry.getAllNodes();

      return {
        ...createWSMessage('node.list', {
          nodes: nodes.map(node => ({
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
    ctx: HandlerContext,
  ): Promise<NodeDescribeResponse | ErrorResponse> {
    try {
      this.logger.info({ connectionId, nodeId: request.payload.nodeId }, 'Describing node via WebSocket');

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
    ctx: HandlerContext,
  ): Promise<NodeInvokeResponse | ErrorResponse> {
    try {
      this.logger.info(
        { connectionId, nodeId: request.payload.nodeId, capability: request.payload.capability },
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

      // TODO: Implement actual invocation
      // This would send a message to the node and wait for response
      // For now, return a placeholder response

      return {
        ...createWSMessage('node.invoke', {
          result: { message: 'Invocation pending - not yet implemented' },
          duration: 0,
        }),
      } as NodeInvokeResponse;
    } catch (error) {
      return this.handleError('node.invoke', request.id, error);
    }
  }

  // ============================================================================
  // Node Register
  // ============================================================================

  async handleRegister(
    connectionId: string,
    request: NodeRegisterRequest,
    ctx: HandlerContext,
  ): Promise<NodeRegisterResponse | ErrorResponse> {
    try {
      this.logger.info({ connectionId, name: request.payload.name }, 'Registering node via WebSocket');

      const nodeId = `node-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      const node: Node = {
        nodeId,
        name: request.payload.name,
        type: request.payload.type,
        status: 'online',
        capabilities: request.payload.capabilities,
        metadata: request.payload.metadata || {},
        connectionId: request.payload.connectionId || connectionId,
        registeredAt: Date.now(),
        lastSeen: Date.now(),
        ...(request.payload.tokenHash !== undefined && { tokenHash: request.payload.tokenHash }),
        ...(request.payload.scopes !== undefined && { scopes: request.payload.scopes }),
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
    ctx: HandlerContext,
  ): Promise<NodeUnregisterResponse | ErrorResponse> {
    try {
      this.logger.info({ connectionId, nodeId: request.payload.nodeId }, 'Unregistering node via WebSocket');

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
          message: error instanceof Error ? error.message : 'Internal server error',
        },
      }),
    } as ErrorResponse;
  }
}

// ============================================================================
// Handler Registration
// ============================================================================

export function registerNodeHandlers(
  router: { registerHandler: (type: string, handler: (connId: string, msg: WSMessage, ctx: HandlerContext) => Promise<WSResponse | void>) => void },
  handler: NodeHandler,
): void {
  router.registerHandler('node.list', (connId, msg, ctx) =>
    handler.handleList(connId, msg as NodeListRequest, ctx),
  );

  router.registerHandler('node.describe', (connId, msg, ctx) =>
    handler.handleDescribe(connId, msg as NodeDescribeRequest, ctx),
  );

  router.registerHandler('node.invoke', (connId, msg, ctx) =>
    handler.handleInvoke(connId, msg as NodeInvokeRequest, ctx),
  );

  router.registerHandler('node.register', (connId, msg, ctx) =>
    handler.handleRegister(connId, msg as NodeRegisterRequest, ctx),
  );

  router.registerHandler('node.unregister', (connId, msg, ctx) =>
    handler.handleUnregister(connId, msg as NodeUnregisterRequest, ctx),
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
