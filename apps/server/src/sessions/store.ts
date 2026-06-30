import { nanoid } from 'nanoid';
import type {
  SessionRecord,
  SessionMessageRecord,
  SessionRunRecord,
  AppendMessageInput,
  FinishReason,
} from '../types.js';
import type { SessionType } from '@openaidy/shared-types';
export type { SessionRecord, SessionMessageRecord, SessionRunRecord };

// In-memory storage (will be replaced with database)
const sessions = new Map<string, SessionRecord>();
const messages = new Map<string, SessionMessageRecord>();
const runs = new Map<string, SessionRunRecord>();

// Session operations
export function listSessionRecords(): SessionRecord[] {
  return Array.from(sessions.values());
}

export function findSessionRecord(id: string): SessionRecord | undefined {
  return sessions.get(id);
}

export function createSessionRecord(
  title: string,
  type?: SessionType,
): SessionRecord {
  const record: SessionRecord = {
    id: nanoid(),
    title,
    type: type ?? 'chat',
    createdAt: new Date().toISOString(),
  };
  sessions.set(record.id, record);
  return record;
}

export function updateSessionTitleRecord(
  id: string,
  title: string,
): SessionRecord | undefined {
  const record = sessions.get(id);
  if (!record) return undefined;
  const updated = { ...record, title };
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
  return record;
}

export function listSessionMessageRecords(
  sessionId: string,
): SessionMessageRecord[] {
  return Array.from(messages.values())
    .filter((m) => m.sessionId === sessionId)
    .sort((a, b) => a.sequence - b.sequence);
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
    firstMessageId?: string;
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
  if (input.firstMessageId !== undefined)
    updates.firstMessageId = input.firstMessageId;
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

export function listSessionRunRecords(sessionId: string): SessionRunRecord[] {
  return Array.from(runs.values())
    .filter((r) => r.sessionId === sessionId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
