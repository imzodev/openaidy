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
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
};

/**
 * Input for creating a new memory entry.
 * `tags` defaults to [] and `importance` defaults to 3.
 */
export type CreateMemoryInput = {
  title: string;
  content: string;
  tags?: string[];
  importance?: number; // defaults to 3
};

/**
 * A memory entry enriched with BM25 rank from FTS5 full-text search.
 * Rank is a negative float — lower values indicate better matches.
 */
export type MemorySearchResult = Memory & {
  rank: number; // BM25 score from FTS5 (lower = better match)
};
