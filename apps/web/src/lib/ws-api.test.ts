import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebSocketClient } from '@openaidy/sdk';
import {
  listSessions,
  setWebSocketApiClient,
  submitMessage,
  listMessages,
  listRuns,
  listAgents,
  type SubmitMessageResult,
} from './ws-api';
import {
  listSessions as listSessionsRest,
  submitMessage as submitMessageRest,
  listMessages as listMessagesRest,
  listRuns as listRunsRest,
  listAgents as listAgentsRest,
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
  listMessages: vi.fn().mockResolvedValue({
    items: [
      {
        id: 'rest-msg-1',
        sessionId: 'session-1',
        role: 'user',
        content: 'hello',
        sequence: 1,
        createdAt: '2024-01-01T00:00:00Z',
      },
    ],
  }),
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
  listAgents: vi.fn().mockResolvedValue({
    items: [
      {
        id: 'rest-agent-1',
        name: 'REST Agent',
        description: 'Agent from REST',
        enabled: true,
        systemPrompt: '',
        model: 'openai/gpt-4o-mini',
        defaults: {},
      },
    ],
  }),
  listRuns: vi.fn().mockResolvedValue({
    items: [
      {
        id: 'rest-run-1',
        sessionId: 'session-1',
        providerId: 'openai',
        modelId: 'gpt-4o-mini',
        status: 'succeeded',
        createdAt: '2024-01-01T00:00:00Z',
      },
    ],
  }),
}));

describe('ws-api', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setWebSocketApiClient(null);
  });

  // listSessions tests
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

  // submitMessage tests
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

  // listMessages tests
  it('should use websocket client for listMessages when connected', async () => {
    const mockClient = {
      isConnected: () => true,
      listMessages: vi.fn().mockResolvedValue({
        type: 'session.messages',
        payload: {
          sessionId: 'session-1',
          messages: [
            {
              id: 'ws-msg-1',
              sessionId: 'session-1',
              role: 'user',
              content: 'hello from ws',
              sequence: 1,
              createdAt: '2024-01-01T00:00:00Z',
            },
          ],
          total: 1,
        },
      }),
    } as unknown as WebSocketClient;

    setWebSocketApiClient(mockClient);

    const result = await listMessages('session-1');

    if ('items' in result) {
      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.id).toBe('ws-msg-1');
      expect(result.items[0]?.content).toBe('hello from ws');
    }
    expect(vi.mocked(listMessagesRest)).not.toHaveBeenCalled();
  });

  it('should fallback to REST listMessages when websocket is unavailable', async () => {
    setWebSocketApiClient(null);

    const result = await listMessages('session-1');

    expect(vi.mocked(listMessagesRest)).toHaveBeenCalledTimes(1);
    if ('items' in result) {
      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.id).toBe('rest-msg-1');
    }
  });

  it('should fallback to REST listMessages when websocket response type is unexpected', async () => {
    const mockClient = {
      isConnected: () => true,
      listMessages: vi.fn().mockResolvedValue({
        type: 'unexpected.type',
        payload: {},
      }),
    } as unknown as WebSocketClient;

    setWebSocketApiClient(mockClient);

    const result = await listMessages('session-1');

    expect(vi.mocked(listMessagesRest)).toHaveBeenCalledTimes(1);
    if ('items' in result) {
      expect(result.items[0]?.id).toBe('rest-msg-1');
    }
  });

  // listRuns tests
  it('should use websocket client for listRuns when connected', async () => {
    const mockClient = {
      isConnected: () => true,
      listRuns: vi.fn().mockResolvedValue({
        type: 'session.runs',
        payload: {
          sessionId: 'session-1',
          runs: [
            {
              id: 'ws-run-1',
              sessionId: 'session-1',
              providerId: 'anthropic',
              modelId: 'claude-3-opus',
              status: 'succeeded',
              createdAt: '2024-01-01T00:00:00Z',
            },
          ],
          total: 1,
        },
      }),
    } as unknown as WebSocketClient;

    setWebSocketApiClient(mockClient);

    const result = await listRuns('session-1');

    if ('items' in result) {
      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.id).toBe('ws-run-1');
      expect(result.items[0]?.providerId).toBe('anthropic');
    }
    expect(vi.mocked(listRunsRest)).not.toHaveBeenCalled();
  });

  it('should fallback to REST listRuns when websocket is unavailable', async () => {
    setWebSocketApiClient(null);

    const result = await listRuns('session-1');

    expect(vi.mocked(listRunsRest)).toHaveBeenCalledTimes(1);
    if ('items' in result) {
      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.id).toBe('rest-run-1');
    }
  });

  it('should fallback to REST listRuns when websocket response type is unexpected', async () => {
    const mockClient = {
      isConnected: () => true,
      listRuns: vi.fn().mockResolvedValue({
        type: 'unexpected.type',
        payload: {},
      }),
    } as unknown as WebSocketClient;

    setWebSocketApiClient(mockClient);

    const result = await listRuns('session-1');

    expect(vi.mocked(listRunsRest)).toHaveBeenCalledTimes(1);
    if ('items' in result) {
      expect(result.items[0]?.id).toBe('rest-run-1');
    }
  });

  // listAgents tests
  it('should use websocket client for listAgents when connected', async () => {
    const mockClient = {
      isConnected: () => true,
      listAgents: vi.fn().mockResolvedValue({
        type: 'agent.list',
        payload: {
          agents: [
            {
              id: 'ws-agent-1',
              name: 'WS Agent',
              description: 'Agent from WS',
              tools: [],
            },
          ],
        },
      }),
    } as unknown as WebSocketClient;

    setWebSocketApiClient(mockClient);

    const result = await listAgents();

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.id).toBe('ws-agent-1');
    expect(result.items[0]?.name).toBe('WS Agent');
    expect(vi.mocked(listAgentsRest)).not.toHaveBeenCalled();
  });

  it('should fallback to REST listAgents when websocket is unavailable', async () => {
    setWebSocketApiClient(null);

    const result = await listAgents();

    expect(vi.mocked(listAgentsRest)).toHaveBeenCalledTimes(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.id).toBe('rest-agent-1');
  });

  it('should fallback to REST listAgents when websocket response type is unexpected', async () => {
    const mockClient = {
      isConnected: () => true,
      listAgents: vi.fn().mockResolvedValue({
        type: 'unexpected.type',
        payload: {},
      }),
    } as unknown as WebSocketClient;

    setWebSocketApiClient(mockClient);

    const result = await listAgents();

    expect(vi.mocked(listAgentsRest)).toHaveBeenCalledTimes(1);
    expect(result.items[0]?.id).toBe('rest-agent-1');
  });
});
