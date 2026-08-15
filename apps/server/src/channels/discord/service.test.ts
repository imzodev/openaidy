/**
 * Discord Channel Tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import type { DiscordChannelConfig } from '@openaidy/config';
import type { DiscordChannelDeps } from './types.js';
import { clearSessionMapForTesting } from '../message-handler.js';

// --- Mock discord.js -------------------------------------------------------
class MockClient {
  static lastInstance: MockClient | null = null;
  static lastToken: string | null = null;
  /** Set before connect() to make the next login() call reject with this. */
  static nextLoginError: unknown = null;

  options: unknown;
  user = { id: 'bot-123' };
  private onceHandlers = new Map<string, (...a: unknown[]) => unknown>();
  private onHandlers = new Map<string, (...a: unknown[]) => unknown>();

  login = vi.fn(async (token: string) => {
    MockClient.lastToken = token;
    if (MockClient.nextLoginError) {
      const err = MockClient.nextLoginError;
      MockClient.nextLoginError = null;
      throw err;
    }
  });
  destroy = vi.fn(async () => {});

  constructor(options: unknown) {
    this.options = options;
    MockClient.lastInstance = this;
  }

  once(event: string, cb: (...a: unknown[]) => unknown): this {
    this.onceHandlers.set(event, cb);
    return this;
  }
  on(event: string, cb: (...a: unknown[]) => unknown): this {
    this.onHandlers.set(event, cb);
    return this;
  }

  emitReady(): void {
    this.onceHandlers.get('clientReady')?.();
  }
  emitMessage(msg: unknown): void {
    this.onHandlers.get('messageCreate')?.(msg);
  }
  emitError(err: unknown): void {
    this.onHandlers.get('error')?.(err);
  }
}

vi.mock('discord.js', () => ({
  Client: MockClient,
  Events: {
    ClientReady: 'clientReady',
    MessageCreate: 'messageCreate',
    Error: 'error',
  },
  GatewayIntentBits: {
    Guilds: 1,
    GuildMessages: 2,
    MessageContent: 4,
    DirectMessages: 8,
  },
  Partials: { Channel: 'Channel' },
}));

// Wait a macrotask so the fire-and-forget async message handler settles.
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('DiscordChannel', () => {
  let deps: DiscordChannelDeps;
  let submit: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    clearSessionMapForTesting();
    MockClient.lastInstance = null;
    MockClient.lastToken = null;
    MockClient.nextLoginError = null;
    submit = vi.fn(async () => ({
      ok: true as const,
      assistantMessage: { content: 'reply!' },
    }));
    deps = {
      authBaseDir: '/tmp/oa-discord-test',
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      } as unknown as FastifyBaseLogger,
      sessionService: {
        listSessions: vi.fn(async () => []),
        createSession: vi.fn(async () => ({
          id: 's1',
          title: 't',
          createdAt: '',
        })),
        submitMessageNonStreaming: submit,
      } as unknown as DiscordChannelDeps['sessionService'],
    };
  });

  function cfg(
    overrides: Partial<DiscordChannelConfig> = {},
  ): DiscordChannelConfig {
    return {
      type: 'discord',
      id: 'd1',
      agentId: 'a1',
      botToken: { kind: 'inline', value: 'plain-token' },
      respondToMentions: true,
      enabled: true,
      ...overrides,
    };
  }

  function message(overrides: Record<string, unknown> = {}) {
    return {
      author: { bot: false, id: 'user-1' },
      guildId: null,
      channelId: 'chan-1',
      content: 'hello bot',
      mentions: { has: vi.fn(() => false) },
      reply: vi.fn(async () => {}),
      ...overrides,
    };
  }

  async function connected(config: DiscordChannelConfig) {
    const { DiscordChannel } = await import('./service.js');
    const channel = new DiscordChannel(config, deps);
    await channel.connect();
    const client = MockClient.lastInstance!;
    client.emitReady();
    return { channel, client };
  }

  it('exposes id/type/agentId from config', async () => {
    const { DiscordChannel } = await import('./service.js');
    const channel = new DiscordChannel(cfg(), deps);
    expect(channel.id).toBe('d1');
    expect(channel.type).toBe('discord');
    expect(channel.agentId).toBe('a1');
  });

  it('logs in with the resolved token and connects on ready', async () => {
    const { channel } = await connected(cfg());
    expect(MockClient.lastToken).toBe('plain-token');
    expect(channel.getStatus()).toBe('connected');
  });

  it('sets error status when the bot token env var is missing', async () => {
    const { DiscordChannel } = await import('./service.js');
    const channel = new DiscordChannel(
      cfg({ botToken: { kind: 'env', value: 'MISSING_DISCORD_TOKEN' } }),
      deps,
    );
    await channel.connect();
    expect(channel.getStatus()).toBe('error');
    expect(MockClient.lastInstance).toBeNull();
    expect(channel.getLastError()).toBeDefined();
  });

  it('translates a disallowed-intents login failure into an actionable message', async () => {
    MockClient.nextLoginError = new Error('Used disallowed intents');
    const { DiscordChannel } = await import('./service.js');
    const channel = new DiscordChannel(cfg(), deps);

    await channel.connect();

    expect(channel.getStatus()).toBe('error');
    expect(channel.getLastError()).toMatch(/message content intent/i);
    expect(channel.getLastError()).toMatch(/developer portal/i);
  });

  it('surfaces other login failures as their own message', async () => {
    MockClient.nextLoginError = new Error('An invalid token was provided.');
    const { DiscordChannel } = await import('./service.js');
    const channel = new DiscordChannel(cfg(), deps);

    await channel.connect();

    expect(channel.getStatus()).toBe('error');
    expect(channel.getLastError()).toBe('An invalid token was provided.');
  });

  it('sets getLastError() from a client error event after a successful login', async () => {
    const { channel, client } = await connected(cfg());
    expect(channel.getLastError()).toBeUndefined();

    client.emitError(new Error('websocket closed unexpectedly'));

    expect(channel.getStatus()).toBe('error');
    expect(channel.getLastError()).toBe('websocket closed unexpectedly');
  });

  it('clears a previous error once a reconnect succeeds', async () => {
    MockClient.nextLoginError = new Error('Used disallowed intents');
    const { DiscordChannel } = await import('./service.js');
    const channel = new DiscordChannel(cfg(), deps);
    await channel.connect();
    expect(channel.getLastError()).toBeDefined();

    // Login succeeds this time; getLastError() should reset once ready.
    await channel.connect();
    MockClient.lastInstance!.emitReady();

    expect(channel.getStatus()).toBe('connected');
    expect(channel.getLastError()).toBeUndefined();
  });

  it('replies to a DM from an allowed sender', async () => {
    const { client } = await connected(cfg());
    const m = message({ guildId: null });
    client.emitMessage(m);
    await tick();
    expect(submit).toHaveBeenCalled();
    expect(m.reply).toHaveBeenCalledWith('reply!');
  });

  it('ignores a DM from a sender not in dmAllowlist', async () => {
    const { client } = await connected(cfg({ dmAllowlist: ['other-user'] }));
    const m = message({ guildId: null, author: { bot: false, id: 'user-1' } });
    client.emitMessage(m);
    await tick();
    expect(submit).not.toHaveBeenCalled();
    expect(m.reply).not.toHaveBeenCalled();
  });

  it('ignores messages authored by bots', async () => {
    const { client } = await connected(cfg());
    const m = message({ author: { bot: true, id: 'bot-999' } });
    client.emitMessage(m);
    await tick();
    expect(submit).not.toHaveBeenCalled();
  });

  it('replies to a server message that @mentions the bot and strips the mention', async () => {
    const { client } = await connected(cfg());
    const m = message({
      guildId: 'g1',
      channelId: 'c1',
      content: '<@bot-123> what is up',
      mentions: { has: vi.fn(() => true) },
    });
    client.emitMessage(m);
    await tick();
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'what is up' }),
    );
    expect(m.reply).toHaveBeenCalledWith('reply!');
  });

  it('ignores a server message with no mention and channel not allowlisted', async () => {
    const { client } = await connected(cfg({ respondToMentions: true }));
    const m = message({
      guildId: 'g1',
      channelId: 'c1',
      mentions: { has: vi.fn(() => false) },
    });
    client.emitMessage(m);
    await tick();
    expect(submit).not.toHaveBeenCalled();
  });

  it('replies to any message in an allowlisted server channel', async () => {
    const { client } = await connected(
      cfg({ channelAllowlist: ['c1'], respondToMentions: false }),
    );
    const m = message({
      guildId: 'g1',
      channelId: 'c1',
      mentions: { has: vi.fn(() => false) },
    });
    client.emitMessage(m);
    await tick();
    expect(m.reply).toHaveBeenCalledWith('reply!');
  });

  it('destroys the client and reports disconnected on disconnect', async () => {
    const { channel, client } = await connected(cfg());
    await channel.disconnect();
    expect(client.destroy).toHaveBeenCalled();
    expect(channel.getStatus()).toBe('disconnected');
  });
});
