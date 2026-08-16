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

/** Listener callbacks registered on a channel's EventEmitter for one subscriber. */
type ChannelListenerSet = {
  onStatus: (status: ChannelStatus) => void;
  onQr?: (qr: string) => void;
};

export class ChannelHandler {
  // connectionId -> Set of subscribed channel IDs
  private subscriptions: Map<string, Set<string>> = new Map();
  // connectionId -> channelId -> the exact listener callbacks registered on
  // that channel's EventEmitter, so unsubscribe can remove precisely those
  // (channelRegistry.get() returns the same long-lived channel instance
  // across calls, so listeners not removed here otherwise accumulate on it
  // for the process lifetime).
  private listeners: Map<string, Map<string, ChannelListenerSet>> = new Map();

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

    // A repeated subscribe for the same connection+channel (e.g. the client
    // retrying before the previous attempt settled) must replace, not stack
    // on top of, the previously registered listeners.
    this.teardownChannelListeners(connectionId, channelId);
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
    this.teardownChannelListeners(connectionId, channelId);

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

    const listenerSet: ChannelListenerSet = { onStatus };

    if (
      'getQr' in channel &&
      typeof channel.getQr === 'function' &&
      'onQrUpdate' in channel &&
      typeof channel.onQrUpdate === 'function'
    ) {
      const onQr = (qr: string) => {
        this.logger.debug(
          { connectionId, channelId, qrLength: qr.length },
          'Channel QR event received',
        );
        const event = createWSMessage('channel.qr', { channelId, qr });
        this.sendToConnection(connectionId, event);
      };
      channel.onQrUpdate(onQr);
      listenerSet.onQr = onQr;
    }

    if (!this.listeners.has(connectionId)) {
      this.listeners.set(connectionId, new Map());
    }
    this.listeners.get(connectionId)!.set(channelId, listenerSet);
  }

  /**
   * Remove the listeners registered by `setupChannelListeners` for this
   * connection+channel pair from the channel's EventEmitter. Safe to call
   * even when nothing was ever set up (subscribe for an unknown channel,
   * duplicate unsubscribe, etc.) — it's a no-op in that case.
   */
  private teardownChannelListeners(
    connectionId: string,
    channelId: string,
  ): void {
    const perConnection = this.listeners.get(connectionId);
    const listenerSet = perConnection?.get(channelId);
    if (!listenerSet) return;

    const channel = this.channelRegistry.get(channelId);
    channel?.removeListener('status', listenerSet.onStatus);
    if (
      listenerSet.onQr &&
      channel &&
      'removeQrListener' in channel &&
      typeof channel.removeQrListener === 'function'
    ) {
      channel.removeQrListener(listenerSet.onQr);
    }

    perConnection!.delete(channelId);
    if (perConnection!.size === 0) {
      this.listeners.delete(connectionId);
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
