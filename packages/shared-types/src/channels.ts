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

/**
 * SSE event shape pushed by GET /channels/:id/qr/stream
 * when a new QR code is available.
 * The qr field is a base64 PNG string, suitable for:
 *   <img src={`data:image/png;base64,${event.qr}`} />
 */
export type ChannelQrEvent = {
  type: 'qr';
  qr: string;
};

/**
 * SSE event shape pushed by GET /channels/:id/qr/stream
 * when the connection status changes (e.g. 'connected' after QR scan).
 */
export type ChannelStatusEvent = {
  type: 'status';
  status: ChannelStatus;
};

/** Union of all SSE event shapes from the QR stream endpoint */
export type ChannelSseEvent = ChannelQrEvent | ChannelStatusEvent;
