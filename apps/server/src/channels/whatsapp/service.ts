import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
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
import { bareId, extractText, resolveSenderIds } from './inbound.js';

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
  private lastError: string | undefined;
  private socket: ReturnType<typeof makeWASocket> | null = null;
  /** Ids of replies we sent, so their echoes don't re-trigger the handler. */
  private readonly sentMessageIds = new Set<string>();

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

  getLastError(): string | undefined {
    return this.lastError;
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

  /** Remove a registered status change callback */
  removeListener(event: 'status', cb: (status: ChannelStatus) => void): this {
    return super.removeListener(event, cb);
  }

  /** Remove a registered QR code callback */
  removeQrListener(cb: (qr: string) => void): this {
    return super.removeListener('qr', cb);
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

    const socketConfig: Parameters<typeof makeWASocket>[0] = {
      version,
      auth: state,
      printQRInTerminal: false,
      browser: ['OpenAidy', '1.0.0', 'Ubuntu'],
      // A reply bot has no use for chat history. Skip syncing it so the socket
      // isn't busy downloading the full history on every (re)connect — that
      // flood can starve live message processing.
      syncFullHistory: false,
      shouldSyncHistoryMessage: () => false,
    };

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
          this.lastError = undefined;
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
          this.lastError = err instanceof Error ? err.message : String(err);
          this.setStatus('error');
        }
      }

      if (connection === 'open') {
        this.qr = null;
        this.lastError = undefined;
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
        // Skip our own outbound replies echoing back — prevents reply loops
        // (a bot reply in the self-chat re-arrives as a fromMe message).
        if (msg.key.id && this.sentMessageIds.has(msg.key.id)) {
          this.sentMessageIds.delete(msg.key.id);
          continue;
        }

        // fromMe messages are the account owner's own. Only action them in the
        // self-chat ("Message Yourself"), so the bot works as a personal
        // assistant there without hijacking messages the user sends to other
        // people. Messages from others arrive with fromMe=false and are always
        // processed.
        if (msg.key.fromMe && !this.isSelfChat(msg.key)) continue;

        const text = extractText(msg.message);
        if (!text) continue;

        // WhatsApp may address the sender by phone number (PN) or Linked
        // Identity (LID). Resolve every id form — including the PN behind a
        // LID — so phone-number allowlists and pre-LID session keys still work.
        const { primary: waId, candidates } = await resolveSenderIds(
          msg.key,
          (lidJid) => this.resolvePnForLid(lidJid),
        );

        if (!waId) {
          this.deps.logger.warn(
            { channelId: this.id, key: msg.key },
            'whatsapp: could not resolve sender id for inbound message, skipping',
          );
          continue;
        }

        try {
          const reply = await handleInboundWhatsAppMessage({
            waId,
            candidateIds: candidates,
            text,
            channelId: this.id,
            agentId: this.config.agentId,
            allowlist: this.config.allowlist,
            sessionService: this.deps.sessionService,
            logger: this.deps.logger,
          });

          if (reply && this.socket) {
            const sent = await this.socket.sendMessage(msg.key.remoteJid!, {
              text: reply,
            });
            // Remember the id so the echo of our own reply is ignored above.
            if (sent?.key?.id) this.sentMessageIds.add(sent.key.id);
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

  /**
   * True when a message key belongs to the self-chat ("Message Yourself") —
   * i.e. the conversation is with our own account (matched on either the PN or
   * LID form of our identity).
   */
  private isSelfChat(key: {
    remoteJid?: string | null;
    remoteJidAlt?: string | null;
  }): boolean {
    const me = [this.socket?.user?.id, this.socket?.user?.lid]
      .map((j) => bareId(j))
      .filter(Boolean);
    if (!me.length) return false;
    const chat = [key.remoteJid, key.remoteJidAlt]
      .map((j) => bareId(j))
      .filter(Boolean);
    return chat.some((c) => me.includes(c));
  }

  /**
   * Resolve the phone number behind a LID, bounded by a short timeout so a
   * slow/blocked signal-store lookup can never stall inbound processing.
   * Returns null on timeout, error, or when no mapping is known.
   */
  private async resolvePnForLid(lidJid: string): Promise<string | null> {
    const lookup =
      this.socket?.signalRepository?.lidMapping?.getPNForLID(lidJid);
    if (!lookup) return null;
    const timeout = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), 2000),
    );
    try {
      return await Promise.race([lookup, timeout]);
    } catch {
      return null;
    }
  }
}
