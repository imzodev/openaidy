---
summary: 'Run a task automatically on a recurring or one-shot schedule, and how that differs from a Pulse'
read_when:
  - You want a task to re-run itself on a cron/interval schedule
  - You are trying to decide between a scheduled task and a Pulse
title: 'Task Schedules'
---

# Task Schedules

A task schedule turns a [task](./tasks.md) into a cron-driven workflow: define the task once, attach a schedule, and OpenAidy re-runs its full lifecycle — planning, subtasks, verification — on every tick. Think of it as a kanban card that walks itself across the board on a timer.

Attach a schedule from the task's **Schedule** tab in the web UI, or via the nested `schedule` field when creating a task through the API.

## Schedule types

| Type     | Example                         | Use case                      |
| -------- | ------------------------------- | ----------------------------- |
| Interval | `every: '30m'`                  | Frequent health checks, syncs |
| Daily    | `daily: { hour: 9, minute: 0 }` | Morning briefs, daily digests |
| Cron     | `cron: '0 9 * * 1-5'`           | Weekday-only schedules        |
| One-shot | `at: '2026-12-31T23:59:00Z'`    | A single deferred run         |

A schedule also has a **status** (`active`/`paused`) and a max-executions cap (defaults to 9999 runs, after which it transitions to `expired`).

## Replan policy

Every run, the schedule decides whether to re-invoke the planning agent before executing:

- **`never` (default)** — reuse the subtasks from the last planning pass. No re-planning. This is the cheap, common case: most recurring tasks just need their existing subtasks executed again.
- **`on-description-change`** — only re-plan when the task's `description` has actually changed since the last run.
- **`always`** — re-plan from scratch on every run, ignoring whether the description changed. Expensive; use only when the plan genuinely needs to be regenerated each time.

## What happens on each run

1. Any subtasks from the previous run are cleaned up (unless the replan policy is reusing them).
2. Planning runs or is skipped, per the replan policy above.
3. A new `task`-type session is created, titled `Task: <title> (run N)`.
4. The task executes — same assigned agents as the original task, subtasks run in dependency order through the same [workflow graph](./tasks.md#the-workflow-graph) engine.
5. Results go through the normal verification/retry flow.
6. A row is appended to the task's execution history: status, timing, and any deliverables produced.

Each run is fully independent. The kanban board always shows the task's _most recent_ run status; the history view shows the full timeline across all runs.

## Task Schedules vs. Pulses

These are easy to confuse — both are "run something on a schedule." The difference is what they run:

|          | Task Schedule                                                | [Pulse](./pulses.md)                                                                     |
| -------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Runs     | A full task (planning, subtasks, verification, deliverables) | A single prompt                                                                          |
| Session  | A new session created per run                                | Either an existing session or an isolated one-off run                                    |
| Best for | Multi-step, structured, recurring work                       | A simple recurring or one-off prompt — a reminder, a daily digest line, a quick check-in |

If what you need is "send this agent this exact prompt every morning," reach for a Pulse — it's lighter weight. If you need multiple coordinated steps that repeat, use a task schedule.
