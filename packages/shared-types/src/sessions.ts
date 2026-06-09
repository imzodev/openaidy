import type { SessionId } from './ids.js';

// ========================================
// Session Type Values (shared between types and runtime)
// ========================================
// When adding a new session type, update BOTH the type AND these values in one place
// This is the SINGLE SOURCE OF TRUTH for session types

export const SESSION_TYPE_VALUES = ['chat', 'task', 'subtask'] as const;
export const SESSION_STATUS_VALUES = ['active', 'archived', 'deleted'] as const;
export const MESSAGE_ROLE_VALUES = [
  'system',
  'user',
  'assistant',
  'tool',
] as const;
export const RUN_STATUS_VALUES = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
] as const;
export const FINISH_REASON_VALUES = [
  'stop',
  'length',
  'tool_calls',
  'content_filter',
  'error',
] as const;

// ========================================
// Session Types
// ========================================

/**
 * Session type - distinguishes the purpose of a session
 */
export type SessionType = (typeof SESSION_TYPE_VALUES)[number];

/**
 * Session status
 */
export type SessionStatus = (typeof SESSION_STATUS_VALUES)[number];

/**
 * Session
 */
export type Session = {
  id: SessionId;
  title: string;
  type?: SessionType;
  status?: SessionStatus;
  /** Last agent used in this session (set after each successful run) */
  agentId?: string;
  createdAt: string;
  updatedAt?: string;
  archivedAt?: string;
};

/**
 * Input for creating a session
 */
export type CreateSessionInput = {
  title: string;
  type?: SessionType;
};

// ========================================
// Session Message Types
// ========================================

/**
 * Message role
 */
export type MessageRole = (typeof MESSAGE_ROLE_VALUES)[number];

/**
 * Session message
 */
export type SessionMessage = {
  id: string;
  sessionId: SessionId;
  role: MessageRole;
  content: string;
  toolCallId?: string;
  /** ID of the run that produced this message (assistant messages only) */
  runId?: string;
  sequence: number;
  createdAt: string;
  metadata?: Record<string, unknown>;
};

// ========================================
// Session Run Types
// ========================================

/**
 * Run status
 */
export type RunStatus = (typeof RUN_STATUS_VALUES)[number];

/**
 * Finish reason
 */
export type FinishReason = (typeof FINISH_REASON_VALUES)[number];

/**
 * Session run
 */
/**
 * Session search result — returned by GET /sessions/search
 * Includes BM25 relevance ranking for ordering results
 */
export type SessionSearchResult = {
  id: string;
  title: string;
  status: SessionStatus;
  createdAt: string;
  updatedAt?: string;
  archivedAt?: string;
  /** How the match was found: "title" = title field matched, "content" = message content matched */
  matchType: 'title' | 'content';
  /** BM25 relevance rank (lower = better match) */
  rank: number;
  /** For content matches: number of messages that matched the query */
  matchCount?: number;
  /** Preview of matching content (truncated to 200 chars), null for title matches */
  snippet?: string;
};

export type SessionRun = {
  id: string;
  sessionId: SessionId;
  agentId: string;
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
  /** ID of the first assistant message produced by this run */
  firstMessageId?: string;
  metadata?: Record<string, unknown>;
};
