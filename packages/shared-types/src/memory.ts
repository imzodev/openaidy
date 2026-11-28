/**
 * Agent Memory System types
 *
 * Shared types for the persistent memory system. Memory entries are
 * stored in SQLite with FTS5 full-text search support.
 */

/**
 * A single memory entry created by an agent.
 * Stored in the `memories` table; full-text indexed in `memories_fts`.
 */
export type Memory = {
  id: string;
  agentId: string;
  title: string;
  content: string;
  tags: string[];
  importance: number; // 1–5
  source: MemorySource;
  kind: MemoryKind | null;
  /** The conversation a learned fact came from. */
  sourceSessionId: string | null;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
};

/**
 * Input for creating a new memory entry.
 * `tags` defaults to [], `importance` to 3 and `source` to 'agent'.
 */
export type CreateMemoryInput = {
  title: string;
  content: string;
  tags?: string[];
  importance?: number; // defaults to 3
  source?: MemorySource;
  kind?: MemoryKind;
  sourceSessionId?: string;
};

/**
 * Input for updating an existing memory entry. All fields are optional;
 * only the provided fields are changed. `updatedAt` is refreshed by the store.
 */
export type UpdateMemoryInput = {
  title?: string;
  content?: string;
  tags?: string[];
  importance?: number; // 1–5
  kind?: MemoryKind;
};

/**
 * A memory entry enriched with BM25 rank from FTS5 full-text search.
 * Rank is a negative float — lower values indicate better matches.
 */
export type MemorySearchResult = Memory & {
  rank: number; // BM25 score from FTS5 (lower = better match)
};

/**
 * An agent paired with how many memories it owns. Powers the memory
 * management UI's agent selector. `name` falls back to the id for orphaned
 * agents that still own memories but are no longer registered.
 */
export type MemoryAgentSummary = {
  id: string;
  name: string;
  count: number;
};

/**
 * The `agentId` scope that holds what Aidy knows about its owner. Shared by
 * every agent (unlike per-agent memories) and filled mostly by background
 * learning from the owner's own conversations.
 */
export const OWNER_MEMORY_AGENT_ID = '__owner__';

/** Who wrote a memory. */
export const MEMORY_SOURCE_VALUES = ['agent', 'learned', 'user'] as const;
export type MemorySource = (typeof MEMORY_SOURCE_VALUES)[number];

/** What a learned fact about the owner is. */
export const MEMORY_KIND_VALUES = [
  'preference',
  'fact',
  'person',
  'routine',
  'goal',
] as const;
export type MemoryKind = (typeof MEMORY_KIND_VALUES)[number];

/** One change the learning pass proposes to the owner's memories. */
export type LearnedMemoryOp =
  | {
      op: 'add';
      kind: MemoryKind;
      title: string;
      content: string;
      importance: number;
    }
  | { op: 'update'; id: string; content: string; importance?: number }
  | { op: 'forget'; id: string };

/** How far the learning pass has read a session. */
export type MemoryLearningCursor = {
  sessionId: string;
  throughSequence: number;
  updatedAt: string;
};

/** A chat session with turns the learning pass hasn't read yet. */
export type MemoryLearningCandidate = {
  sessionId: string;
  agentId: string | null;
  throughSequence: number;
  lastSequence: number;
};

/** A `memories` row as SQLite returns it (snake_case, tags as JSON). */
export type MemoryRow = {
  id: string;
  agent_id: string;
  title: string;
  content: string;
  tags: string;
  importance: number;
  source: string;
  kind: string | null;
  source_session_id: string | null;
  created_at: string;
  updated_at: string;
};

/** A `memory_learning_state` row as SQLite returns it. */
export type MemoryLearningStateRow = {
  session_id: string;
  through_sequence: number;
  updated_at: string;
};

/** A learning candidate as the candidate query returns it. */
export type MemoryLearningCandidateRow = {
  session_id: string;
  agent_id: string | null;
  through_sequence: number;
  last_sequence: number;
};

/** What one learning pass changed. */
export type MemoryLearningOutcome = {
  added: number;
  updated: number;
  forgotten: number;
};
