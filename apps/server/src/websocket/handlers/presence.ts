/**
 * Presence Handler
 *
 * WebSocket message handlers for presence operations.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { ConnectionManager } from '../connection-manager';
import type { HandlerContext } from '../index';
import type {
  PresenceManager,
  PresenceInfo,
  PresenceStatus,
} from '../presence-manager';
import {
  type WSMessage,
  type WSResponse,
  type WSError,
  type ErrorResponse,
  type PresenceUpdateRequest,
  type PresenceChangedEvent,
  WS_ERROR_CODES,
  createWSMessage,
} from '@openaidy/shared-types';

// ============================================================================
// Types
// ============================================================================

/**
 * Presence update response type
 */
export type PresenceUpdateResponse = WSMessage<
  'presence.update',
  {
    success: boolean;
    presence: PresenceInfo;
  }
>;

/**
 * Presence get request type
 */
export type PresenceGetRequest = WSMessage<
  'presence.get',
  {
    connectionId?: string;
    clientId?: string;
  }
>;

/**
 * Presence get response type
 */
export type PresenceGetResponse = WSMessage<
  'presence.get',
  {
    presence: PresenceInfo | PresenceInfo[];
  }
>;

/**
 * Presence get all response type
 */
export type PresenceGetAllResponse = WSMessage<
  'presence.getAll',
  {
    presence: PresenceInfo[];
    total: number;
  }
>;

/**
 * Presence subscribe request type
 */
export type PresenceSubscribeRequest = WSMessage<
  'presence.subscribe',
  Record<string, never>
>;

/**
 * Presence subscribe response type
 */
export type PresenceSubscribeResponse = WSMessage<
  'presence.subscribe',
  {
    subscribed: boolean;
  }
>;

/**
 * Presence unsubscribe request type
 */
export type PresenceUnsubscribeRequest = WSMessage<
  'presence.unsubscribe',
  Record<string, never>
>;

/**
 * Presence unsubscribe response type
 */
export type PresenceUnsubscribeResponse = WSMessage<
  'presence.unsubscribe',
  {
    subscribed: boolean;
  }
>;

// ============================================================================
// Presence Handler Class
// ============================================================================

/**
 * Handles presence-related WebSocket messages
 */
export class PresenceHandler {
  constructor(
    private presenceManager: PresenceManager,
    private connectionManager: ConnectionManager,
    private logger: FastifyBaseLogger,
  ) {}

  /**
   * Handle presence.update request
   */
  async handleUpdate(
    connectionId: string,
    request: PresenceUpdateRequest,
    _context: HandlerContext,
  ): Promise<PresenceUpdateResponse | ErrorResponse> {
    try {
      const { status } = request.payload;

      // Validate status
      const validStatuses: PresenceStatus[] = [
        'online',
        'away',
        'busy',
        'offline',
      ];
      if (!validStatuses.includes(status)) {
        return this.createErrorResponse(
          request.id,
          WS_ERROR_CODES.INVALID_REQUEST,
          `Invalid presence status: ${status}. Valid values: ${validStatuses.join(', ')}`,
        );
      }

      // Get connection info for clientId
      const conn = this.connectionManager.getConnection(connectionId);

      // Update presence
      const presenceOptions: {
        clientId?: string;
        metadata?: Record<string, unknown>;
      } = {};
      if (conn?.clientId) presenceOptions.clientId = conn.clientId;
      if (request.payload.metadata)
        presenceOptions.metadata = request.payload.metadata;
      const presence = this.presenceManager.updatePresence(
        connectionId,
        status,
        presenceOptions,
      );

      this.logger.info(
        { connectionId, status },
        'Presence updated via WebSocket',
      );

      // Broadcast presence.changed event to subscribers
      this.broadcastPresenceChange(presence, connectionId);

      return createWSMessage('presence.update', {
        success: true,
        presence,
      }) as PresenceUpdateResponse;
    } catch (error) {
      this.logger.error({ error, connectionId }, 'Failed to update presence');
      return this.createErrorResponse(
        request.id,
        WS_ERROR_CODES.INTERNAL_ERROR,
        'Failed to update presence',
      );
    }
  }

  /**
   * Handle presence.get request
   */
  async handleGet(
    connectionId: string,
    request: PresenceGetRequest,
    _context: HandlerContext,
  ): Promise<PresenceGetResponse | ErrorResponse> {
    try {
      const { connectionId: targetConnId, clientId } = request.payload;

      // Get by connection ID
      if (targetConnId) {
        const presence = this.presenceManager.getPresence(targetConnId);
        if (!presence) {
          return this.createErrorResponse(
            request.id,
            WS_ERROR_CODES.NOT_FOUND,
            `Presence not found for connection: ${targetConnId}`,
          );
        }

        return createWSMessage('presence.get', {
          presence,
        }) as PresenceGetResponse;
      }

      // Get by client ID
      if (clientId) {
        const presence = this.presenceManager.getClientPresence(clientId);
        return createWSMessage('presence.get', {
          presence,
        }) as PresenceGetResponse;
      }

      // Get own presence
      const presence = this.presenceManager.getPresence(connectionId);
      if (!presence) {
        return this.createErrorResponse(
          request.id,
          WS_ERROR_CODES.NOT_FOUND,
          'Presence not found for current connection',
        );
      }

      return createWSMessage('presence.get', {
        presence,
      }) as PresenceGetResponse;
    } catch (error) {
      this.logger.error({ error, connectionId }, 'Failed to get presence');
      return this.createErrorResponse(
        request.id,
        WS_ERROR_CODES.INTERNAL_ERROR,
        'Failed to get presence',
      );
    }
  }

  /**
   * Handle presence.getAll request
   */
  async handleGetAll(
    connectionId: string,
    request: WSMessage<'presence.getAll', Record<string, never>>,
    _context: HandlerContext,
  ): Promise<PresenceGetAllResponse | ErrorResponse> {
    try {
      const presence = this.presenceManager.getAllPresence();

      return createWSMessage('presence.getAll', {
        presence,
        total: presence.length,
      }) as PresenceGetAllResponse;
    } catch (error) {
      this.logger.error({ error, connectionId }, 'Failed to get all presence');
      return this.createErrorResponse(
        request.id,
        WS_ERROR_CODES.INTERNAL_ERROR,
        'Failed to get all presence',
      );
    }
  }

  /**
   * Handle presence.subscribe request
   */
  async handleSubscribe(
    connectionId: string,
    request: PresenceSubscribeRequest,
    _context: HandlerContext,
  ): Promise<PresenceSubscribeResponse | ErrorResponse> {
    try {
      this.presenceManager.subscribe(connectionId);

      this.logger.info({ connectionId }, 'Subscribed to presence events');

      return createWSMessage('presence.subscribe', {
        subscribed: true,
      }) as PresenceSubscribeResponse;
    } catch (error) {
      this.logger.error(
        { error, connectionId },
        'Failed to subscribe to presence',
      );
      return this.createErrorResponse(
        request.id,
        WS_ERROR_CODES.INTERNAL_ERROR,
        'Failed to subscribe to presence events',
      );
    }
  }

  /**
   * Handle presence.unsubscribe request
   */
  async handleUnsubscribe(
    connectionId: string,
    request: PresenceUnsubscribeRequest,
    _context: HandlerContext,
  ): Promise<PresenceUnsubscribeResponse | ErrorResponse> {
    try {
      this.presenceManager.unsubscribe(connectionId);

      this.logger.info({ connectionId }, 'Unsubscribed from presence events');

      return createWSMessage('presence.unsubscribe', {
        subscribed: false,
      }) as PresenceUnsubscribeResponse;
    } catch (error) {
      this.logger.error(
        { error, connectionId },
        'Failed to unsubscribe from presence',
      );
      return this.createErrorResponse(
        request.id,
        WS_ERROR_CODES.INTERNAL_ERROR,
        'Failed to unsubscribe from presence events',
      );
    }
  }

  /**
   * Remove connection from presence manager
   */
  removeConnection(connectionId: string): void {
    this.presenceManager.removeConnection(connectionId);
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Broadcast presence change to subscribers
   */
  private broadcastPresenceChange(
    presence: PresenceInfo,
    excludeConnectionId: string,
  ): void {
    const event: PresenceChangedEvent = createWSMessage('presence.changed', {
      clientId: presence.clientId || presence.connectionId,
      status: presence.status,
      metadata: presence.metadata,
    }) as PresenceChangedEvent;

    const subscribers = this.presenceManager.getSubscribers();
    for (const subscriberId of subscribers) {
      // Don't send to the connection that made the change
      if (subscriberId === excludeConnectionId) {
        continue;
      }

      this.sendToConnection(subscriberId, event);
    }
  }

  /**
   * Send a message to a connection
   */
  private sendToConnection(connectionId: string, message: WSMessage): void {
    const conn = this.connectionManager.getConnection(connectionId);
    if (conn?.socket && conn.socket.readyState === 1) {
      conn.socket.send(JSON.stringify(message));
    }
  }

  /**
   * Create an error response
   */
  private createErrorResponse(
    requestId: string,
    code: keyof typeof WS_ERROR_CODES,
    message: string,
    details?: Record<string, unknown>,
  ): ErrorResponse {
    const error: WSError = {
      code,
      message,
      ...(details !== undefined && { details }),
    };

    return createWSMessage('error', {
      requestId,
      error,
    }) as ErrorResponse;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create presence handler instance
 */
export function createPresenceHandler(
  presenceManager: PresenceManager,
  connectionManager: ConnectionManager,
  logger: FastifyBaseLogger,
): PresenceHandler {
  return new PresenceHandler(presenceManager, connectionManager, logger);
}

// ============================================================================
// Handler Registration
// ============================================================================

/**
 * Register presence handlers with message router
 */
type RegisterableHandler = (
  connId: string,
  msg: WSMessage,
  ctx: HandlerContext,
) => Promise<WSResponse | void>;

export function registerPresenceHandlers(
  router: {
    registerHandler: (type: string, handler: RegisterableHandler) => void;
  },
  handler: PresenceHandler,
): void {
  // The presence.* handlers return local response types that are not part of
  // the WSResponse union, so each handler is cast through `unknown` to the
  // router's expected signature.
  router.registerHandler('presence.update', ((
    connId: string,
    msg: WSMessage,
    ctx: HandlerContext,
  ) =>
    handler.handleUpdate(
      connId,
      msg as PresenceUpdateRequest,
      ctx,
    )) as unknown as RegisterableHandler);

  router.registerHandler('presence.get', ((
    connId: string,
    msg: WSMessage,
    ctx: HandlerContext,
  ) =>
    handler.handleGet(
      connId,
      msg as PresenceGetRequest,
      ctx,
    )) as unknown as RegisterableHandler);

  router.registerHandler('presence.getAll', ((
    connId: string,
    msg: WSMessage,
    ctx: HandlerContext,
  ) =>
    handler.handleGetAll(
      connId,
      msg as WSMessage<'presence.getAll', Record<string, never>>,
      ctx,
    )) as unknown as RegisterableHandler);

  router.registerHandler('presence.subscribe', ((
    connId: string,
    msg: WSMessage,
    ctx: HandlerContext,
  ) =>
    handler.handleSubscribe(
      connId,
      msg as PresenceSubscribeRequest,
      ctx,
    )) as unknown as RegisterableHandler);

  router.registerHandler('presence.unsubscribe', ((
    connId: string,
    msg: WSMessage,
    ctx: HandlerContext,
  ) =>
    handler.handleUnsubscribe(
      connId,
      msg as PresenceUnsubscribeRequest,
      ctx,
    )) as unknown as RegisterableHandler);
}

export default PresenceHandler;
