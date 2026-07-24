import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  type Message,
} from 'discord.js';
import { EventEmitter } from 'node:events';
import type { IChannel } from '../interface.js';
import type { ChannelStatus } from '@openaidy/shared-types';
import type { DiscordChannelConfig } from '@openaidy/config';
import type { DiscordChannelDeps } from './types.js';
import { handleInboundChannelMessage } from '../message-handler.js';
import { resolveBotToken } from './secret.js';

/** Discord hard limit on a single message's content length. */
const DISCORD_MAX_MESSAGE_LENGTH = 2000;

/**
 * Discord channel implementation using discord.js.
 *
 * Token-based (no QR), so it implements the base {@link IChannel} — not
 * IQrChannel. Owns the discord.js gateway client lifecycle; delegates all
 * message processing and LLM invocation to the shared channel message handler.
 *
 * Trigger rules (see {@link DiscordChannelConfig}): replies to DMs (optionally
 * restricted to `dmAllowlist`), to messages in `channelAllowlist` server
 * channels, and — when `respondToMentions` — to server messages that @mention
 * the bot.
 */
export class DiscordChannel extends EventEmitter implements IChannel {
  readonly id: string;
  readonly type = 'discord' as const;
  readonly agentId: string;

  private status: ChannelStatus = 'disconnected';
  private client: Client | null = null;

  constructor(
    private readonly config: DiscordChannelConfig,
    private readonly deps: DiscordChannelDeps,
  ) {
    super();
    this.id = config.id;
    this.agentId = config.agentId;
  }

  getStatus(): ChannelStatus {
    return this.status;
  }

  onStatusChange(cb: (status: ChannelStatus) => void): void {
    this.on('status', cb);
  }

  /** Remove a registered status change callback */
  removeListener(event: 'status', cb: (status: ChannelStatus) => void): this {
    return super.removeListener(event, cb);
  }

  async connect(): Promise<void> {
    if (this.client) {
      this.deps.logger.warn(
        { channelId: this.id },
        'discord: connect() called while already connected',
      );
      return;
    }

    let token: string;
    try {
      token = resolveBotToken(this.config.botToken);
    } catch (err) {
      this.deps.logger.error(
        { err, channelId: this.id },
        'discord: failed to resolve bot token',
      );
      this.setStatus('error');
      return;
    }

    const client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
      // Required to receive DMs (their channel isn't cached up front).
      partials: [Partials.Channel],
    });
    this.client = client;

    client.once(Events.ClientReady, () => {
      this.setStatus('connected');
      this.deps.logger.info({ channelId: this.id }, 'discord: connected');
    });

    client.on(Events.MessageCreate, (message) => {
      void this.handleMessage(message);
    });

    client.on(Events.Error, (err) => {
      this.deps.logger.error(
        { err, channelId: this.id },
        'discord: client error',
      );
      this.setStatus('error');
    });

    try {
      await client.login(token);
    } catch (err) {
      this.deps.logger.error(
        { err, channelId: this.id },
        'discord: login failed',
      );
      this.client = null;
      this.setStatus('error');
    }
  }

  async disconnect(): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.destroy();
    } catch {
      // destroy can throw if the client is already torn down
    }
    this.client = null;
    this.setStatus('disconnected');
  }

  /**
   * Decide whether an inbound message should be answered, extract its text,
   * dispatch to the agent, and reply. Errors are logged, never thrown.
   */
  private async handleMessage(message: Message): Promise<void> {
    try {
      // Ignore bots (including our own replies) — prevents loops.
      if (message.author?.bot) return;

      const isDm = message.guildId == null;
      if (isDm) {
        const allow = this.config.dmAllowlist;
        if (allow?.length && !allow.includes(message.author.id)) return;
      } else {
        const inAllowedChannel =
          this.config.channelAllowlist?.includes(message.channelId) ?? false;
        const mentioned =
          this.config.respondToMentions !== false &&
          !!this.client?.user &&
          message.mentions.has(this.client.user.id);
        if (!inAllowedChannel && !mentioned) return;
      }

      // Strip a leading bot @mention (mention-triggered server messages).
      let text = message.content ?? '';
      if (this.client?.user) {
        text = text
          .replace(new RegExp(`^<@!?${this.client.user.id}>\\s*`), '')
          .trim();
      }
      if (!text) return;

      const reply = await handleInboundChannelMessage({
        channelType: 'discord',
        senderId: message.author.id,
        text,
        channelId: this.id,
        agentId: this.config.agentId,
        // Gating (DM/mention/channel) is applied above; the handler's own
        // allowlist is unused for Discord.
        allowlist: undefined,
        sessionService: this.deps.sessionService,
        logger: this.deps.logger,
      });

      if (reply) {
        for (const part of splitForDiscord(reply)) {
          await message.reply(part);
        }
      }
    } catch (err) {
      this.deps.logger.error(
        { err, channelId: this.id },
        'discord: unhandled error processing inbound message',
      );
    }
  }

  private setStatus(s: ChannelStatus): void {
    this.status = s;
    this.emit('status', s);
  }
}

/** Split a reply into Discord-sized (<=2000 char) chunks. */
function splitForDiscord(text: string): string[] {
  if (text.length <= DISCORD_MAX_MESSAGE_LENGTH) return [text];
  const parts: string[] = [];
  for (let i = 0; i < text.length; i += DISCORD_MAX_MESSAGE_LENGTH) {
    parts.push(text.slice(i, i + DISCORD_MAX_MESSAGE_LENGTH));
  }
  return parts;
}
