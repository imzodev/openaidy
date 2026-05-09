import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  type SocketConfig,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import QRCode from 'qrcode';
import { EventEmitter } from 'node:events';
import type { IQrChannel } from '../interface.js';
import type { ChannelStatus } from '@openaidy/shared-types';
import type { WhatsAppChannelConfig } from '@openaidy/config';
import type { WhatsAppChannelDeps } from './types.js';
import { createWhatsAppAuthStore } from './auth-store.js';
import { handleInboundWhatsAppMessage } from './message-handler.js';

/**
 * WhatsApp channel implementation using Baileys.
 *
 * Owns the socket lifecycle. Delegates all message processing and LLM
 * invocation to message-handler.ts (which calls SessionMessageService).
 * No Baileys imports in message-handler — clean separation of concerns.
 */
export class WhatsAppChannel extends EventEmitter implements IQrChannel {
  readonly id: string;
  readonly type = 'whatsapp' as const;
  readonly agentId: string;

  private status: ChannelStatus = 'disconnected';
  private qr: string | null = null;
  private socket: ReturnType<typeof makeWASocket> | null = null;

  constructor(
    private readonly config: WhatsAppChannelConfig,
    private readonly deps: WhatsAppChannelDeps,
  ) {
    super();
    this.id = config.id;
    this.agentId = config.agentId;
  }

  getStatus(): ChannelStatus {
    return this.status;
  }

  getQr(): string | null {
    return this.qr;
  }

  onQrUpdate(cb: (qr: string) => void): void {
    this.on('qr', cb);
  }

  onStatusChange(cb: (status: ChannelStatus) => void): void {
    this.on('status', cb);
  }

  async connect(): Promise<void> {
    if (this.socket) {
      this.deps.logger.warn(
        { channelId: this.id },
        'whatsapp: connect() called while already connected',
      );
      return;
    }

    const { state, saveCreds } = await createWhatsAppAuthStore(
      this.deps.authBaseDir,
      this.id,
    );
    const { version } = await fetchLatestBaileysVersion();

    const socketConfig: SocketConfig = {
      version,
      auth: state,
      printQRInTerminal: false,
      browser: ['OpenAidy', '1.0.0', 'Ubuntu'],
    } as SocketConfig;

    this.socket = makeWASocket(socketConfig);

    this.socket.ev.on('creds.update', saveCreds);

    this.socket.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        try {
          this.deps.logger.info(
            { channelId: this.id },
            'whatsapp: QR code received from Baileys',
          );
          const dataUrl = await QRCode.toDataURL(qr);
          this.qr = dataUrl.replace('data:image/png;base64,', '');
          this.setStatus('qr');
          this.deps.logger.info(
            { channelId: this.id, qrLength: this.qr.length },
            'whatsapp: emitting qr event to listeners',
          );
          this.emit('qr', this.qr);
        } catch (err) {
          this.deps.logger.error(
            { err },
            'whatsapp: failed to generate QR PNG',
          );
          this.setStatus('error');
        }
      }

      if (connection === 'open') {
        this.qr = null;
        this.setStatus('connected');
        this.deps.logger.info({ channelId: this.id }, 'whatsapp: connected');
      }

      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;

        // Capture old socket reference before nulling so we can clean up listeners
        const oldSocket = this.socket;
        this.socket = null;
        this.qr = null;
        this.setStatus('disconnected');

        if (loggedOut) {
          this.deps.logger.info(
            { channelId: this.id },
            'whatsapp: logged out, not reconnecting',
          );
        } else {
          this.deps.logger.info(
            { channelId: this.id },
            'whatsapp: connection closed, reconnecting',
          );
          // @ts-expect-error Baileys ev.removeAllListeners takes no args at runtime but types are mismatched
          oldSocket?.ev.removeAllListeners();
          await this.connect();
        }
      }
    });

    this.socket.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const msg of messages) {
        const text =
          msg.message?.conversation ?? msg.message?.extendedTextMessage?.text;
        if (!text) continue;

        const participant = msg.key.participant?.replace('@s.whatsapp.net', '');
        const remoteJid = msg.key.remoteJid?.replace('@s.whatsapp.net', '');
        const remoteJidAlt = msg.key.remoteJidAlt?.replace('@s.whatsapp.net', '');

        let waId = participant || remoteJid || remoteJidAlt || '';
        if (remoteJid?.includes('@lid')) {
          waId = remoteJidAlt || participant || '';
        }
        if (!waId) continue;

        try {
          const reply = await handleInboundWhatsAppMessage({
            waId,
            text,
            channelId: this.id,
            agentId: this.config.agentId,
            allowlist: this.config.allowlist,
            sessionService: this.deps.sessionService,
            logger: this.deps.logger,
          });

          if (reply && this.socket) {
            await this.socket.sendMessage(msg.key.remoteJid!, { text: reply });
          }
        } catch (err) {
          this.deps.logger.error(
            { err, waId, channelId: this.id },
            'whatsapp: unhandled error processing inbound message',
          );
        }
      }
    });
  }

  async disconnect(): Promise<void> {
    if (!this.socket) return;
    try {
      await this.socket.logout();
    } catch {
      // logout can throw if already disconnected
    }
    this.socket = null;
    this.qr = null;
    this.setStatus('disconnected');
  }

  private setStatus(s: ChannelStatus): void {
    this.status = s;
    this.emit('status', s);
  }
}
