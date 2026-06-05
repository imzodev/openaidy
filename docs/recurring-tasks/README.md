# Recurring Tasks

Recurring tasks turn the OpenAidy task system (planning → subtasks → verify → done) into a cron-driven workflow. You define a task once, attach a schedule, and OpenAidy re-runs the lifecycle on every tick — re-using the existing subtasks by default (cheap) or optionally re-planning from the latest `description` (opt-in).

Think of a recurring task as a "Kanban card that walks itself across the board" — every cycle it resets, executes its current subtasks, and produces a fresh execution you can inspect.

## Overview

- [Technical Specification](./recurring-tasks-technical-specification.md) — architecture, data model, scheduler integration, polymorphic runnable pattern
- [Phase 0: Scheduling Refactor](./recurring-tasks-phase-0-scheduling-refactor.md) — extract `ScheduleInput` to server-only location, introduce polymorphic `ScheduledRunnable` interface
- [Phase 1: Schema and Repository](./recurring-tasks-phase-1-schema-repository.md) — `task_schedules` table, Drizzle schema, repository pattern
- [Phase 2: Polymorphic Executor](./recurring-tasks-phase-2-executor.md) — `TaskScheduleExecutor` implementing the runnable interface
- [Phase 3: Service Layer](./recurring-tasks-phase-3-service-layer.md) — `TaskScheduleService`, history table, app wiring
- [Phase 4: REST API](./recurring-tasks-phase-4-rest-api.md) — extended `/api/tasks` endpoints for schedule CRUD and history
- [Phase 5: Built-in Tools](./recurring-tasks-phase-5-tools.md) — agent-facing tools for `tasks_create`, `tasks_update`, `tasks_trigger_now`
- [Phase 6: Web UI](./recurring-tasks-phase-6-frontend.md) — Schedule tab in `TaskModal`, recurring badge, executions history page
- [Phase 7: Testing and Validation](./recurring-tasks-phase-7-testing.md) — unit + E2E tests, regression sweep for Pulses

## Core concepts

### Recurring task

A standard OpenAidy task (`tasks` table row) with a 1-to-1 schedule definition in a new `task_schedules` table. The schedule contains:

- A **cron expression** or **preset** (e.g. `15m`, `1h`, `1d`) — the same human-friendly formats used by Pulses
- A **next-run timestamp** — consumed by the scheduler polling loop
- A **replan policy** — one of three values:
  - `never` (**default**): reuse the existing subtasks across runs. No re-planning. Cheap.
  - `on-description-change`: re-invoke the planning agent only when the `description` has been edited since the last run (SHA-256 hash comparison). Cheap when the description is stable.
  - `always`: re-invoke the planning agent on every run, ignoring the description. Expensive — use only when the task's plan truly needs to be regenerated from scratch each time.
- A **status** — `active` or `paused`
- A **max executions** cap — defaults to **9999** runs, then the schedule transitions to `expired`
- An **execution counter** — incremented after each run

### Why not just a Pulse with task fields?

Pulses are flat: one prompt, one session, one response. Tasks have a rich lifecycle: planning agent, subtask dependency graph, verification step, retry semantics, deliverable tracking, run-event subscription. Reusing the `scheduled_jobs` table would either:

- pollute the jobs table with task-specific payload shapes, or
- force us to re-implement the task lifecycle in the scheduler's `executeJob` switch

A new `task_schedules` table keeps both domains clean, while still sharing the **scheduler engine** and **schedule input parser** through a polymorphic runnable interface.

### Schedule types

Reuses the existing `ScheduleInput` discriminated union from `pulses/utils.ts` (which is moved to `apps/server/src/scheduler/schedule-input.ts` in Phase 0). The type itself is re-exported from `@openaidy/shared-types/src/scheduling.ts`; the runtime parser stays server-only because it depends on `croner`:

| Type     | Example                | Use case                      |
| -------- | ---------------------- | ----------------------------- |
| Interval | every 30 minutes       | Frequent health checks, syncs |
| Daily    | every day at 9am       | Morning briefs, daily digests |
| Cron     | `0 9 * * 1-5`          | Weekday-only schedules        |
| One-shot | at a specific datetime | One-time deferred tasks       |

### Execution model

When the scheduler fires a task schedule:

1. **Cleanup** — delete subtasks only when the executor will not preserve them (the default `replanPolicy: 'never'` reuses them — see step 3). The previous session reference is always reset.
2. **Plan** — controlled by the `replanPolicy` on the schedule:
   - `replanPolicy: 'never'` (default): **skip planning entirely**. Reuse the subtasks that were created at planning time (manually or by a prior `tasks_create` with planning). This is the cheap path — most recurring tasks just need their existing subtasks executed again and again.
   - `replanPolicy: 'on-description-change'`: invoke the planning agent **only when** the SHA-256 hash of `description` differs from the hash stored on the schedule row. The hash is updated at the end of every run.
   - `replanPolicy: 'always'` (escape hatch): re-invoke the planning agent on every run, ignoring the description. Use sparingly — this is the expensive path.
3. **Create new session** — `task` type session titled `Task: <title>` (run N)
4. **Execute** — invoke the assigned agents (same as the original task) with the description or with each subtask in dependency order
5. **Verify** — re-uses the existing `TaskExecution` verification flow (subtask runs are verified by a follow-up agent turn, or auto-completed)
6. **Record** — append a row to `task_execution_history` with status, timing, deliverable references

Each run is **fully independent**: subtasks and the previous session are cleaned up, the planning agent re-runs from the original `description`, and the same `task_agents` (assigned agents) are reused. The task row in the Kanban board always shows the **most recent** status, and the history view exposes the full timeline.

### Scheduler integration (polymorphic runnables)

The current `SchedulerService` is hard-wired to `JobsStore` and `targetType: 'session' | 'isolated'`. Phase 0 introduces a `ScheduledRunnable` interface and a registry of runnables keyed by `kind`:

```ts
interface ScheduledRunnable {
  kind: string;
  claimNextDue(): Promise<{ id: string; runnable: unknown } | null>;
  execute(id: string, runnable: unknown): Promise<ExecutionResult>;
  reschedule(
    id: string,
    runnable: unknown,
    success: boolean,
    error?: Error,
  ): Promise<Date | null>;
}
```

Pulses become `PulseRunnable` (kind: `'pulse'`), tasks become `TaskRunnable` (kind: `'task'`). Adding a third kind (recurring memory cleanup, daily backup, etc.) is a matter of implementing the interface and registering it.

The scheduler tick iterates all registered runnables, claims the next due item from each, and dispatches to the appropriate `execute` method. This is the same conceptual model as Kubernetes controllers, but kept deliberately simple.

### Run history

Each execution creates a row in a new `task_execution_history` table — **not** in `job_runs`. Reasoning:

- Task executions have different lifecycle states (planned, planning, executing, verifying, completed, failed) than job runs (queued, running, succeeded, failed)
- Task executions reference subtask IDs and session IDs directly
- Keeps the jobs domain clean for future work (e.g. a hypothetical "recurring backup" feature should also have its own history table, not pollute `job_runs`)

## Quick mental model

```
Recurring task definition
  ├── task row (tasks table)
  │     ├── title, description, priority, agents
  │     └── status: reflects most recent run
  ├── schedule row (task_schedules table, 1:1)
  │     ├── cron / preset / one-shot
  │     ├── nextRunAt
  │     ├── replanPolicy: 'never' | 'on-description-change' | 'always'
  │     ├── maxExecutions: number (always finite, default 9999)
  │     └── executionCount: 0, 1, 2, ...
  └── executions (task_execution_history)
        ├── run #1: 2026-04-22 09:00 → succeeded
        ├── run #2: 2026-04-22 10:00 → succeeded
        └── run #3: 2026-04-22 11:00 → failed (timeout)

         ↓  scheduler fires (every 1h)

  TaskRunnable.claimNextDue()
    → finds task_schedule where nextRunAt <= now AND status = 'active'
  TaskRunnable.execute()
    ├── subtasksRepo.deleteByTask(taskId)  ← ONLY when replanPolicy is not 'never'
    ├── sessionService.createSession('Task: …', 'task')
    ├── if replanPolicy = 'on-description-change' and hash differs:
    │     planningService.plan(taskId, sessionId)  ← hash check makes this cheap
    │   elif replanPolicy = 'always':
    │     planningService.plan(taskId, sessionId)  ← expensive, opt-in
    │   else ('never', default): skip planning, reuse existing subtasks
    └── taskExecution.executeSubtasks(taskId)  ← uses the original task_agents
  TaskRunnable.reschedule()
    ├── calculateNextRun(cron) → nextRunAt
    ├── executionCount += 1
    └── if executionCount >= maxExecutions (default 9999): status = 'expired'
```

## Relationship to existing features

| Feature                 | Relationship                                                                                                                                                                                          |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Pulses**              | Shares `ScheduleInput` and `cron-utils`. Different execution semantics (flat prompt vs full task lifecycle).                                                                                          |
| **Tasks**               | 1-to-1 extension: every recurring task is a regular task with a schedule attached. The same `task_agents` rows are reused on every run.                                                               |
| **Scheduler**           | `SchedulerService` becomes a registry of `ScheduledRunnable` implementations.                                                                                                                         |
| **Sessions**            | Each task execution creates a new `task` session, parallel to the existing pattern.                                                                                                                   |
| **RunEventEmitter**     | The task execution path is unchanged — it still subscribes to `run.completed` and `run.failed`.                                                                                                       |
| **Planning**            | Re-invoked on every run **only when** the schedule's `replanPolicy` is `'always'` or `'on-description-change'` with a hash mismatch. Default (`'never'`) is cheap — the existing subtasks are reused. |
| **Skills / Workspaces** | Unaffected. The assigned agent still uses the same workspace and skills per session.                                                                                                                  |

## Out of scope (v1)

- `replanPolicy: 'subtask-only'` (the cheap "never" path is the new default; subtask-only was renamed)
- Per-subtask recurrence (one task, multiple independent scheduled subtasks)
- Conditional scheduling ("only run if previous run failed")
- Distributed locking for multi-server deployments (SQLite skip-locked pattern; PostgreSQL is a Phase 7 stretch goal)
- Timezone-aware cron (`tz` field) — already deferred in Pulses; will be revisited project-wide
- **No "infinite" max executions.** Every recurring task must declare a finite cap. Default is 9999.
