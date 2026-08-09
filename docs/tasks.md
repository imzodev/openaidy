---
summary: 'Tasks, subtasks, the workflow graph (conditional edges, loops, approval gates), and the kanban board'
read_when:
  - You want to run multi-step, structured work instead of a single chat
  - You are building a workflow with conditional branches, retries, or a human approval step
title: 'Tasks'
---

# Tasks

A task is structured, trackable work — as opposed to a session, which is just a conversation. Tasks live on a kanban board and move through `backlog → todo → in_progress → review → done` (or `cancelled` at any point). Every task has a `priority` (`low`/`medium`/`high`/`urgent`).

A simple task can just run directly against a single session. A complex task gets broken into **subtasks**.

## Subtasks

A subtask is one discrete step, each running in its own [session](./sessions.md) so its transcript stays isolated. A subtask moves through `pending → assigned → in_progress → completed`/`failed`, and can be assigned to a specific agent.

You can create subtasks manually, or enable **planning** on a task (`planningEnabled: true`) — a planning agent decomposes the task's description into subtasks automatically. Planning itself has its own status (`pending → in_progress → completed`/`failed`) tracked separately from the task's own status.

## The workflow graph

Subtasks aren't just a flat list — they form a dependency graph. Each connection between two subtasks is an **edge**, and edges come in two kinds:

### Dependency edges (the default)

"Don't start B until A finishes." A subtask with multiple incoming dependency edges waits for _all_ of them to complete before it becomes executable. This is what most tasks use, whether created manually or by the planning agent.

### Conditional edges

"Only start B if A's result matches a condition." A conditional edge only counts as satisfied when the upstream subtask's result passes a check:

| Operator        | Meaning                                                    |
| --------------- | ---------------------------------------------------------- |
| `equals`        | Result matches the condition value exactly                 |
| `contains`      | Result contains the condition value as a substring         |
| `matches_regex` | Result matches the condition value as a regular expression |

This is how you build branches: two subtasks conditioned on opposite outcomes of the same upstream subtask, so only one branch actually runs.

Cycles are rejected when you create an edge — the graph is validated to stay acyclic (aside from the bounded self-loops below, which are a different mechanism).

## Bounded loops

A subtask can loop on itself: keep re-running until its own result satisfies a condition, or until it hits an iteration cap. Configure `loopMaxIterations` plus a condition operator/value on the subtask. Each iteration's result is fed back in so the agent can build on (or fix) its previous attempt; if the cap is reached without satisfying the condition, the subtask fails instead of completing. This is a self-contained loop — it's a separate mechanism from the retry count below.

## Approval gates

A subtask with `subtaskKind: 'approval_gate'` pauses execution and waits for a human decision instead of running an agent. While waiting, it records `awaitingApprovalSince`; resolving it sets `approvalDecision` (approved/rejected), an optional `approvalNote`, and `approvedBy`. Use this to put a human checkpoint in the middle of an otherwise automated workflow — for example, requiring sign-off before a subtask that sends an email or publishes something externally.

## Verification and retries

When a subtask finishes, its result can go through verification before being marked complete — if verification rejects it, the subtask retries automatically (up to a configurable limit) with the rejection reason fed back into the next attempt. If a subtask genuinely gets stuck `in_progress` past a timeout, it's automatically retried or failed depending on how many attempts it's already had.

The retry limit, and how much of a completed dependency's result gets carried into the next subtask's prompt, are both configurable — see [Configuration](./config.md#execution-tuning).

## The kanban board and the visual editor

The web UI's Tasks page shows the kanban board (grouped by status) and a visual workflow editor for the subtask graph — drag to create dependency/conditional edges, configure loops and approval gates without writing raw API calls.

## Related

- [Task Schedules](./task-schedules.md) — run a task automatically, on a recurring or one-shot schedule
- [Pulses](./pulses.md) — a separate, lighter-weight scheduled-prompt mechanism; see that page for how it differs from a scheduled task
