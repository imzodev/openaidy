import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  handleInboundChannelMessage,
  buildChannelSessionKey,
  clearSessionMapForTesting,
} from './message-handler.js';
import type { SessionRecord } from '../types.js';

const mockSessionService = {
  listSessions: vi.fn<() => Promise<SessionRecord[]>>(),
  createSession: vi.fn<() => Promise<SessionRecord>>(),
  submitMessageNonStreaming:
    vi.fn<
      () => Promise<
        | { ok: true; assistantMessage: { content: string } }
        | { ok: false; error: { code: string; message: string } }
      >
    >(),
};

const mockLogger = {
  debug: vi.fn<() => void>(),
  info: vi.fn<() => void>(),
  warn: vi.fn<() => void>(),
  error: vi.fn<(err: unknown) => void>(),
};

const baseParams = {
  channelType: 'discord',
  senderId: 'user-1',
  text: 'Hello agent',
  channelId: 'server',
  agentId: 'my-agent',
  allowlist: undefined as string[] | undefined,
  sessionService: mockSessionService,
  logger: mockLogger as unknown as import('fastify').FastifyBaseLogger,
};

beforeEach(() => {
  vi.clearAllMocks();
  clearSessionMapForTesting();
  mockSessionService.listSessions.mockResolvedValue([]);
  mockSessionService.createSession.mockResolvedValue({
    id: 'session-123',
    title: 'discord:server:user-1',
    createdAt: new Date().toISOString(),
  });
  mockSessionService.submitMessageNonStreaming.mockResolvedValue({
    ok: true,
    assistantMessage: { content: 'Hello human!' },
  });
});

describe('buildChannelSessionKey', () => {
  it('namespaces by channel type, channel id, and sender', () => {
    expect(buildChannelSessionKey('discord', 'server', 'user-1')).toBe(
      'discord:server:user-1',
    );
    expect(buildChannelSessionKey('whatsapp', 'personal', '15551234567')).toBe(
      'whatsapp:personal:15551234567',
    );
  });
});

describe('handleInboundChannelMessage', () => {
  it('returns the agent reply and uses a type-prefixed session title', async () => {
    const reply = await handleInboundChannelMessage(baseParams);
    expect(reply).toBe('Hello human!');
    expect(mockSessionService.createSession).toHaveBeenCalledWith(
      'discord:server:user-1',
    );
  });

  it('allows everyone when allowlist is empty/undefined', async () => {
    expect(
      await handleInboundChannelMessage({ ...baseParams, allowlist: [] }),
    ).toBe('Hello human!');
    expect(
      await handleInboundChannelMessage({
        ...baseParams,
        allowlist: undefined,
      }),
    ).toBe('Hello human!');
  });

  it('rejects when a non-empty allowlist excludes every candidate id', async () => {
    const reply = await handleInboundChannelMessage({
      ...baseParams,
      allowlist: ['someone-else'],
    });
    expect(reply).toBeNull();
    expect(mockSessionService.submitMessageNonStreaming).not.toHaveBeenCalled();
  });

  it('matches an allowlist against any candidate id', async () => {
    const reply = await handleInboundChannelMessage({
      ...baseParams,
      candidateIds: ['alias', 'user-1'],
      allowlist: ['user-1'],
    });
    expect(reply).toBe('Hello human!');
  });

  it('returns null and logs when the agent invocation fails', async () => {
    mockSessionService.submitMessageNonStreaming.mockResolvedValue({
      ok: false,
      error: { code: 'provider.error', message: 'timeout' },
    });
    const reply = await handleInboundChannelMessage(baseParams);
    expect(reply).toBeNull();
    expect(mockLogger.error).toHaveBeenCalled();
  });

  describe('stripThinking', () => {
    beforeEach(() => {
      mockSessionService.submitMessageNonStreaming.mockResolvedValue({
        ok: true,
        assistantMessage: {
          content: '<think>let me reason about this...</think>Final answer.',
        },
      });
    });

    it('strips <think> blocks by default (stripThinking omitted)', async () => {
      const reply = await handleInboundChannelMessage(baseParams);
      expect(reply).toBe('Final answer.');
    });

    it('strips <think> blocks when stripThinking is explicitly true', async () => {
      const reply = await handleInboundChannelMessage({
        ...baseParams,
        stripThinking: true,
      });
      expect(reply).toBe('Final answer.');
    });

    it('leaves the raw reply untouched when stripThinking is false', async () => {
      const reply = await handleInboundChannelMessage({
        ...baseParams,
        stripThinking: false,
      });
      expect(reply).toBe(
        '<think>let me reason about this...</think>Final answer.',
      );
    });

    it('is a no-op when the reply has no thinking block', async () => {
      mockSessionService.submitMessageNonStreaming.mockResolvedValue({
        ok: true,
        assistantMessage: { content: 'Plain reply, nothing to strip.' },
      });
      const reply = await handleInboundChannelMessage(baseParams);
      expect(reply).toBe('Plain reply, nothing to strip.');
    });

    it('strips a truncated <think> block with no closing tag', async () => {
      mockSessionService.submitMessageNonStreaming.mockResolvedValue({
        ok: true,
        assistantMessage: {
          content: '<think>reasoning cut off by a max-tokens limit...',
        },
      });
      const reply = await handleInboundChannelMessage(baseParams);
      expect(reply).toBe('');
    });

    it('logs a warning and returns empty when the reply is entirely a think block', async () => {
      mockSessionService.submitMessageNonStreaming.mockResolvedValue({
        ok: true,
        assistantMessage: {
          content: '<think>only reasoning, no visible answer</think>',
        },
      });
      const reply = await handleInboundChannelMessage(baseParams);
      expect(reply).toBe('');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ channelType: 'discord' }),
        expect.stringContaining('nothing to send'),
      );
    });
  });
});
