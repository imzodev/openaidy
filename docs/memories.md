---
summary: 'Explicit, persistent agent memory — memory_save/memory_search, and session recall'
read_when:
  - You want an agent to remember things across separate sessions
title: 'Memories'
---

# Memories

Agents are stateless by default — each session starts fresh, with no knowledge of any other session. Memories give an agent a way to persist facts on purpose and recall them later, across any session.

There are two complementary tools:

1. **`memory_save`** — the agent explicitly persists a discrete fact, decision, or note.
2. **`memory_search`** — the agent searches previously saved memories by keyword.

Memory creation and retrieval are both **agent-explicit only** — nothing is summarized or saved automatically, and nothing is silently injected into a prompt. The agent decides what's worth remembering, and decides when to go look something up.

## Example flow

> **You:** "Let's continue working on the ABC project."
>
> **Agent:** calls `memory_search("ABC project")` → gets back _"ABC project uses React + FastAPI, repo at github.com/user/abc, last milestone: auth module complete"_ → responds with that context already loaded.

## Session recall (a separate, complementary tool)

An agent can also search _past conversations themselves_ rather than explicit memories: `sessions_search` finds sessions by topic, and `sessions_read` loads a found session's full message history. This is useful when you want the agent to pick up a prior conversation verbatim rather than a saved summary.

## Scope

Memories are scoped **per agent** — an agent only sees memories it (or another instance of the same agent) created, identified by `agent_id`. The one exception: your configured default agent can read and write every agent's memories, which is useful if you want one "assistant" agent able to draw on everything the others have learned.

Each memory has:

- A **title** and **content**
- **Tags** for categorization
- An **importance** rating (1–5) the agent can use to prioritize what to surface first

## Related

- [Sessions](./sessions.md) — a session's own transcript is separate from memories; memories are for recall _across_ sessions
