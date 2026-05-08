/**
 * Channel Handler
 *
 * WebSocket message handlers for channel operations (QR streaming, status, etc.)
 */

import type { FastifyBaseLogger } from 'fastify';
import type { ChannelRegistry } from '../../channels/index';
import type { ConnectionManager } from '../connection-manager';
import type { HandlerContext } from '../index';
import {
  type WSMessage,
  type WSResponse,
  type ErrorResponse,
  createWSMessage,
  createErrorResponse,
  WS_ERROR_CODES,
} from '@openaidy/shared-types';
import type { ChannelStatus } from '@openaidy/shared-types';

// ============================================================================
// Types
// ============================================================================

interface ChannelSubscribeRequest {
  id: string;
  type: 'channel.subscribe';
  payload: {
    channelId: string;
  };
}

interface ChannelUnsubscribeRequest {
  id: string;
  type: 'channel.unsubscribe';
  payload: {
    channelId: string;
  };
}

type ChannelSubscribedResponse = WSMessage<
  'channel.subscribed',
  { channelId: string }
>;

type ChannelUnsubscribedResponse = WSMessage<
  'channel.unsubscribed',
  { channelId: string }
>;

type ChannelStatusResponse = WSMessage<
  'channel.status',
  { channelId: string; status: ChannelStatus }
>;

type ChannelQrResponse = WSMessage<
  'channel.qr',
  { channelId: string; qr: string }
>;

// ============================================================================
// Channel Handler Class
// ============================================================================

export class ChannelHandler {
  // connectionId -> Set of subscribed channel IDs
  private subscriptions: Map<string, Set<string>> = new Map();

  constructor(
    private channelRegistry: ChannelRegistry,
    private connectionManager: ConnectionManager,
    private logger: FastifyBaseLogger,
  ) {}

  /**
   * Handle channel.subscribe request
   */
  async handleSubscribe(
    connectionId: string,
    request: ChannelSubscribeRequest,
    _context: HandlerContext,
  ): Promise<ChannelSubscribedResponse | ErrorResponse> {
    const { channelId } = request.payload;

    // Verify channel exists
    const channel = this.channelRegistry.get(channelId);
    if (!channel) {
      return createErrorResponse(
        request.id,
        WS_ERROR_CODES.NOT_FOUND,
        `Channel ${channelId} not found`,
      );
    }

    // Add to subscriptions
    if (!this.subscriptions.has(connectionId)) {
      this.subscriptions.set(connectionId, new Set());
    }
    this.subscriptions.get(connectionId)!.add(channelId);

    // Set up listeners for this channel on this connection
    this.setupChannelListeners(connectionId, channelId);

    this.logger.info({ connectionId, channelId }, 'Channel subscription added');

    // Send initial status
    const status = channel.getStatus();
    const statusResponse = createWSMessage(
      'channel.status',
      { channelId, status },
      request.id,
    ) as ChannelStatusResponse;
    this.sendToConnection(connectionId, statusResponse);

    return createWSMessage(
      'channel.subscribed',
      { channelId },
      request.id,
    ) as ChannelSubscribedResponse;
  }

  /**
   * Handle channel.unsubscribe request
   */
  async handleUnsubscribe(
    connectionId: string,
    request: ChannelUnsubscribeRequest,
    _context: HandlerContext,
  ): Promise<ChannelUnsubscribedResponse | ErrorResponse> {
    const { channelId } = request.payload;

    // Remove from subscriptions
    const subs = this.subscriptions.get(connectionId);
    if (subs) {
      subs.delete(channelId);
      if (subs.size === 0) {
        this.subscriptions.delete(connectionId);
      }
    }

    this.logger.info(
      { connectionId, channelId },
      'Channel subscription removed',
    );

    return createWSMessage(
      'channel.unsubscribed',
      { channelId },
      request.id,
    ) as ChannelUnsubscribedResponse;
  }

  /**
   * Set up listeners for a channel on a specific connection
   */
  private setupChannelListeners(connectionId: string, channelId: string): void {
    const channel = this.channelRegistry.get(channelId);
    if (!channel) return;

    // Create handlers for QR and status events
    const onQr = (qr: string) => {
      this.logger.debug(
        { connectionId, channelId, qrLength: qr.length },
        'Channel QR event received',
      );
      const event = createWSMessage('channel.qr', {
        channelId,
        qr,
      }) as ChannelQrResponse;
      this.sendToConnection(connectionId, event);
    };

    const onStatus = (status: ChannelStatus) => {
      this.logger.debug(
        { connectionId, channelId, status },
        'Channel status event received',
      );
      // Send status event
      const event = createWSMessage('channel.status', {
        channelId,
        status,
      }) as ChannelStatusResponse;
      this.sendToConnection(connectionId, event);
    };

    channel.onQrUpdate(onQr);
    channel.onStatusChange(onStatus);
    this.logger.info(
      { connectionId, channelId },
      'Channel listeners registered',
    );
  }

  /**
   * Send a message to a specific connection
   */
  private sendToConnection(connectionId: string, message: WSMessage): void {
    const conn = this.connectionManager.getConnection(connectionId);
    if (conn?.socket && conn.socket.readyState === 1) {
      conn.socket.send(JSON.stringify(message));
    }
  }

  /**
   * Clean up subscriptions when a connection closes
   */
  cleanupConnection(connectionId: string): void {
    this.subscriptions.delete(connectionId);
  }
}

// ============================================================================
// Handler Registration
// ============================================================================

export function registerChannelHandlers(
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
  handler: ChannelHandler,
): void {
  router.registerHandler(
    'channel.subscribe',
    (connId, msg, ctx) =>
      handler.handleSubscribe(
        connId,
        msg as ChannelSubscribeRequest,
        ctx,
      ) as unknown as Promise<WSResponse | void>,
  );

  router.registerHandler(
    'channel.unsubscribe',
    (connId, msg, ctx) =>
      handler.handleUnsubscribe(
        connId,
        msg as ChannelUnsubscribeRequest,
        ctx,
      ) as unknown as Promise<WSResponse | void>,
  );
}
