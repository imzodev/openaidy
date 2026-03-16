import { nanoid } from 'nanoid';

/**
 * Message role type
 */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/**
 * Run status type
 */
export type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

/**
 * Finish reason type
 */
export type FinishReason = 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error';

/**
 * Session message record
 */
export type SessionMessageRecord = {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  toolCallId?: string;
  sequence: number;
  createdAt: string;
  metadata?: Record<string, unknown>;
};

/**
 * Session run record
 */
export type SessionRunRecord = {
  id: string;
  sessionId: string;
  providerId: string;
  modelId: string;
  status: RunStatus;
  finishReason?: FinishReason;
  errorCode?: string;
  errorMessage?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
};

/**
 * Session record
 */
export type SessionRecord = {
  id: string;
  title: string;
  createdAt: string;
};

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

export function createSessionRecord(title: string): SessionRecord {
  const record: SessionRecord = {
    id: nanoid(),
    title,
    createdAt: new Date().toISOString(),
  };
  sessions.set(record.id, record);
  return record;
}

// Message operations
export function appendMessageRecord(input: {
  sessionId: string;
  role: MessageRole;
  content: string;
  toolCallId?: string;
  metadata?: Record<string, unknown>;
}): SessionMessageRecord {
  const sessionMessages = Array.from(messages.values())
    .filter(m => m.sessionId === input.sessionId);
  const nextSequence = sessionMessages.length > 0
    ? Math.max(...sessionMessages.map(m => m.sequence)) + 1
    : 1;

  const record: SessionMessageRecord = {
    id: nanoid(),
    sessionId: input.sessionId,
    role: input.role,
    content: input.content,
    sequence: nextSequence,
    createdAt: new Date().toISOString(),
    ...(input.toolCallId !== undefined && { toolCallId: input.toolCallId }),
    ...(input.metadata !== undefined && { metadata: input.metadata }),
  };
  messages.set(record.id, record);
  return record;
}

export function listSessionMessageRecords(sessionId: string): SessionMessageRecord[] {
  return Array.from(messages.values())
    .filter(m => m.sessionId === sessionId)
    .sort((a, b) => a.sequence - b.sequence);
}

// Run operations
export function createRunRecord(input: {
  sessionId: string;
  providerId: string;
  modelId: string;
  metadata?: Record<string, unknown>;
}): SessionRunRecord {
  const record: SessionRunRecord = {
    id: nanoid(),
    sessionId: input.sessionId,
    providerId: input.providerId,
    modelId: input.modelId,
    status: 'queued',
    createdAt: new Date().toISOString(),
    ...(input.metadata !== undefined && { metadata: input.metadata }),
  };
  runs.set(record.id, record);
  return record;
}

export function updateRunRecord(id: string, updates: Partial<Omit<SessionRunRecord, 'id' | 'sessionId' | 'createdAt'>>): SessionRunRecord | undefined {
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
    metadata?: Record<string, unknown>;
  }
): SessionRunRecord | undefined {
  const updates: Partial<Omit<SessionRunRecord, 'id' | 'sessionId' | 'createdAt'>> = {
    status: 'succeeded',
    finishReason: input.finishReason,
    finishedAt: new Date().toISOString(),
  };
  
  if (input.promptTokens !== undefined) updates.promptTokens = input.promptTokens;
  if (input.completionTokens !== undefined) updates.completionTokens = input.completionTokens;
  if (input.totalTokens !== undefined) updates.totalTokens = input.totalTokens;
  if (input.metadata !== undefined) updates.metadata = input.metadata;
  
  return updateRunRecord(id, updates);
}

export function markRunFailed(
  id: string,
  input: {
    errorCode: string;
    errorMessage: string;
    metadata?: Record<string, unknown>;
  }
): SessionRunRecord | undefined {
  const updates: Partial<Omit<SessionRunRecord, 'id' | 'sessionId' | 'createdAt'>> = {
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
    .filter(r => r.sessionId === sessionId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
