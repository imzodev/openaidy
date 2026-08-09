# Agent Memory System

This document describes the design, database schema, tool API, and extension path for the OpenAidy agent memory system.

---

## Overview

Agents in OpenAidy are stateless by default — each conversation starts fresh. The memory system adds two complementary capabilities:

1. **Explicit memory** — agents call `memory_save` to persist a discrete fact, decision, or note. Later they call `memory_search` to retrieve relevant memories by keyword.
2. **Session recall** — agents call `sessions_search` to locate past conversations by topic. Combined with `sessions_read`, this lets an agent load the full history of a prior session and resume where the user left off.

### Motivating use case

> **User:** "Let's continue working on the ABC project."
>
> **Agent flow:**
>
> 1. Calls `sessions_search` with query `"ABC project"` → finds session `abc-project-2024-03-01`
> 2. Calls `sessions_read` on that session → loads message history
> 3. Responds with full context of the prior work

Or, if the agent previously stored a memory:

> **Agent flow:**
>
> 1. Calls `memory_search` with query `"ABC project"` → returns: _"ABC project uses React + FastAPI, repo at github.com/user/abc, last milestone: auth module complete"_
> 2. Responds immediately with that context

---

## Design Decisions

| Decision                | Choice                              | Rationale                                                                                                   |
| ----------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Storage engine          | SQLite FTS5                         | Zero external dependencies, already in the stack, BM25 ranking built-in                                     |
| Search approach         | FTS5 keyword (BM25)                 | Sufficient for most recall tasks; semantic search via `sqlite-vec` can be layered in without schema changes |
| Memory creation         | Agent-explicit only                 | Agents decide what to remember; no automatic summarisation, no surprise side effects                        |
| Retrieval trigger       | Agent-explicit only                 | Agent calls `memory_search` when it judges it relevant; no automatic injection into every prompt            |
| Memory scope            | Per-agent                           | Memories are isolated to the creating agent by `agent_id`                                                   |
| Default agent privilege | Reads/writes all                    | The configured `defaults.agentId` agent can access all agents' memories                                     |
| Memory fields           | title + content + tags + importance | Allows the agent to prioritise and categorise; importance 1–5 guides what to surface first                  |

---

## Database Schema

All schema changes are applied in `packages/db/src/client.ts` inside `initializeSqliteSchema`.

### `memories` table

```sql
CREATE TABLE IF NOT EXISTS memories (
  id          TEXT PRIMARY KEY NOT NULL,
  agent_id    TEXT NOT NULL,
  title       TEXT NOT NULL,
  content     TEXT NOT NULL,
  tags        TEXT NOT NULL DEFAULT '[]',   -- JSON array of strings
  importance  INTEGER NOT NULL DEFAULT 3,   -- 1 (low) to 5 (high)
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS memories_agent_id_idx ON memories(agent_id);
CREATE INDEX IF NOT EXISTS memories_importance_idx ON memories(importance);
CREATE INDEX IF NOT EXISTS memories_created_at_idx ON memories(created_at);
```

### `memories_fts` — FTS5 virtual table

The FTS5 table is a content-backed index over the `memories` table. It indexes `title` and `content` for full-text search with BM25 ranking.

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  title,
  content,
  content='memories',
  content_rowid='rowid',
  tokenize='unicode61'
);
```

**Sync triggers** keep the FTS index in step with the base table:

```sql
-- After insert
CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, title, content)
  VALUES (new.rowid, new.title, new.content);
END;

-- After delete
CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, title, content)
  VALUES ('delete', old.rowid, old.title, old.content);
END;

-- After update
CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, title, content)
  VALUES ('delete', old.rowid, old.title, old.content);
  INSERT INTO memories_fts(rowid, title, content)
  VALUES (new.rowid, new.title, new.content);
END;
```

### `sessions_fts` — FTS5 on session titles

Allows `sessions_search` to find past sessions by keyword.

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS sessions_fts USING fts5(
  title,
  content='sessions',
  content_rowid='rowid',
  tokenize='unicode61'
);

CREATE TRIGGER IF NOT EXISTS sessions_ai AFTER INSERT ON sessions BEGIN
  INSERT INTO sessions_fts(rowid, title) VALUES (new.rowid, new.title);
END;

CREATE TRIGGER IF NOT EXISTS sessions_ad AFTER DELETE ON sessions BEGIN
  INSERT INTO sessions_fts(sessions_fts, rowid, title)
  VALUES ('delete', old.rowid, old.title);
END;

CREATE TRIGGER IF NOT EXISTS sessions_au AFTER UPDATE ON sessions BEGIN
  INSERT INTO sessions_fts(sessions_fts, rowid, title)
  VALUES ('delete', old.rowid, old.title);
  INSERT INTO sessions_fts(rowid, title) VALUES (new.rowid, new.title);
END;
```

> **Note on existing sessions rows**: Because the FTS triggers only fire on new writes, existing sessions are not automatically indexed. A one-time backfill INSERT must be run after adding the FTS table:
>
> ```sql
> INSERT INTO sessions_fts(rowid, title) SELECT rowid, title FROM sessions;
> ```
>
> This should be added to `initializeSqliteSchema` immediately after the `sessions_fts` and trigger creation, inside a guard that only runs it if the FTS table was just created (or it can be run as an idempotent rebuild).

---

## Shared Types

**File:** `packages/shared-types/src/memory.ts` ← NEW

```ts
export type Memory = {
  id: string;
  agentId: string;
  title: string;
  content: string;
  tags: string[];
  importance: number; // 1–5
  createdAt: string;
  updatedAt: string;
};

export type CreateMemoryInput = {
  title: string;
  content: string;
  tags?: string[];
  importance?: number; // defaults to 3
};

export type MemorySearchResult = Memory & {
  rank: number; // BM25 score from FTS5 (lower = better match)
};
```

Export from `packages/shared-types/src/index.ts`:

```ts
export * from './memory.js';
```

---

## Repository API

**File:** `packages/db/src/repositories/memories.ts` ← NEW

```ts
export type MemoriesRepository = {
  create(input: CreateMemoryInput & { agentId: string }): Promise<Memory>;
  search(
    query: string,
    agentId?: string,
    limit?: number,
  ): Promise<MemorySearchResult[]>;
  list(agentId?: string, limit?: number): Promise<Memory[]>;
  delete(id: string, agentId?: string): Promise<boolean>;
};

export function createMemoriesRepository(
  client: DatabaseClient,
): MemoriesRepository;
```

### `create`

Inserts a new row into `memories`. The FTS trigger fires automatically to update `memories_fts`. Generates a new `id` via `crypto.randomUUID()`.

### `search(query, agentId?, limit?)`

Runs an FTS5 match query with BM25 ranking:

```sql
SELECT m.*, fts.rank
FROM memories_fts fts
JOIN memories m ON m.rowid = fts.rowid
WHERE memories_fts MATCH :query
  AND (:agentId IS NULL OR m.agent_id = :agentId)
ORDER BY fts.rank          -- lower rank = better match in FTS5
LIMIT :limit;
```

When `agentId` is `undefined` (used by the default agent), the `agent_id` filter is omitted and all agents' memories are searched.

### `list(agentId?, limit?)`

Returns memories ordered by `importance DESC, created_at DESC`. No FTS involved — used for browsing rather than searching.

### `delete(id, agentId?)`

Deletes a memory by `id`. If `agentId` is provided, adds `AND agent_id = :agentId` to prevent an agent from deleting another agent's memory. Returns `true` if a row was deleted.

---

**Extension to sessions repository** — `packages/db/src/repositories/sessions.ts`

Add method:

```ts
searchByTitle(query: string, limit?: number): Promise<Session[]>
```

```sql
SELECT s.*
FROM sessions_fts fts
JOIN sessions s ON s.rowid = fts.rowid
WHERE sessions_fts MATCH :query
ORDER BY fts.rank
LIMIT :limit;
```

---

## Tool Reference

All four tools live in `apps/server/src/tools/memory/`.

---

### `memory_save`

**File:** `apps/server/src/tools/memory/save.ts`

Stores a discrete fact, decision, or note as a named memory, scoped to the calling agent.

#### Parameters

| Name         | Type         | Required | Description                                                                                   |
| ------------ | ------------ | -------- | --------------------------------------------------------------------------------------------- |
| `title`      | string       | ✅       | Short label for the memory (e.g. `"ABC project stack"`)                                       |
| `content`    | string       | ✅       | Full text of the memory                                                                       |
| `tags`       | string[]     | —        | Optional categorisation tags (e.g. `["project", "abc", "react"]`)                             |
| `importance` | number (1–5) | —        | Priority hint; defaults to `3`. Use `5` for critical constraints, `1` for low-priority notes. |

#### Returns

```json
{ "ok": true, "id": "<uuid>", "message": "Memory saved." }
```

#### Example agent call

```json
{
  "tool": "memory_save",
  "args": {
    "title": "ABC project stack",
    "content": "ABC project uses React 18 + FastAPI. Repo: github.com/user/abc. Auth module complete as of March 2024.",
    "tags": ["project", "abc", "react", "fastapi"],
    "importance": 4
  }
}
```

---

### `memory_search`

**File:** `apps/server/src/tools/memory/search.ts`

Full-text keyword search over stored memories using FTS5 BM25 ranking. Results are scoped to the calling agent's memories — unless the caller is the default agent, in which case all memories are searched.

#### Parameters

| Name    | Type   | Required | Description                                                                                                                    |
| ------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `query` | string | ✅       | FTS5 search query. Supports phrase matching (`"ABC project"`), prefix (`react*`), and boolean operators (`react AND fastapi`). |
| `limit` | number | —        | Maximum results to return. Defaults to `10`.                                                                                   |

#### Returns

Array of memory objects ordered by relevance (best match first):

```json
[
  {
    "id": "...",
    "agentId": "default",
    "title": "ABC project stack",
    "content": "ABC project uses React 18 + FastAPI...",
    "tags": ["project", "abc"],
    "importance": 4,
    "rank": -3.72,
    "createdAt": "2024-03-01T10:00:00Z",
    "updatedAt": "2024-03-01T10:00:00Z"
  }
]
```

Returns an empty array if no matches found.

#### FTS5 query syntax (brief reference)

| Pattern             | Meaning                                  |
| ------------------- | ---------------------------------------- |
| `react`             | Token match anywhere in title or content |
| `"ABC project"`     | Exact phrase match                       |
| `react*`            | Prefix match (react, reactjs, …)         |
| `react AND fastapi` | Both tokens must appear                  |
| `react OR vue`      | Either token                             |
| `react NOT vue`     | react without vue                        |

---

### `memory_delete`

**File:** `apps/server/src/tools/memory/delete.ts`

Deletes a memory by its ID. Agents can only delete their own memories. The default agent can delete any memory.

#### Parameters

| Name | Type   | Required | Description                                                                        |
| ---- | ------ | -------- | ---------------------------------------------------------------------------------- |
| `id` | string | ✅       | The `id` of the memory to delete (from `memory_search` or `memory_save` response). |

#### Returns

```json
{ "ok": true, "message": "Memory deleted." }
// or
{ "ok": false, "error": "Memory not found or access denied." }
```

---

### `sessions_search`

**File:** `apps/server/src/tools/memory/sessions-search.ts`

Searches past sessions by title using FTS5. Use this to find a prior conversation by topic. Follow up with `sessions_read` to load the full message history.

#### Parameters

| Name    | Type   | Required | Description                                 |
| ------- | ------ | -------- | ------------------------------------------- |
| `query` | string | ✅       | Keyword(s) to match against session titles. |
| `limit` | number | —        | Maximum results to return. Defaults to `5`. |

#### Returns

```json
[
  {
    "id": "session-uuid",
    "title": "ABC Project — Auth Module",
    "status": "active",
    "createdAt": "2024-03-01T09:00:00Z"
  }
]
```

#### Typical agent flow

```
1. sessions_search("ABC project")       → [{ id: "xyz", title: "ABC Project — Auth Module" }]
2. sessions_read({ sessionId: "xyz" })  → full message history
3. Agent synthesises context and responds
```

---

## Access Control

### Scoping rules

| Caller                                | `memory_save`                             | `memory_search` / `memory_delete`      |
| ------------------------------------- | ----------------------------------------- | -------------------------------------- |
| Regular agent (e.g. `code-assistant`) | Writes memory with its own `agent_id`     | Reads/deletes only its own memories    |
| Default agent (e.g. `default`)        | Same — writes with `agent_id = "default"` | Reads/deletes **all** agents' memories |

### How the default agent is identified

The tool factory receives `defaultAgentId: string` from the calling context (sourced from `config.defaults.agentId` in `openaidy.json`). Inside each tool's `execute(args, ctx)` handler:

```ts
const isDefault = ctx.agentId === deps.defaultAgentId;
const scopedAgentId = isDefault ? undefined : ctx.agentId;

// Pass scopedAgentId to the repository:
// undefined → no filter (all memories)
// string   → filter by agent_id
await deps.memoriesRepo.search(query, scopedAgentId);
```

No additional configuration is needed — it is derived entirely from the existing `defaults.agentId` field.

---

## Files to Create / Modify

### New files

| File                                              | Purpose                                                   |
| ------------------------------------------------- | --------------------------------------------------------- |
| `packages/shared-types/src/memory.ts`             | `Memory`, `CreateMemoryInput`, `MemorySearchResult` types |
| `packages/db/src/repositories/memories.ts`        | Memory CRUD + FTS5 search repository                      |
| `apps/server/src/tools/memory/save.ts`            | `memory_save` tool                                        |
| `apps/server/src/tools/memory/search.ts`          | `memory_search` tool                                      |
| `apps/server/src/tools/memory/delete.ts`          | `memory_delete` tool                                      |
| `apps/server/src/tools/memory/sessions-search.ts` | `sessions_search` tool                                    |
| `apps/server/src/tools/memory/index.ts`           | Barrel — `createMemoryTools(deps)`                        |

### Modified files

| File                                       | Change                                                                                |
| ------------------------------------------ | ------------------------------------------------------------------------------------- |
| `packages/db/src/client.ts`                | Add `memories` table, FTS5 tables, triggers, and backfill to `initializeSqliteSchema` |
| `packages/db/src/repositories/sessions.ts` | Add `searchByTitle` method                                                            |
| `packages/db/src/types.ts`                 | Add `memories: MemoriesRepository` to `DatabaseRepositories`                          |
| `packages/db/src/adapter.ts`               | Instantiate and register `createMemoriesRepository`                                   |
| `packages/shared-types/src/index.ts`       | Re-export from `./memory.js`                                                          |
| `apps/server/src/tools/catalog.ts`         | Add `ToolMeta` for the 4 new tools; append to `ALL_TOOL_METAS`                        |
| `apps/server/src/tools/index.ts`           | Add `memory?: MemoryToolDeps` to `BuiltinToolRegistryDeps`; register tools            |
| `apps/server/src/app.ts`                   | Wire `memoriesRepo`, `sessionsRepo`, `defaultAgentId` into memory tool deps           |

---

## Future Extensions

### Semantic search with `sqlite-vec`

When keyword search is insufficient (e.g. "find memories about error handling" when stored text says "exception management"), add vector similarity:

1. Add a `embedding BLOB` column to `memories` (no FTS change needed)
2. Load `sqlite-vec` extension via `sqlite.loadExtension('sqlite-vec')`
3. Create a `vec_memories` virtual table: `CREATE VIRTUAL TABLE vec_memories USING vec0(embedding float[1536])`
4. On `memory_save`, call an embedding provider (OpenAI `text-embedding-3-small` or a local model) and store the vector
5. On `memory_search`, run ANN lookup in `vec_memories`, then join back to `memories` — or run both FTS + ANN and merge/rerank results

This is additive: no existing schema rows or queries change.

### Automatic session summarisation

At the end of a session run, a background job could call a summarisation agent that:

1. Reads the session messages
2. Extracts key facts / decisions
3. Calls `memory_save` with those facts (scoped to the session's agent)

This requires a post-run hook in `SessionMessageService` or a scheduled job — it is out of scope for the initial implementation but the memory store is ready to receive such writes.

### Proactive context injection

Today, retrieval is purely agent-driven. A future enhancement could automatically inject the top-N memories into the system prompt at the start of each session run (inside `buildAgentSystemPrompt`), so agents always have their most important memories in context without needing to call `memory_search` explicitly.
