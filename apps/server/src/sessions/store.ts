import { nanoid } from 'nanoid';
import type {
  SessionRecord,
  SessionMessageRecord,
  SessionRunRecord,
  AppendMessageInput,
  FinishReason,
} from '../types.js';
import type { SessionType, SessionStatus } from '@openaidy/shared-types';
export type { SessionRecord, SessionMessageRecord, SessionRunRecord };

// In-memory storage (will be replaced with database)
const sessions = new Map<string, SessionRecord>();
const messages = new Map<string, SessionMessageRecord>();
const runs = new Map<string, SessionRunRecord>();

// Session operations
export function listSessionRecords(status?: SessionStatus): SessionRecord[] {
  const all = Array.from(sessions.values());
  if (!status) return all;
  // Default missing status to 'active' so legacy records still match.
  return all.filter((s) => (s.status ?? 'active') === status);
}

export function findSessionRecord(id: string): SessionRecord | undefined {
  return sessions.get(id);
}

export function createSessionRecord(
  title: string,
  type?: SessionType,
  ephemeral?: boolean,
): SessionRecord {
  const now = new Date().toISOString();
  const record: SessionRecord = {
    id: nanoid(),
    title,
    type: type ?? 'chat',
    status: 'active',
    createdAt: now,
    updatedAt: now,
    ...(ephemeral && { ephemeral: true }),
  };
  sessions.set(record.id, record);
  return record;
}

/**
 * Sweep in-memory ephemeral sessions whose `updatedAt` (last activity) is
 * older than `maxAgeMs`. Backstop against unbounded memory growth when a
 * private chat is opened and never explicitly closed — a session actively
 * being chatted in keeps getting its `updatedAt` bumped (see
 * `appendMessageRecord`) and never hits the TTL. Cascades messages/runs via
 * the existing delete path. Returns the ids of the sessions removed.
 */
export function deleteExpiredEphemeralSessionRecords(
  maxAgeMs: number,
): string[] {
  const now = Date.now();
  const removed: string[] = [];
  for (const record of Array.from(sessions.values())) {
    if (!record.ephemeral) continue;
    const lastActivity = record.updatedAt ?? record.createdAt;
    if (now - new Date(lastActivity).getTime() > maxAgeMs) {
      deleteSessionRecord(record.id);
      removed.push(record.id);
    }
  }
  return removed;
}

export function updateSessionTitleRecord(
  id: string,
  title: string,
): SessionRecord | undefined {
  const record = sessions.get(id);
  if (!record) return undefined;
  const updated = { ...record, title, updatedAt: new Date().toISOString() };
  sessions.set(id, updated);
  return updated;
}

export function updateSessionStatusRecord(
  id: string,
  status: SessionStatus,
): SessionRecord | undefined {
  const record = sessions.get(id);
  if (!record) return undefined;
  const now = new Date().toISOString();
  // Drop any prior archivedAt, then re-add only when archiving. (Omitting the
  // key rather than setting undefined keeps exactOptionalPropertyTypes happy.)
  const { archivedAt: _prevArchivedAt, ...rest } = record;
  const updated: SessionRecord = {
    ...rest,
    status,
    updatedAt: now,
    ...(status === 'archived' ? { archivedAt: now } : {}),
  };
  sessions.set(id, updated);
  return updated;
}

export function updateSessionFavoriteRecord(
  id: string,
  favorited: boolean,
): SessionRecord | undefined {
  const record = sessions.get(id);
  if (!record) return undefined;
  // Favoriting is not activity — do not bump updatedAt. Drop favoritedAt, then
  // re-add only when favoriting.
  const { favoritedAt: _prevFavoritedAt, ...rest } = record;
  const updated: SessionRecord = {
    ...rest,
    ...(favorited ? { favoritedAt: new Date().toISOString() } : {}),
  };
  sessions.set(id, updated);
  return updated;
}

export function deleteSessionRecord(id: string): boolean {
  const record = sessions.get(id);
  if (!record) return false;
  sessions.delete(id);
  // Cascade-delete the session's messages and runs.
  for (const [messageId, message] of messages) {
    if (message.sessionId === id) messages.delete(messageId);
  }
  for (const [runId, run] of runs) {
    if (run.sessionId === id) runs.delete(runId);
  }
  return true;
}

// Message operations
export function appendMessageRecord(
  input: AppendMessageInput,
): SessionMessageRecord {
  const sessionMessages = Array.from(messages.values()).filter(
    (m) => m.sessionId === input.sessionId,
  );
  const nextSequence =
    sessionMessages.length > 0
      ? Math.max(...sessionMessages.map((m) => m.sequence)) + 1
      : 1;

  const record: SessionMessageRecord = {
    id: nanoid(),
    sessionId: input.sessionId,
    role: input.role,
    content: input.content,
    sequence: nextSequence,
    createdAt: new Date().toISOString(),
    ...(input.runId !== undefined && { runId: input.runId }),
    ...(input.toolCallId !== undefined && { toolCallId: input.toolCallId }),
    ...(input.reasoningContent !== undefined && {
      reasoningContent: input.reasoningContent,
    }),
    ...(input.metadata !== undefined && { metadata: input.metadata }),
  };
  messages.set(record.id, record);

  // Bump the session's last-activity timestamp so the ephemeral-session TTL
  // sweep (see `deleteExpiredEphemeralSessionRecords`) is activity-based
  // rather than expiring a session that's actively being chatted in.
  const session = sessions.get(input.sessionId);
  if (session) {
    sessions.set(input.sessionId, {
      ...session,
      updatedAt: record.createdAt,
    });
  }

  return record;
}

export function listSessionMessageRecords(
  sessionId: string,
): SessionMessageRecord[] {
  return Array.from(messages.values())
    .filter((m) => m.sessionId === sessionId)
    .sort((a, b) => a.sequence - b.sequence);
}

export function findSessionMessageRecord(
  id: string,
): SessionMessageRecord | undefined {
  return messages.get(id);
}

// Run operations
export function createRunRecord(input: {
  sessionId: string;
  agentId: string;
  providerId: string;
  modelId: string;
  metadata?: Record<string, unknown>;
}): SessionRunRecord {
  const record: SessionRunRecord = {
    id: nanoid(),
    sessionId: input.sessionId,
    agentId: input.agentId,
    providerId: input.providerId,
    modelId: input.modelId,
    status: 'queued',
    createdAt: new Date().toISOString(),
    ...(input.metadata !== undefined && { metadata: input.metadata }),
  };
  runs.set(record.id, record);
  return record;
}

export function updateRunRecord(
  id: string,
  updates: Partial<Omit<SessionRunRecord, 'id' | 'sessionId' | 'createdAt'>>,
): SessionRunRecord | undefined {
  const record = runs.get(id);
  if (!record) return undefined;

  const updated = { ...record, ...updates };
  runs.set(id, updated);
  return updated;
}

export function markRunRunning(id: string): SessionRunRecord | undefined {
  return updateRunRecord(id, {
    status: 'running',
    startedAt: new Date().toISOString(),
  });
}

export function markRunSucceeded(
  id: string,
  input: {
    finishReason: FinishReason;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
    cost?: number | null;
    firstMessageId?: string;
    /**
     * Optional top-level error code/message for runs that finish
     * "succeeded" but in a degraded state (e.g. the model emitted
     * tool-call markup as content and the codec missed it). Mirrors
     * the top-level fields `markRunFailed` sets, so the chat UI --
     * which reads `run.errorCode` from the top-level run columns --
     * can surface the problem without having to inspect metadata.
     */
    errorCode?: string;
    errorMessage?: string;
    metadata?: Record<string, unknown>;
  },
): SessionRunRecord | undefined {
  const updates: Partial<
    Omit<SessionRunRecord, 'id' | 'sessionId' | 'createdAt'>
  > = {
    status: 'succeeded',
    finishReason: input.finishReason,
    finishedAt: new Date().toISOString(),
  };

  if (input.promptTokens !== undefined)
    updates.promptTokens = input.promptTokens;
  if (input.completionTokens !== undefined)
    updates.completionTokens = input.completionTokens;
  if (input.totalTokens !== undefined) updates.totalTokens = input.totalTokens;
  if (input.cacheReadTokens !== undefined)
    updates.cacheReadTokens = input.cacheReadTokens;
  if (input.cacheCreationTokens !== undefined)
    updates.cacheCreationTokens = input.cacheCreationTokens;
  if (input.cost !== undefined) updates.cost = input.cost;
  if (input.firstMessageId !== undefined)
    updates.firstMessageId = input.firstMessageId;
  if (input.errorCode !== undefined) updates.errorCode = input.errorCode;
  if (input.errorMessage !== undefined)
    updates.errorMessage = input.errorMessage;
  if (input.metadata !== undefined) updates.metadata = input.metadata;

  return updateRunRecord(id, updates);
}

export function markRunFailed(
  id: string,
  input: {
    errorCode: string;
    errorMessage: string;
    metadata?: Record<string, unknown>;
  },
): SessionRunRecord | undefined {
  const updates: Partial<
    Omit<SessionRunRecord, 'id' | 'sessionId' | 'createdAt'>
  > = {
    status: 'failed',
    finishReason: 'error',
    errorCode: input.errorCode,
    errorMessage: input.errorMessage,
    finishedAt: new Date().toISOString(),
  };

  if (input.metadata !== undefined) updates.metadata = input.metadata;

  return updateRunRecord(id, updates);
}

export function markRunCancelled(id: string): SessionRunRecord | undefined {
  return updateRunRecord(id, {
    status: 'cancelled',
    finishedAt: new Date().toISOString(),
  });
}

export function listSessionRunRecords(sessionId: string): SessionRunRecord[] {
  return Array.from(runs.values())
    .filter((r) => r.sessionId === sessionId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
