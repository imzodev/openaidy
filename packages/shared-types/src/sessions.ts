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
  /** When the session was favorited/pinned (null/absent = not a favorite) */
  favoritedAt?: string;
  /**
   * Private/incognito session: never persisted to the database, lives only
   * in server memory for the lifetime of the process, and is absent from
   * `listSessions`/session history. Lost on server restart or when the
   * client stops referencing it (e.g. a page refresh).
   */
  ephemeral?: boolean;
};

/**
 * Input for creating a session
 */
export type CreateSessionInput = {
  title: string;
  type?: SessionType;
  ephemeral?: boolean;
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
  firstMessageId?: string;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
};

// ========================================
// CLI-specific session types
// Lightweight summaries used by the CLI when calling REST API endpoints
// ========================================

/**
 * Summary fields returned by GET /sessions (list)
 */
export type SessionSummary = Pick<Session, 'id' | 'title' | 'createdAt'>;

/**
 * Detail fields returned by GET /sessions/:id (get)
 */
export type SessionDetail = Pick<
  Session,
  'id' | 'title' | 'createdAt' | 'updatedAt'
>;

/**
 * Summary fields returned by GET /sessions/:id/runs
 */
export type SessionRunSummary = Pick<
  SessionRun,
  'id' | 'status' | 'providerId' | 'modelId' | 'createdAt'
> & {
  /** Duration in ms — derived by the server when marking a run finished */
  durationMs?: number;
};

// ========================================
// Session Search Result (wire format)
// ========================================
// Mirrors the Zod schema in `packages/db/src/types/index.ts` (sessionSearchResultSchema).
// Dates are serialized as ISO 8601 strings on the wire.

/**
 * Match type for session search results
 */
export type SessionSearchMatchType = 'title' | 'content';

/**
 * Single result from GET /sessions/search — wire format (dates as strings).
 */
export type SessionSearchResult = {
  id: string;
  title: string;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  matchType: SessionSearchMatchType;
  rank: number;
  matchCount?: number;
  snippet: string | null;
};

// ========================================
// Paginated session message types
// ========================================

/**
 * Page of session messages returned by paginated loads.
 *
 * - `items` is always ordered oldest → newest (chronological), matching the
 *   server's natural message order. Prepending a fetched page to a client-
 *   side list therefore just concatenates.
 * - `total` is the total number of messages the session has on the server.
 *   When `items.length` reaches `total`, no more pages exist.
 * - `nextOffset` is the offset to pass to the next request to get the *next*
 *   (older, when paging backward through history) batch. `null` indicates
 *   there is nothing more to load.
 *
 * `MessagePage<T>` is generic so the same shape works for the raw
 * `SessionMessage` type (REST) and any future wire variants.
 */
export type MessagePage<T> = {
  items: T[];
  total: number;
  nextOffset: number | null;
};
