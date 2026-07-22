import type { WebSocketClient } from '@openaidy/sdk';
import type { MessagePage } from '@openaidy/shared-types';
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
        items: response.payload.sessions.map((session) => ({
          id: session.id,
          title: session.title ?? 'Untitled Session',
          type: session.type,
          status: session.status,
          agentId: session.agentId,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
        })),
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
        status: response.payload.session.status,
        agentId: response.payload.session.agentId,
        createdAt: response.payload.session.createdAt,
        updatedAt: response.payload.session.updatedAt,
      };
    },
    () => getSessionRest(id),
  );
}

/**
 * Fetch a single page of messages for a session.
 *
 * - The server returns messages in chronological (oldest → newest) order
 *   regardless of pagination direction — the WS handler slices from the end
 *   for an initial/newest batch and from earlier offsets for "load older".
 * - Pass `offset` to skip that many messages from the newest end (i.e.
 *   `offset=50, limit=20` returns the 20 messages that sit just before the
 *   initial 50).
 * - The returned `total` is the full message count for the session and
 *   `nextOffset` is the offset to use for the *next* (older) page, or `null`
 *   when the current page already covers everything.
 *
 * Errors propagate as thrown rejections — the REST fallback throws on
 * non-2xx, and `withWebSocketFallback` re-throws any WS error so callers
 * see a consistent `Promise<MessagePage<SessionMessage>>` shape.
 */
export async function listMessages(
  sessionId: string,
  options: { limit?: number; offset?: number } = {},
): Promise<MessagePage<SessionMessage>> {
  const limit = options.limit;
  const offset = options.offset ?? 0;
  return withWebSocketFallback(
    async (client) => {
      const response = await client.listMessages(sessionId, {
        ...(limit !== undefined ? { limit } : {}),
        offset,
      });
      if (response.type !== 'session.messages') {
        throw new Error('Unexpected response type for session.messages');
      }

      const messages = response.payload.messages.map(
        (msg: {
          id: string;
          sessionId: string;
          role: string;
          content: string;
          sequence: number;
          createdAt: string;
          metadata?: Record<string, unknown>;
          reasoningContent?: string;
          attachments?: SessionMessage['attachments'];
        }) => ({
          id: msg.id,
          sessionId: msg.sessionId,
          role: msg.role as SessionMessage['role'],
          content: msg.content,
          sequence: msg.sequence,
          createdAt: msg.createdAt,
          metadata: msg.metadata,
          ...(msg.reasoningContent
            ? { reasoningContent: msg.reasoningContent }
            : {}),
          ...(msg.attachments?.length ? { attachments: msg.attachments } : {}),
        }),
      );
      const total = response.payload.total;
      const fetchedUpTo = offset + messages.length;
      return {
        items: messages,
        total,
        nextOffset: fetchedUpTo >= total ? null : fetchedUpTo,
      };
    },
    // REST fallback: the REST endpoint doesn't yet support pagination, so
    // it always returns the full list. Surface that as a single page whose
    // `nextOffset` reflects we've loaded everything.
    async () => {
      const result = await listMessagesRest(sessionId);
      if (!('items' in result)) {
        throw new Error('Unexpected REST response for session.messages');
      }
      const items = result.items;
      const total = items.length;
      return {
        items,
        total,
        nextOffset: offset + items.length >= total ? null : total,
      };
    },
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
        ...(input.attachmentIds?.length
          ? { attachmentIds: input.attachmentIds }
          : {}),
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
        ...(input.attachmentIds?.length
          ? { attachmentIds: input.attachmentIds }
          : {}),
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

/**
 * Snapshot of an in-progress run's live stream, returned by
 * {@link resumeSessionStream}. `active: false` means there is nothing to resume.
 */
export type ResumeStreamResult = {
  active: boolean;
  runId?: string;
  agentId?: string;
  providerId?: string;
  modelId?: string;
  content?: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  activity?: {
    phase: 'thinking' | 'running_tool';
    toolName?: string;
    elapsedMs: number;
  };
};

/**
 * Ask the server for the live state of any in-progress run on this session so a
 * reconnected / re-foregrounded client can resume streaming instead of showing
 * a stalled UI (issue #450). WS-only — returns null if there's no live socket
 * (the caller then falls back to refetching persisted messages).
 */
export async function resumeSessionStream(
  sessionId: string,
): Promise<ResumeStreamResult | null> {
  const client = activeClient;
  if (!client || !client.isConnected()) return null;
  try {
    const response = await client.sendRequest<{
      type: string;
      payload: ResumeStreamResult & { sessionId: string };
    }>('session.stream.resume', { sessionId });
    if (response?.type !== 'session.stream.resume') return null;
    return response.payload;
  } catch {
    return null;
  }
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
            firstMessageId?: string;
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
            ...(run.firstMessageId
              ? { firstMessageId: run.firstMessageId }
              : {}),
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
