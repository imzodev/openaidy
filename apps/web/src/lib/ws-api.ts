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
  type AgentWorkspaceConfig,
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
  return withWebSocketFallback(
    async (client) => {
      const response = await client.listMessages(sessionId);
      if (response.type !== 'session.messages') {
        throw new Error('Unexpected response type for session.messages');
      }

      return {
        items: response.payload.messages.map(
          (msg: {
            id: string;
            sessionId: string;
            role: string;
            content: string;
            sequence: number;
            createdAt: string;
            metadata?: Record<string, unknown>;
          }) => ({
            id: msg.id,
            sessionId: msg.sessionId,
            role: msg.role as SessionMessage['role'],
            content: msg.content,
            sequence: msg.sequence,
            createdAt: msg.createdAt,
            metadata: msg.metadata,
          }),
        ),
      };
    },
    () => listMessagesRest(sessionId),
  );
}

export async function submitMessage(
  sessionId: string,
  input: SubmitMessageInput,
): Promise<SubmitMessageResult> {
  return withWebSocketFallback(
    async (client) => {
      const response = await client.sendMessage(sessionId, input.content, {
        stream: false,
        agentId: input.agentId,
        providerId: input.providerId,
        modelId: input.modelId,
      });

      if (response.type !== 'session.message') {
        throw new Error('Unexpected response type for session.message');
      }

      const timestamp = new Date().toISOString();
      const providerId = input.providerId ?? 'unknown-provider';
      const modelId = input.modelId ?? 'unknown-model';

      return {
        ok: true,
        userMessage: {
          id: `local-user-${Date.now()}`,
          sessionId,
          role: input.role,
          content: input.content,
          sequence: 0,
          createdAt: timestamp,
        },
        assistantMessage: {
          id: response.payload.messageId,
          sessionId,
          role: response.payload.role,
          content: response.payload.content,
          sequence: 1,
          createdAt: timestamp,
          ...(response.payload.usage
            ? {
                metadata: {
                  usage: response.payload.usage,
                  ...(response.payload.finishReason
                    ? { finishReason: response.payload.finishReason }
                    : {}),
                },
              }
            : {}),
        },
        run: {
          id: `ws-run-${Date.now()}`,
          sessionId,
          providerId,
          modelId,
          status: 'succeeded',
          createdAt: timestamp,
          ...(input.agentId ? { agentId: input.agentId } : {}),
          ...(response.payload.finishReason
            ? { finishReason: response.payload.finishReason }
            : {}),
        },
      };
    },
    () => submitMessageRest(sessionId, input),
  );
}

/**
 * Submit a message with streaming enabled
 * Returns a stream-ready response - actual streaming happens via events
 */
export async function submitMessageStreaming(
  sessionId: string,
  input: SubmitMessageInput,
): Promise<SubmitMessageResult> {
  return withWebSocketFallback(
    async (client) => {
      const response = await client.sendMessage(sessionId, input.content, {
        stream: true,
        agentId: input.agentId,
        providerId: input.providerId,
        modelId: input.modelId,
      });

      if (
        response.type !== 'session.message.ack' &&
        response.type !== 'session.message'
      ) {
        throw new Error('Unexpected response type for session.message');
      }

      const timestamp = new Date().toISOString();
      const providerId = input.providerId ?? 'unknown-provider';
      const modelId = input.modelId ?? 'unknown-model';

      // For streaming ack, use runId from payload; otherwise generate locally
      const runId =
        (response.payload as { runId?: string }).runId ??
        `ws-stream-run-${Date.now()}`;

      return {
        ok: true,
        userMessage: {
          id: `local-user-${Date.now()}`,
          sessionId,
          role: input.role,
          content: input.content,
          sequence: 0,
          createdAt: timestamp,
        },
        assistantMessage: {
          id:
            (response.payload as { messageId?: string }).messageId ??
            `local-assistant-${Date.now()}`,
          sessionId,
          role: 'assistant',
          content: '', // Empty initially - will be filled via streaming
          sequence: 1,
          createdAt: timestamp,
          metadata: {
            streaming: true,
            runId,
          },
        },
        run: {
          id: runId,
          sessionId,
          providerId,
          modelId,
          status: 'streaming',
          createdAt: timestamp,
          ...(input.agentId ? { agentId: input.agentId } : {}),
        },
      };
    },
    () => submitMessageRest(sessionId, input),
  );
}

export async function listAgents(): Promise<{ items: Agent[] }> {
  return withWebSocketFallback(
    async (client) => {
      const response = await client.listAgents();
      if (response.type !== 'agent.list') {
        throw new Error('Unexpected response type for agent.list');
      }

      return {
        items: response.payload.agents.map(
          (agent: {
            id: string;
            name: string;
            description?: string;
            tools?: string[];
            enabled?: boolean;
            model?: string;
            workspace?: AgentWorkspaceConfig;
          }) => ({
            id: agent.id,
            name: agent.name,
            description: agent.description,
            tools: agent.tools,
            enabled: agent.enabled ?? true,
            systemPrompt: '',
            model: agent.model ?? '',
            defaults: {},
            workspace: agent.workspace,
          }),
        ),
      };
    },
    () => listAgentsRest(),
  );
}

export async function listRuns(
  sessionId: string,
): Promise<{ items: SessionRun[] } | ApiError> {
  return withWebSocketFallback(
    async (client) => {
      const response = await client.listRuns(sessionId);
      if (response.type !== 'session.runs') {
        throw new Error('Unexpected response type for session.runs');
      }

      return {
        items: response.payload.runs.map(
          (run: {
            id: string;
            sessionId: string;
            agentId?: string;
            providerId: string;
            modelId: string;
            status: string;
            finishReason?: string;
            errorCode?: string;
            errorMessage?: string;
            createdAt: string;
          }) => ({
            id: run.id,
            sessionId: run.sessionId,
            providerId: run.providerId,
            modelId: run.modelId,
            status: run.status as SessionRun['status'],
            createdAt: run.createdAt,
            ...(run.agentId ? { agentId: run.agentId } : {}),
            ...(run.finishReason ? { finishReason: run.finishReason } : {}),
            ...(run.errorCode ? { errorCode: run.errorCode } : {}),
            ...(run.errorMessage ? { errorMessage: run.errorMessage } : {}),
          }),
        ),
      };
    },
    () => listRunsRest(sessionId),
  );
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
