import type { WebSocketClient } from '@openaidy/sdk';
import {
  listSessions as listSessionsRest,
  createSession as createSessionRest,
  getSession as getSessionRest,
  listMessages as listMessagesRest,
  submitMessage as submitMessageRest,
  listAgents as listAgentsRest,
  listRuns as listRunsRest,
  type Session,
  type SessionMessage,
  type Agent,
  type SessionRun,
  type ApiError,
  type SubmitMessageInput,
  type SubmitMessageResult,
} from './api';

let activeClient: WebSocketClient | null = null;

export function setWebSocketApiClient(client: WebSocketClient | null): void {
  activeClient = client;
}

export function getWebSocketApiClient(): WebSocketClient | null {
  return activeClient;
}

async function withWebSocketFallback<T>(
  wsCall: (client: WebSocketClient) => Promise<T>,
  fallback: () => Promise<T>,
): Promise<T> {
  const client = activeClient;
  if (!client || !client.isConnected()) {
    return fallback();
  }

  try {
    return await wsCall(client);
  } catch {
    return fallback();
  }
}

export async function listSessions(): Promise<{ items: Session[] }> {
  return withWebSocketFallback(
    async (client) => {
      const response = await client.listSessions();
      if (response.type !== 'session.list') {
        throw new Error('Unexpected response type for session.list');
      }

      return {
        items: response.payload.sessions.map(
          (session: { id: string; title?: string; createdAt: string }) => ({
            id: session.id,
            title: session.title ?? 'Untitled Session',
            createdAt: session.createdAt,
          }),
        ),
      };
    },
    () => listSessionsRest(),
  );
}

export async function createSession(title: string): Promise<Session> {
  return withWebSocketFallback(
    async (client) => {
      const response = await client.createSession({ title });
      if (response.type !== 'session.created') {
        throw new Error('Unexpected response type for session.create');
      }

      return {
        id: response.payload.sessionId,
        title,
        createdAt: response.payload.createdAt,
      };
    },
    () => createSessionRest(title),
  );
}

export async function getSession(id: string): Promise<Session | ApiError> {
  return withWebSocketFallback(
    async (client) => {
      const response = await client.getSession(id);
      if (response.type !== 'session.get') {
        throw new Error('Unexpected response type for session.get');
      }

      return {
        id: response.payload.session.id,
        title: response.payload.session.title ?? 'Untitled Session',
        createdAt: response.payload.session.createdAt,
      };
    },
    () => getSessionRest(id),
  );
}

export async function listMessages(
  sessionId: string,
): Promise<{ items: SessionMessage[] } | ApiError> {
  return listMessagesRest(sessionId);
}

export async function submitMessage(
  sessionId: string,
  input: SubmitMessageInput,
): Promise<SubmitMessageResult> {
  return submitMessageRest(sessionId, input);
}

export async function listAgents(): Promise<{ items: Agent[] }> {
  return listAgentsRest();
}

export async function listRuns(
  sessionId: string,
): Promise<{ items: SessionRun[] } | ApiError> {
  return listRunsRest(sessionId);
}

export type {
  Session,
  SessionMessage,
  Agent,
  SessionRun,
  ApiError,
  SubmitMessageInput,
  SubmitMessageResult,
};
