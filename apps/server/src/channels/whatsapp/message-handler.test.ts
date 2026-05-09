import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  handleInboundWhatsAppMessage,
  clearSessionMapForTesting,
} from './message-handler.js';
import type { SessionRecord } from '../../sessions/store.js';

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
  waId: '15551234567',
  text: 'Hello agent',
  channelId: 'personal',
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
    title: 'whatsapp:personal:15551234567',
    createdAt: new Date().toISOString(),
  });
  mockSessionService.submitMessageNonStreaming.mockResolvedValue({
    ok: true,
    assistantMessage: { content: 'Hello human!' },
  });
});

describe('handleInboundWhatsAppMessage', () => {
  it('returns agent reply text for allowed sender', async () => {
    const reply = await handleInboundWhatsAppMessage({
      ...baseParams,
      allowlist: ['15551234567'],
    });
    expect(reply).toBe('Hello human!');
  });

  it('rejects message when sender not in allowlist', async () => {
    const reply = await handleInboundWhatsAppMessage({
      ...baseParams,
      allowlist: ['99999999'],
    });
    expect(reply).toBeNull();
    expect(mockSessionService.submitMessageNonStreaming).not.toHaveBeenCalled();
  });

  it('rejects message when allowlist is empty', async () => {
    const reply = await handleInboundWhatsAppMessage({
      ...baseParams,
      allowlist: [],
    });
    expect(reply).toBeNull();
  });

  it('rejects message when allowlist is undefined', async () => {
    const reply = await handleInboundWhatsAppMessage({
      ...baseParams,
      allowlist: undefined,
    });
    expect(reply).toBeNull();
  });

  it('returns null and logs error when agent invocation fails', async () => {
    mockSessionService.submitMessageNonStreaming.mockResolvedValue({
      ok: false,
      error: { code: 'provider.error', message: 'timeout' },
    });
    const reply = await handleInboundWhatsAppMessage({
      ...baseParams,
      allowlist: ['15551234567'],
    });
    expect(reply).toBeNull();
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it('reuses existing session on second message from same sender', async () => {
    mockSessionService.listSessions.mockResolvedValueOnce([
      {
        id: 'existing-session',
        title: 'whatsapp:personal:15551234567',
        createdAt: new Date().toISOString(),
      },
    ]);
    await handleInboundWhatsAppMessage({
      ...baseParams,
      allowlist: ['15551234567'],
    });
    expect(mockSessionService.createSession).not.toHaveBeenCalled();
    expect(mockSessionService.submitMessageNonStreaming).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'existing-session' }),
    );
  });
});
