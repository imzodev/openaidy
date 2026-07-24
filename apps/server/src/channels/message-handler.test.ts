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
});
