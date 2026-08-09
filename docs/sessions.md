---
summary: 'How conversations, context, and run history work in OpenAidy'
read_when:
  - You want to understand the session/conversation model
  - You are building against the sessions API
title: 'Sessions'
---

# Sessions

A session is a conversation — the container for a message transcript, tied to one agent at a time. Every chat you have with an agent, every task's execution, and every subtask's execution happens inside a session.

## Session types

| Type      | Created by                  | Purpose                                                                                                   |
| --------- | --------------------------- | --------------------------------------------------------------------------------------------------------- |
| `chat`    | You, from the web UI or API | A normal back-and-forth conversation with an agent                                                        |
| `task`    | The task system             | The top-level session for a [task](./tasks.md) that has no subtasks, or that tracks overall task progress |
| `subtask` | The task system             | One session per subtask, so each step of a task has its own isolated transcript                           |

## Session status

Sessions are `active` by default. You can archive a session (hides it from the default list without deleting it) or delete it. Deleted sessions are marked `deleted`, not immediately purged.

You can also **favorite** a session to pin it — favorited sessions get a `favoritedAt` timestamp and typically surface at the top of the session list in the UI.

## The message model

Each message in a session has a `role`:

- `user` — what you (or a channel's sender) sent
- `assistant` — the agent's response
- `system` — a system-level instruction injected into the transcript
- `tool` — the result of a tool call the agent made

Sending a message:

```
POST /api/sessions/:sessionId/messages
{ "role": "user", "content": "your message here", "agentId": "default" }
```

The response streams back over WebSocket (see [Agents](./agents.md#streaming-responses)) rather than in the HTTP response body — the POST confirms the message was accepted and a run started.

## Runs

Every time an agent processes a message, that's a **run**. A run has a status (`queued`, `running`, `succeeded`, `failed`, `cancelled`) and, when finished, a `finishReason` (`stop`, `length`, `tool_calls`, `content_filter`, `error`). Runs are persisted, so you can review a session's full run history — including token usage and cost per run — even after the server restarts. See [Usage](./usage.md) for how that cost data is aggregated.

## Finding sessions

The session list supports search (by title or content) alongside the usual filters — status, favorited, by agent. Use this instead of scrolling when you have a lot of history: `GET /api/sessions/search`.

## Context and memory

A session's context is its own message transcript — an agent only sees what happened in _that_ session by default. To recall things across sessions, agents use the separate [Memories](./memories.md) system (`memory_save`/`memory_search`), which is explicit and persistent rather than automatic.
