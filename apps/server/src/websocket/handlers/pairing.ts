/**
 * Pairing Handler
 *
 * WebSocket message handlers for pairing operations.
 */

import type { FastifyBaseLogger } from 'fastify';
import { PairingService, type PairingRequest } from '../pairing-service';
import { NodeRegistry, type NodeType } from '../node-registry';
import type { ConnectionManager } from '../connection-manager';
import type { HandlerContext } from '../message-router';
import {
  type WSMessage,
  type WSResponse,
  type ErrorResponse,
  type PairingApproveRequest,
  type PairingDenyRequest,
  WS_ERROR_CODES,
  WS_CAPABILITIES,
  createWSMessage,
} from '@openaidy/shared-types';

// ============================================================================
// Server-Internal Request/Response Types
// (These have extended fields beyond shared-types or depend on server-internal types)
// ============================================================================

export type PairingRequestMessage = WSMessage<
  'pairing.request',
  {
    deviceName: string;
    deviceType: NodeType;
    capabilities: string[];
    metadata?: Record<string, unknown>;
  }
>;

export type PairingStatusRequest = WSMessage<
  'pairing.status',
  {
    requestId?: string;
    pairingCode?: string;
  }
>;

export type PairingListRequest = WSMessage<
  'pairing.list',
  Record<string, never>
>;

export type PairingRequestedResponse = WSMessage<
  'pairing.requested',
  {
    requestId: string;
    pairingCode: string;
    deviceName: string;
    deviceType: NodeType;
    capabilities: string[];
    requestedAt: number;
    expiresAt: number;
  }
>;

export type PairingStatusResponse = WSMessage<
  'pairing.status',
  {
    request: PairingRequest | null;
  }
>;

export type PairingApprovedResponse = WSMessage<
  'pairing.approved',
  {
    requestId: string;
    nodeId: string;
    token: string;
    scopes: string[];
    approvedAt: number;
  }
>;

export type PairingDeniedResponse = WSMessage<
  'pairing.denied',
  {
    requestId: string;
    deniedAt: number;
  }
>;

export type PairingListResponse = WSMessage<
  'pairing.list',
  {
    requests: PairingRequest[];
  }
>;

// ============================================================================
// Pairing Handler
// ============================================================================

export class PairingHandler {
  private pairingService: PairingService;
  private connectionManager: ConnectionManager;
  private nodeRegistry: NodeRegistry;
  private logger: FastifyBaseLogger;

  constructor(
    pairingService: PairingService,
    connectionManager: ConnectionManager,
    nodeRegistry: NodeRegistry,
    logger: FastifyBaseLogger,
  ) {
    this.pairingService = pairingService;
    this.connectionManager = connectionManager;
    this.nodeRegistry = nodeRegistry;
    this.logger = logger;
  }

  // ============================================================================
  // Pairing Request
  // ============================================================================

  async handleRequest(
    connectionId: string,
    request: PairingRequestMessage,
    _ctx: HandlerContext,
  ): Promise<PairingRequestedResponse | ErrorResponse> {
    try {
      this.logger.info(
        {
          connectionId,
          deviceName: request.payload.deviceName,
          deviceType: request.payload.deviceType,
        },
        'Creating pairing request via WebSocket',
      );

      const pairingRequest = this.pairingService.createRequest(
        request.payload.deviceName,
        request.payload.deviceType,
        request.payload.capabilities,
        request.payload.metadata,
      );

      return {
        ...createWSMessage(
          'pairing.requested',
          {
            requestId: pairingRequest.requestId,
            pairingCode: pairingRequest.pairingCode,
            deviceName: pairingRequest.deviceName,
            deviceType: pairingRequest.deviceType,
            capabilities: pairingRequest.capabilities,
            requestedAt: pairingRequest.requestedAt,
            expiresAt: pairingRequest.expiresAt,
          },
          request.id,
        ),
      } as PairingRequestedResponse;
    } catch (error) {
      return this.handleError('pairing.request', request.id, error);
    }
  }

  // ============================================================================
  // Pairing Status
  // ============================================================================

  async handleStatus(
    connectionId: string,
    request: PairingStatusRequest,
    _ctx: HandlerContext,
  ): Promise<PairingStatusResponse | ErrorResponse> {
    try {
      this.logger.info(
        {
          connectionId,
          requestId: request.payload.requestId,
          pairingCode: request.payload.pairingCode,
        },
        'Getting pairing status via WebSocket',
      );

      let pairingRequest: PairingRequest | undefined;

      if (request.payload.requestId) {
        pairingRequest = this.pairingService.getRequest(
          request.payload.requestId,
        );
      } else if (request.payload.pairingCode) {
        pairingRequest = this.pairingService.getRequestByCode(
          request.payload.pairingCode,
        );
      }

      return {
        ...createWSMessage(
          'pairing.status',
          {
            request: pairingRequest || null,
          },
          request.id,
        ),
      } as PairingStatusResponse;
    } catch (error) {
      return this.handleError('pairing.status', request.id, error);
    }
  }

  // ============================================================================
  // Pairing Approve
  // ============================================================================

  async handleApprove(
    connectionId: string,
    request: PairingApproveRequest,
    _ctx: HandlerContext,
  ): Promise<PairingApprovedResponse | ErrorResponse> {
    try {
      this.logger.info(
        { connectionId, requestId: request.payload.requestId },
        'Approving pairing request via WebSocket',
      );

      // Check permission
      const hasPermission = this.checkPairingApprovePermission(connectionId);
      if (!hasPermission) {
        return {
          ...createWSMessage('error', {
            requestId: request.id,
            error: {
              code: WS_ERROR_CODES.FORBIDDEN,
              message: 'Insufficient permissions to approve pairing request',
            },
          }),
        } as ErrorResponse;
      }

      const pairingRequest = await this.pairingService.approveRequest(
        request.payload.requestId,
        connectionId,
        request.payload.scopes,
      );

      if (!pairingRequest) {
        return {
          ...createWSMessage('error', {
            requestId: request.id,
            error: {
              code: WS_ERROR_CODES.NOT_FOUND,
              message: `Pairing request not found: ${request.payload.requestId}`,
            },
          }),
        } as ErrorResponse;
      }

      if (pairingRequest.status !== 'approved') {
        return {
          ...createWSMessage('error', {
            requestId: request.id,
            error: {
              code: WS_ERROR_CODES.INVALID_REQUEST,
              message: `Pairing request cannot be approved: status is ${pairingRequest.status}`,
            },
          }),
        } as ErrorResponse;
      }

      return {
        ...createWSMessage(
          'pairing.approved',
          {
            requestId: pairingRequest.requestId,
            nodeId: pairingRequest.nodeId!,
            token: pairingRequest.token!,
            scopes: pairingRequest.scopes!,
            approvedAt: pairingRequest.approvedAt!,
          },
          request.id,
        ),
      } as PairingApprovedResponse;
    } catch (error) {
      return this.handleError('pairing.approve', request.id, error);
    }
  }

  // ============================================================================
  // Pairing Deny
  // ============================================================================

  async handleDeny(
    connectionId: string,
    request: PairingDenyRequest,
    _ctx: HandlerContext,
  ): Promise<PairingDeniedResponse | ErrorResponse> {
    try {
      this.logger.info(
        { connectionId, requestId: request.payload.requestId },
        'Denying pairing request via WebSocket',
      );

      // Check permission
      const hasPermission = this.checkPairingDenyPermission(connectionId);
      if (!hasPermission) {
        return {
          ...createWSMessage('error', {
            requestId: request.id,
            error: {
              code: WS_ERROR_CODES.FORBIDDEN,
              message: 'Insufficient permissions to deny pairing request',
            },
          }),
        } as ErrorResponse;
      }

      const pairingRequest = this.pairingService.denyRequest(
        request.payload.requestId,
        connectionId,
      );

      if (!pairingRequest) {
        return {
          ...createWSMessage('error', {
            requestId: request.id,
            error: {
              code: WS_ERROR_CODES.NOT_FOUND,
              message: `Pairing request not found: ${request.payload.requestId}`,
            },
          }),
        } as ErrorResponse;
      }

      if (pairingRequest.status !== 'denied') {
        return {
          ...createWSMessage('error', {
            requestId: request.id,
            error: {
              code: WS_ERROR_CODES.INVALID_REQUEST,
              message: `Pairing request cannot be denied: status is ${pairingRequest.status}`,
            },
          }),
        } as ErrorResponse;
      }

      return {
        ...createWSMessage(
          'pairing.denied',
          {
            requestId: pairingRequest.requestId,
            deniedAt: pairingRequest.deniedAt!,
          },
          request.id,
        ),
      } as PairingDeniedResponse;
    } catch (error) {
      return this.handleError('pairing.deny', request.id, error);
    }
  }

  // ============================================================================
  // Pairing List
  // ============================================================================

  async handleList(
    connectionId: string,
    request: PairingListRequest,
    _ctx: HandlerContext,
  ): Promise<PairingListResponse | ErrorResponse> {
    try {
      this.logger.info(
        { connectionId },
        'Listing pending pairing requests via WebSocket',
      );

      // Check permission
      const hasPermission = this.checkPairingListPermission(connectionId);
      if (!hasPermission) {
        return {
          ...createWSMessage('error', {
            requestId: request.id,
            error: {
              code: WS_ERROR_CODES.FORBIDDEN,
              message: 'Insufficient permissions to list pairing requests',
            },
          }),
        } as ErrorResponse;
      }

      const requests = this.pairingService.getPendingRequests();

      return {
        ...createWSMessage(
          'pairing.list',
          {
            requests,
          },
          request.id,
        ),
      } as PairingListResponse;
    } catch (error) {
      return this.handleError('pairing.list', request.id, error);
    }
  }

  // ============================================================================
  // Permission Checks
  // ============================================================================

  private checkPairingApprovePermission(connectionId: string): boolean {
    return this.connectionManager.hasCapability(
      connectionId,
      WS_CAPABILITIES.PAIRING_APPROVE,
    );
  }

  private checkPairingDenyPermission(connectionId: string): boolean {
    return this.connectionManager.hasCapability(
      connectionId,
      WS_CAPABILITIES.PAIRING_DENY,
    );
  }

  private checkPairingListPermission(connectionId: string): boolean {
    return this.connectionManager.hasCapability(
      connectionId,
      WS_CAPABILITIES.PAIRING_APPROVE,
    );
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

export function registerPairingHandlers(
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
  handler: PairingHandler,
): void {
  router.registerHandler(
    'pairing.request',
    (connId, msg, ctx) =>
      handler.handleRequest(
        connId,
        msg as PairingRequestMessage,
        ctx,
      ) as Promise<WSResponse>,
  );

  router.registerHandler(
    'pairing.status',
    (connId, msg, ctx) =>
      handler.handleStatus(
        connId,
        msg as PairingStatusRequest,
        ctx,
      ) as Promise<WSResponse>,
  );

  router.registerHandler(
    'pairing.approve',
    (connId, msg, ctx) =>
      handler.handleApprove(
        connId,
        msg as PairingApproveRequest,
        ctx,
      ) as Promise<WSResponse>,
  );

  router.registerHandler(
    'pairing.deny',
    (connId, msg, ctx) =>
      handler.handleDeny(
        connId,
        msg as PairingDenyRequest,
        ctx,
      ) as Promise<WSResponse>,
  );

  router.registerHandler(
    'pairing.list',
    (connId, msg, ctx) =>
      handler.handleList(
        connId,
        msg as PairingListRequest,
        ctx,
      ) as Promise<WSResponse>,
  );
}

// ============================================================================
// Factory Function
// ============================================================================

export function createPairingHandler(
  pairingService: PairingService,
  connectionManager: ConnectionManager,
  nodeRegistry: NodeRegistry,
  logger: FastifyBaseLogger,
): PairingHandler {
  return new PairingHandler(
    pairingService,
    connectionManager,
    nodeRegistry,
    logger,
  );
}
