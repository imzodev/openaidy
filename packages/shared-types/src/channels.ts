/**
 * Runtime channel types — used by server route responses and web frontend API client.
 *
 * These are NOT config/validation types (those live in packages/config).
 * These are the shapes that flow over HTTP between server and clients.
 */

/**
 * Lifecycle state of a channel connection.
 * - disconnected: no active connection, safe to call connect()
 * - qr: waiting for QR code scan; getQr() returns the current QR image
 * - connected: authenticated and receiving messages
 * - error: connection failed; error field in ChannelStatusResponse has details
 */
export type ChannelStatus = 'disconnected' | 'qr' | 'connected' | 'error';

/**
 * Shape returned by GET /channels and GET /channels/:id/status
 */
export type ChannelStatusResponse = {
  id: string;
  type: string;
  status: ChannelStatus;
  agentId: string;
  connectedAt?: string; // ISO 8601 timestamp, present only when status === 'connected'
  error?: string; // present only when status === 'error'
};

// ============================================================================
// WebSocket message types for channel operations
// ============================================================================

import type { WSMessage } from './websocket.js';

/**
 * WebSocket request to subscribe to channel QR and status updates.
 * The server sends channel.qr and channel.status events to the subscriber.
 */
export type ChannelSubscribeRequest = WSMessage<
  'channel.subscribe',
  { channelId: string }
>;

/**
 * WebSocket request to unsubscribe from channel updates.
 */
export type ChannelUnsubscribeRequest = WSMessage<
  'channel.unsubscribe',
  { channelId: string }
>;

/**
 * Response confirming subscription to a channel.
 */
export type ChannelSubscribedResponse = WSMessage<
  'channel.subscribed',
  { channelId: string }
>;

/**
 * Response confirming unsubscription from a channel.
 */
export type ChannelUnsubscribedResponse = WSMessage<
  'channel.unsubscribed',
  { channelId: string }
>;

/**
 * Event pushed to subscribers when a new QR code is available.
 * The qr field is a base64 PNG string, suitable for:
 *   <img src={`data:image/png;base64,${qr}`} />
 */
export type ChannelQrEvent = WSMessage<
  'channel.qr',
  { channelId: string; qr: string }
>;

/**
 * Event pushed to subscribers when channel status changes.
 */
export type ChannelStatusEvent = WSMessage<
  'channel.status',
  { channelId: string; status: ChannelStatus }
>;

/**
 * Error response for channel operations.
 */
export type ChannelErrorResponse = WSMessage<
  'error',
  { requestId: string; error: { code: string; message: string } }
>;
