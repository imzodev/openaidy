import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebSocketClient } from '@openaidy/sdk';
import {
  listSessions,
  setWebSocketApiClient,
  submitMessage,
  type SubmitMessageResult,
} from './ws-api';
import {
  listSessions as listSessionsRest,
  submitMessage as submitMessageRest,
} from './api';

vi.mock('./api', () => ({
  listSessions: vi.fn().mockResolvedValue({
    items: [
      {
        id: 'rest-1',
        title: 'REST Session',
        createdAt: '2024-01-01T00:00:00Z',
      },
    ],
  }),
  createSession: vi.fn(),
  getSession: vi.fn(),
  listMessages: vi.fn(),
  submitMessage: vi.fn().mockResolvedValue({
    ok: true,
    userMessage: {
      id: 'rest-user-1',
      sessionId: 'session-1',
      role: 'user',
      content: 'hello',
      sequence: 1,
      createdAt: '2024-01-01T00:00:00Z',
    },
    assistantMessage: {
      id: 'rest-assistant-1',
      sessionId: 'session-1',
      role: 'assistant',
      content: 'hello from rest',
      sequence: 2,
      createdAt: '2024-01-01T00:00:01Z',
    },
    run: {
      id: 'rest-run-1',
      sessionId: 'session-1',
      providerId: 'openai',
      modelId: 'gpt-4o-mini',
      status: 'succeeded',
      createdAt: '2024-01-01T00:00:00Z',
    },
  } as SubmitMessageResult),
  listAgents: vi.fn(),
  listRuns: vi.fn(),
}));

describe('ws-api', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setWebSocketApiClient(null);
  });

  it('should use websocket client for listSessions when connected', async () => {
    const mockClient = {
      isConnected: () => true,
      listSessions: vi.fn().mockResolvedValue({
        type: 'session.list',
        payload: {
          sessions: [
            {
              id: 'ws-1',
              title: 'WS Session',
              status: 'active',
              createdAt: '2024-01-01T00:00:00Z',
            },
          ],
          total: 1,
        },
      }),
    } as unknown as WebSocketClient;

    setWebSocketApiClient(mockClient);

    const result = await listSessions();

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.id).toBe('ws-1');
    expect(vi.mocked(listSessionsRest)).not.toHaveBeenCalled();
  });

  it('should use websocket client for submitMessage when connected', async () => {
    const mockClient = {
      isConnected: () => true,
      sendMessage: vi.fn().mockResolvedValue({
        type: 'session.message',
        payload: {
          sessionId: 'session-1',
          messageId: 'assistant-1',
          role: 'assistant',
          content: 'hello from ws',
        },
      }),
    } as unknown as WebSocketClient;

    setWebSocketApiClient(mockClient);

    const result = await submitMessage('session-1', {
      role: 'user',
      content: 'hello',
      providerId: 'openai',
      modelId: 'gpt-4o-mini',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.assistantMessage.id).toBe('assistant-1');
      expect(result.assistantMessage.content).toBe('hello from ws');
      expect(result.run.providerId).toBe('openai');
    }
    expect(vi.mocked(submitMessageRest)).not.toHaveBeenCalled();
  });

  it('should fallback to REST submitMessage when websocket is unavailable', async () => {
    setWebSocketApiClient(null);

    const result = await submitMessage('session-1', {
      role: 'user',
      content: 'fallback me',
    });

    expect(vi.mocked(submitMessageRest)).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.assistantMessage.id).toBe('rest-assistant-1');
    }
  });
});
