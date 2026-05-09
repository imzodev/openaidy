import type { ChannelStatus } from '@openaidy/shared-types';

/**
 * Base channel interface - all channels must implement this.
 *
 * Open/Closed principle: adding a new channel (Telegram, Discord, etc.)
 * means creating a new class that implements this interface.
 * No existing code needs to change.
 *
 * Event subscription methods allow the route layer to push events
 * without knowing the channel type.
 */
export interface IChannel {
  /** Unique id matching the id field in openaidy.json channels[] */
  readonly id: string;
  /** Channel type string e.g. 'whatsapp', 'telegram' */
  readonly type: string;
  /** Agent ID configured for this channel (used for routing messages) */
  readonly agentId: string;
  /** Current connection state */
  getStatus(): ChannelStatus;

  /**
   * Start the channel connection.
   * For WhatsApp: opens the Baileys socket and begins QR flow.
   * For Telegram: registers webhook endpoint.
   * Resolves immediately; status updates arrive via onStatusChange.
   */
  connect(): Promise<void>;
  /**
   * Tear down the connection cleanly.
   * For WhatsApp: calls socket.logout() and clears credentials.
   * For Telegram: unregisters webhook.
   */
  disconnect(): Promise<void>;

  /** Register a callback invoked each time the connection status changes */
  onStatusChange(cb: (status: ChannelStatus) => void): void;
  /** Remove a registered status change callback */
  removeListener(event: 'status', cb: (status: ChannelStatus) => void): void;
}

/**
 * Interface for channels that support QR code authentication.
 * WhatsApp uses QR codes; Telegram/Discord use bot tokens instead.
 * Only channels that need QR should implement this.
 */
export interface IQrChannel extends IChannel {
  /**
   * Current QR code as a base64 PNG string.
   * Returns null when status is not 'qr'.
   */
  getQr(): string | null;

  /** Register a callback invoked each time a new QR code is available */
  onQrUpdate(cb: (qr: string) => void): void;
  /** Remove a registered QR callback */
  removeListener(event: 'qr', cb: (qr: string) => void): void;
}
