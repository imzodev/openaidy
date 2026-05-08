import type { ChannelStatus } from '@openaidy/shared-types';

/**
 * Contract that every channel implementation must satisfy.
 *
 * Open/Closed principle: adding a new channel (Telegram, Discord, etc.)
 * means creating a new class that implements this interface.
 * No existing code needs to change.
 *
 * Event subscription methods (onQrUpdate, onStatusChange) allow the
 * route layer to push SSE events without knowing the channel type.
 */
export interface IChannel {
  /** Unique id matching the id field in openaidy.json channels[] */
  readonly id: string;
  /** Channel type string e.g. 'whatsapp', 'telegram' */
  readonly type: string;
  /** Current connection state */
  getStatus(): ChannelStatus;

  /**
   * Current QR code as a base64 PNG string.
   * Returns null when status is not 'qr'.
   */
  getQr(): string | null;

  /**
   * Start the channel connection.
   * For WhatsApp: opens the Baileys socket and begins QR flow.
   * Resolves immediately; status updates arrive via onStatusChange.
   */
  connect(): Promise<void>;
  /**
   * Tear down the connection cleanly.
   * For WhatsApp: calls socket.logout() and clears credentials.
   */
  disconnect(): Promise<void>;

  /** Register a callback invoked each time a new QR code is available */
  onQrUpdate(cb: (qr: string) => void): void;
  /** Register a callback invoked each time the connection status changes */
  onStatusChange(cb: (status: ChannelStatus) => void): void;
}
