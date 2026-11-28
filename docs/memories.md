---
summary: 'What Aidy learns about you from your conversations, explicit agent memory (memory_save/memory_search), and session recall'
read_when:
  - You want an agent to remember things across separate sessions
  - You want to see, correct or turn off what Aidy learns about you
title: 'Memories'
---

# Memories

Each session starts with no knowledge of any other session's transcript. Memory is how what matters carries over. There are two kinds:

- **About you** — what Aidy knows about its owner: your preferences, the people you mention, your routines and goals. It's **shared by every agent** and mostly **learned automatically** from your conversations.
- **Agent memories** — notes an agent saves on purpose with `memory_save` and looks up with `memory_search`.

## About you: learned memory

When a conversation with you goes quiet (about 10 minutes after your last message), Aidy reads the new part of it with the same model the conversation used and asks one question: did this teach anything lasting about you? Usually the answer is no. When it is yes, it saves a short fact ("Prefers short answers", "Ana is the business partner", "Closes the books every Friday"), or updates one it already had instead of duplicating it.

Every agent then sees these facts in its prompt (an `[ABOUT_THE_OWNER]` block, most important first), so a new conversation with any agent starts already knowing who it works for.

What is never learned or shared:

- **Conversations with customers.** A WhatsApp/Discord chat with anyone other than you (see [Assistant](./assistant.md)) is never read, the facts are never put in its prompt, and `memory_search` there doesn't return them.
- **Turns you didn't write**: pulse and reminder prompts, the daily briefing, and work one agent hands another.
- **Secrets** (passwords, card numbers, keys, codes) and details of the task at hand.

You're in control:

- **Memories → About you** lists everything, with a **Learned** badge and a link to the conversation each fact came from. Edit or delete any of them, or add your own.
- Tell any agent "remember that…" or "that's not true anymore" and it saves or removes the fact (`memory_save` with `scope: "owner"`, `memory_delete`).
- **Settings → Assistant → What Aidy learns about you** turns learning off, or forgets everything learned (what you or an agent saved on purpose is kept).

It's on by default (`owner.memory.learn` in the config). Conversations older than 7 days when you upgrade are not read.

## Agent memories

Two tools let an agent keep its own notes:

1. **`memory_save`** — the agent explicitly persists a discrete fact, decision, or note.
2. **`memory_search`** — the agent searches previously saved memories by keyword (its own, plus what's known about you).

The agent decides what's worth remembering, and decides when to go look something up.

## Example flow

> **You:** "Let's continue working on the ABC project."
>
> **Agent:** calls `memory_search("ABC project")` → gets back _"ABC project uses React + FastAPI, repo at github.com/user/abc, last milestone: auth module complete"_ → responds with that context already loaded.

## Session recall (a separate, complementary tool)

An agent can also search _past conversations themselves_ rather than explicit memories: `sessions_search` finds sessions by topic, and `sessions_read` loads a found session's full message history. This is useful when you want the agent to pick up a prior conversation verbatim rather than a saved summary.

## Scope

Agent memories are scoped **per agent** — an agent only sees memories it (or another instance of the same agent) created, identified by `agent_id`. The one exception: your configured default agent can read and write every agent's memories, which is useful if you want one "assistant" agent able to draw on everything the others have learned.

Each memory has:

- A **title** and **content**
- **Tags** for categorization
- An **importance** rating (1–5) the agent can use to prioritize what to surface first
- A **source**: `learned` (from a conversation), `agent` (saved by an agent) or `user` (written by you in the UI)

## Related

- [Sessions](./sessions.md) — a session's own transcript is separate from memories; memories are for recall _across_ sessions
