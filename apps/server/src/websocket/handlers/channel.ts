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
  createWSMessage,
  createErrorResponse,
  WS_ERROR_CODES,
  type ChannelStatus,
  type ChannelSubscribeRequest,
  type ChannelUnsubscribeRequest,
  type ChannelSubscribedResponse,
  type ChannelUnsubscribedResponse,
  type ErrorResponse,
} from '@openaidy/shared-types';

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

    // Initialize subscription set for this connection if needed
    if (!this.subscriptions.has(connectionId)) {
      this.subscriptions.set(connectionId, new Set());
    }
    this.subscriptions.get(connectionId)!.add(channelId);

    // Setup listeners for this channel
    this.setupChannelListeners(connectionId, channelId);

    this.logger.info({ connectionId, channelId }, 'Channel subscription added');

    // Send current status immediately
    const status = channel.getStatus();
    const statusResponse = createWSMessage(
      'channel.status',
      { channelId, status },
      request.id,
    );
    this.sendToConnection(connectionId, statusResponse);

    return createWSMessage('channel.subscribed', { channelId }, request.id);
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

    const subs = this.subscriptions.get(connectionId);
    if (subs) {
      subs.delete(channelId);
    }

    this.logger.info(
      { connectionId, channelId },
      'Channel subscription removed',
    );

    return createWSMessage('channel.unsubscribed', { channelId }, request.id);
  }

  /**
   * Setup listeners to forward channel events to the WebSocket client
   */
  private setupChannelListeners(connectionId: string, channelId: string): void {
    const channel = this.channelRegistry.get(channelId);
    if (!channel) return;

    const onStatus = (status: ChannelStatus) => {
      this.logger.debug(
        { connectionId, channelId, status },
        'Channel status event received',
      );
      const event = createWSMessage('channel.status', { channelId, status });
      this.sendToConnection(connectionId, event);
    };
    channel.onStatusChange(onStatus);

    if ('getQr' in channel && typeof channel.getQr === 'function') {
      const onQr = (qr: string) => {
        this.logger.debug(
          { connectionId, channelId, qrLength: qr.length },
          'Channel QR event received',
        );
        const event = createWSMessage('channel.qr', { channelId, qr });
        this.sendToConnection(connectionId, event);
      };
      if ('onQrUpdate' in channel && typeof channel.onQrUpdate === 'function') {
        channel.onQrUpdate(onQr);
      }
    }
  }

  /**
   * Send a message directly to a specific connection
   */
  private sendToConnection(connectionId: string, message: WSMessage): void {
    this.connectionManager.send(connectionId, message);
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
      ) => Promise<unknown>,
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
      ) as unknown as Promise<unknown>,
  );

  router.registerHandler(
    'channel.unsubscribe',
    (connId, msg, ctx) =>
      handler.handleUnsubscribe(
        connId,
        msg as ChannelUnsubscribeRequest,
        ctx,
      ) as unknown as Promise<unknown>,
  );
}
