---
summary: 'Pulses are scheduled prompt executions — a cron job for your AI agent'
read_when:
  - You want a simple recurring or one-off prompt without the overhead of a full task
title: 'Pulses'
---

# Pulses

Pulses are scheduled prompt executions — you define a prompt and a schedule, and OpenAidy automatically fires the prompt against an agent at the specified interval.

Think of a Pulse as a cron job for your AI agent: "Every morning at 9am, run this prompt and store the result."

For multi-step, structured recurring work, see [Task Schedules](./task-schedules.md#task-schedules-vs-pulses) instead — that page also covers how the two compare.

## Core concepts

### Pulse

A named, scheduled prompt. Stored as a `scheduled_job` record with `metadata.kind = 'pulse'`. Contains:

- A **prompt** — the message sent to the agent on each execution
- A **schedule** — when and how often to fire
- An optional **agent** — defaults to the configured default agent
- An optional **session** — pin to an existing session, or create an isolated one per run
- Optional **delivery** — send the answer to you (WhatsApp, see [Assistant](./assistant.md)), and/or only when there's something to say (the agent answers `NO_UPDATE` on quiet runs, and nothing is sent)

### Schedule types

| Type     | Example                | Use case            |
| -------- | ---------------------- | ------------------- |
| Interval | every 30 minutes       | Frequent checks     |
| Daily    | every day at 9am       | Morning briefs      |
| Cron     | `0 9 * * 1-5`          | Advanced scheduling |
| One-shot | at a specific datetime | One-time reminders  |

Daily and cron times are read in the timezone set in Settings → Assistant (UTC until it's set).

### Execution modes

| Mode                 | Behaviour                                                                        |
| -------------------- | -------------------------------------------------------------------------------- |
| **Session-attached** | Fires into a pinned persistent session — agent retains full conversation history |
| **Isolated**         | Creates a fresh session per run — agent starts clean each time                   |

### Run history

Every execution is recorded as a `job_run`. You can inspect status (`succeeded`, `failed`), timestamps, error messages, and what the agent answered and where it was sent, for any past run.

Reminders that agents schedule from conversations, and the daily briefing, are scheduled prompts too; see [Assistant](./assistant.md).

## Quick mental model

```
Pulse definition
  ├── name: "Daily standup summary"
  ├── prompt: "Summarize what I worked on yesterday based on my notes"
  ├── schedule: every day at 09:00 UTC
  ├── agent: default
  └── session: isolated (new session per run)

         ↓  scheduler fires

  job_run record created
  SessionMessageService.submitMessage(prompt)
  Agent responds → stored in session transcript
  job_run marked succeeded / failed
```
