import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  handleInboundWhatsAppMessage,
  clearSessionMapForTesting,
} from './message-handler.js';

const mockSessionService = {
  listSessions: vi.fn<() => Promise<Array<{ id: string; title: string }>>>(),
  createSession: vi.fn<() => Promise<{ id: string; title: string }>>(),
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

const baseParams: {
  waId: string;
  text: string;
  channelId: string;
  agentId: string;
  allowlist: string[] | undefined;
  sessionService: typeof mockSessionService;
  logger: typeof mockLogger;
} = {
  waId: '15551234567',
  text: 'Hello agent',
  channelId: 'personal',
  agentId: 'my-agent',
  allowlist: undefined,
  sessionService: mockSessionService,
  logger: mockLogger,
};

beforeEach(() => {
  vi.clearAllMocks();
  clearSessionMapForTesting();
  mockSessionService.listSessions.mockResolvedValue([]);
  mockSessionService.createSession.mockResolvedValue({
    id: 'session-123',
    title: 'whatsapp:personal:15551234567',
  });
  mockSessionService.submitMessageNonStreaming.mockResolvedValue({
    ok: true,
    assistantMessage: { content: 'Hello human!' },
  });
});

describe('handleInboundWhatsAppMessage', () => {
  it('returns agent reply text for allowed sender', async () => {
    const reply = await handleInboundWhatsAppMessage(baseParams);
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

  it('allows any sender when allowlist is empty array', async () => {
    const reply = await handleInboundWhatsAppMessage({
      ...baseParams,
      allowlist: [],
    });
    expect(reply).toBe('Hello human!');
  });

  it('returns null and logs error when agent invocation fails', async () => {
    mockSessionService.submitMessageNonStreaming.mockResolvedValue({
      ok: false,
      error: { code: 'provider.error', message: 'timeout' },
    });
    const reply = await handleInboundWhatsAppMessage(baseParams);
    expect(reply).toBeNull();
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it('reuses existing session on second message from same sender', async () => {
    mockSessionService.listSessions.mockResolvedValueOnce([
      { id: 'existing-session', title: 'whatsapp:personal:15551234567' },
    ]);
    await handleInboundWhatsAppMessage(baseParams);
    expect(mockSessionService.createSession).not.toHaveBeenCalled();
    expect(mockSessionService.submitMessageNonStreaming).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'existing-session' }),
    );
  });
});
