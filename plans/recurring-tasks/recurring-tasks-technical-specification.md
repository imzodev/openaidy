# Recurring Tasks — Technical Specification

## Summary

Recurring tasks extend the existing task system with cron-driven re-execution. They reuse the scheduler engine and schedule input parser through a polymorphic `ScheduledRunnable` interface, while storing their state in a dedicated `task_schedules` table to keep domains clean.

This document describes the architecture, data model, scheduler integration, API surface, and execution flow. Each phase is broken out in detail in the corresponding `recurring-tasks-phase-N-*.md` file.

## Design principles

- **Reuse the engine, not the data** — share the scheduler polling loop and the cron parser, but store task-schedule state in a domain-specific table.
- **Polymorphic by interface, not by switch** — the scheduler dispatches via a `ScheduledRunnable` interface. Adding a new kind of scheduled work is a registration, not a modification of the scheduler.
- **Recurring is a property of a task, not a new entity** — the task itself doesn't change. A 1-to-1 schedule row attaches to it.
- **Replanning is opt-in, not the default** — most recurring tasks just need their existing subtasks executed again. The default `replanPolicy: 'never'` reuses them. Re-planning is available via `'on-description-change'` (smart) or `'always'` (explicit-but-expensive).
- **The same agents are reused on every run** — the `task_agents` rows attached to the original task are consulted for every execution. A user who reassigns agents on the task will see the new assignment on the next run.
- **Bounded by design** — every recurring task has a finite `maxExecutions` cap (default **9999**, no "infinite" option). Most users will never hit this; it exists to prevent accidental runaway schedules.
- **Backward compatible** — tasks without a schedule row behave exactly as before. The new code paths are opt-in via the schedule row.

---

## Architecture overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          apps/server                                    │
│                                                                         │
│  ┌────────────────────┐        ┌─────────────────────────────┐         │
│  │  SchedulerService  │        │  ScheduledRunnableRegistry  │         │
│  │  (refactored)      │◄───────│  - PulseRunnable  (kind:pulse)│       │
│  │                    │        │  - TaskRunnable   (kind:task) │       │
│  │  poll loop (5s)    │        └─────────────────────────────┘         │
│  │  claim → execute   │                                                 │
│  │  → reschedule      │                                                 │
│  └─────────┬──────────┘                                                 │
│            │                                                            │
│            │ dispatch by kind                                           │
│            ▼                                                            │
│  ┌────────────────────┐        ┌─────────────────────────────┐         │
│  │  PulseRunnable     │        │  TaskScheduleExecutor       │         │
│  │  (existing flow)   │        │  (new)                      │         │
│  │  → sessionService  │        │  → cleanup subtasks         │         │
│  │    .submitMessage  │        │  → createSession('task')    │         │
│  │                    │        │  → planningService.plan()    │         │
│  │                    │        │  → taskExecution.execute()   │         │
│  └────────────────────┘        └─────────────────────────────┘         │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
              │                                              │
              ▼                                              ▼
┌────────────────────────────┐         ┌────────────────────────────────┐
│  packages/db               │         │  packages/db                  │
│  - scheduled_jobs          │         │  - task_schedules (NEW)       │
│  - job_runs                │         │  - task_execution_history (NEW)│
│  (unchanged)               │         │  - tasks, subtasks (existing) │
└────────────────────────────┘         └────────────────────────────────┘
```

## Polymorphic runnable interface

Defined in `packages/runtime/src/scheduling/runnable.ts` (new file):

```ts
export type ExecutionResult =
  | { ok: true; durationMs: number }
  | { ok: false; error: Error; durationMs: number };

/**
 * A ScheduledRunnable is any work item that the scheduler can claim,
 * execute, and reschedule. The scheduler doesn't know what's inside —
 * it just calls these three methods.
 */
export interface ScheduledRunnable<TPayload = unknown> {
  /** Unique discriminator used by the scheduler registry. */
  readonly kind: string;

  /**
   * Atomically claim the next due item of this kind. Returns null if
   * nothing is due. Implementation must be safe for concurrent ticks
   * (use a transactional UPDATE ... WHERE nextRunAt <= now RETURNING
   * pattern, or single-server trust for SQLite).
   */
  claimNextDue(): Promise<{ id: string; payload: TPayload } | null>;

  /**
   * Execute the claimed item. Throws or returns ok=false to signal
   * failure. The scheduler will record the result and call reschedule.
   */
  execute(id: string, payload: TPayload): Promise<ExecutionResult>;

  /**
   * Compute the next run time after a successful or failed execution.
   * Returns null if the item should not be rescheduled (e.g. one-shot
   * completed, or max executions reached).
   */
  reschedule(
    id: string,
    payload: TPayload,
    result: ExecutionResult,
  ): Promise<Date | null>;
}
```

### Why an interface, not a base class

- The existing `PulseService` does not currently implement any interface — it's a CRUD facade. Asking it to extend an abstract class would force a rewrite.
- An interface lets `TaskScheduleExecutor` and a future `PulseRunnableAdapter` (wrapping `PulseService`) coexist with their own internal structure.
- The interface is intentionally minimal (3 methods). Anything more specific lives behind the kind's own service.

### Backward compatibility path for Pulses

`PulseService` keeps its current shape. We add a thin `PulseRunnableAdapter` in `apps/server/src/scheduler/pulse-runnable.ts` that:

1. Implements `ScheduledRunnable<{ jobId: string }>`
2. `claimNextDue()` → calls a new `jobsRepo.claimNextDueByKind('pulse')` method
3. `execute()` → delegates to `SchedulerService.executeJob` (preserving the existing session/isolated branches)
4. `reschedule()` → mirrors the logic currently in `SchedulerService.tick` (calculate next cron, mark one-shot completed)

The current `SchedulerService.tick` body becomes a fallback that handles the case where no runnable is registered for a kind (it keeps working with the old `executeJob` for backwards compatibility during the refactor).

---

## Data model

### New table: `task_schedules`

Added to `packages/db/src/schema/tasks.ts` (co-located with the rest of the task schema):

```sql
CREATE TABLE task_schedules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id         UUID NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
  -- The schedule definition. Exactly one of (cron_expression, preset, schedule_date) is set.
  cron_expression TEXT,         -- e.g. '0 9 * * 1-5' (validated, internal storage)
  preset          TEXT,         -- '15m' | '30m' | '1h' | '6h' | '12h' | '1d' | '1w' | NULL
  schedule_date   TIMESTAMPTZ,  -- for one-shot, NULL for recurring
  -- Polling state
  next_run_at     TIMESTAMPTZ NOT NULL,
  last_run_at     TIMESTAMPTZ,
  status          TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'paused' | 'expired'
  -- Execution behaviour
  replan_policy   TEXT NOT NULL DEFAULT 'never',   -- 'never' | 'on-description-change' | 'always'
  max_executions  INTEGER NOT NULL DEFAULT 9999,   -- ALWAYS finite; default 9999
  execution_count INTEGER NOT NULL DEFAULT 0,
  -- Description hash for change detection (used by 'on-description-change' policy).
  -- NULL until the first run completes.
  description_hash TEXT,
  -- Audit
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT task_schedules_status_check CHECK (status IN ('active', 'paused', 'expired')),
  CONSTRAINT task_schedules_replan_policy_check CHECK (replan_policy IN ('never', 'on-description-change', 'always')),
  CONSTRAINT task_schedules_max_executions_positive CHECK (max_executions > 0)
);

CREATE INDEX task_schedules_next_run_at_idx ON task_schedules(next_run_at);
CREATE INDEX task_schedules_status_idx ON task_schedules(status);
CREATE INDEX task_schedules_task_id_idx ON task_schedules(task_id);
```

#### Field rationale

| Field              | Why                                                                                                                                                         |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `task_id UNIQUE`   | A task can have at most one schedule. Update = replace, not append.                                                                                         |
| `cron_expression`  | The normalised form. UI inputs (preset, daily, raw cron) are converted to this and stored.                                                                  |
| `preset`           | Kept for UI display ("Every 15m" is friendlier than `*/15 * * * *`). Never used for execution.                                                              |
| `schedule_date`    | For one-shots. Mutually exclusive with `cron_expression` at the application layer.                                                                          |
| `replan_policy`    | `'never'` (default) \| `'on-description-change'` \| `'always'`. CHECK constraint enforces the three values.                                                 |
| `max_executions`   | **Required, non-null, positive integer.** Defaults to 9999. The schedule auto-transitions to `expired` after this many runs. There is no "infinite" option. |
| `description_hash` | SHA-256 of the task's `description` from the most recent run. Used by the `on-description-change` policy. NULL until the first run completes.               |
| `status = expired` | Terminal state when `max_executions` is reached. Distinct from `paused` (user action).                                                                      |

### New table: `task_execution_history`

Added to `packages/db/src/schema/tasks.ts`:

```sql
CREATE TABLE task_execution_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id         UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  schedule_id     UUID NOT NULL REFERENCES task_schedules(id) ON DELETE CASCADE,
  -- Lifecycle
  status          TEXT NOT NULL DEFAULT 'planned',  -- 'planned' | 'planning' | 'executing' | 'verifying' | 'completed' | 'failed'
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at     TIMESTAMPTZ,
  -- Linked session for this run
  session_id      UUID REFERENCES sessions(id) ON DELETE SET NULL,
  -- Snapshot of task config at run time (for debugging "what was the task doing when it failed?")
  task_title      TEXT NOT NULL,
  task_description TEXT NOT NULL,
  -- Outcome
  error_code      TEXT,
  error_message   TEXT,
  -- Counter (for sorting, debugging)
  attempt_number  INTEGER NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT task_execution_history_status_check CHECK (
    status IN ('planned', 'planning', 'executing', 'verifying', 'completed', 'failed')
  )
);

CREATE INDEX task_execution_history_task_id_idx ON task_execution_history(task_id, created_at DESC);
CREATE INDEX task_execution_history_schedule_id_idx ON task_execution_history(schedule_id, created_at DESC);
CREATE INDEX task_execution_history_status_idx ON task_execution_history(status);
```

#### Why a new table instead of reusing `job_runs`

- Different status vocabulary: `job_runs` uses `queued | running | succeeded | failed`. Task executions have a richer lifecycle (`planned → planning → executing → verifying → completed | failed`).
- Different foreign keys: `task_execution_history` references `task_schedules`, not `scheduled_jobs`.
- Different payload: task runs snapshot the `task_title` and `task_description` at run time, so the history is meaningful even if the task is later edited or deleted.
- Domain separation: future scheduled work (recurring backups, memory cleanup) should also have its own history table. Polluting `job_runs` with domain-specific rows makes the table harder to reason about.

### Schema: existing tables

No changes to `tasks`, `subtasks`, `task_agents`, `sessions`, or `scheduled_jobs`. The `scheduled_jobs` table remains the storage for Pulses.

---

## Shared scheduling types (Phase 0 deliverable)

The following types and functions move from `apps/server/src/pulses/utils.ts` to `packages/shared-types/src/scheduling.ts`:

```ts
// types
export type ScheduleInput =
  | { every: '15m' | '30m' | '1h' | '6h' | '12h' | '1d' | '1w' }
  | { daily: { hour: number; minute: number } }
  | { cron: string; tz?: string }
  | { at: string };

export type ParsedSchedule = {
  type: 'cron' | 'one-shot';
  cronExpression?: string;
  schedule?: Date;
  nextRunAt: Date;
};

// functions
export function parseScheduleInput(schedule: ScheduleInput): ParsedSchedule;
export function describeSchedule(parsed: ParsedSchedule): string;
```

Cron utilities (`validateCronExpression`, `calculateNextRun`, `describeCronExpression`) **stay** in `apps/server/src/scheduler/cron-utils.ts` because they depend on `croner` (server-only dependency). `parseScheduleInput` moves to `shared-types` because it only uses pure type data and the cron utilities. Wait — correction: `parseScheduleInput` _does_ call the cron utilities. Resolution: keep the type definitions in `shared-types` (pure data, no runtime), and keep `parseScheduleInput` + cron utilities together in `apps/server/src/scheduler/schedule-input.ts` (server-only). Both `pulses/utils.ts` and `tasks/execution/task-schedule-executor.ts` import from the new server-only location.

Updated plan:

- **`packages/shared-types/src/scheduling.ts`** (new): `ScheduleInput` type, `SchedulePreset` enum, `TaskSchedule` DTO type
- **`apps/server/src/scheduler/schedule-input.ts`** (new): `parseScheduleInput`, `describeScheduleInput` (extracted from `pulses/utils.ts`)
- **`apps/server/src/pulses/utils.ts`**: re-exports from new location, marks old functions as deprecated, deleted in Phase 7
- **`apps/server/src/tasks/execution/task-schedule-executor.ts`** (new): imports from `scheduler/schedule-input.ts`

---

## Scheduler integration details

### Current state

`SchedulerService.tick()` calls `jobsRepo.claimNextDueJob()` (no kind filter) and dispatches in `executeJob(job, run)` based on `job.targetType` (`session` | `isolated`).

### Target state (post Phase 2)

```ts
class SchedulerService {
  private runnables = new Map<string, ScheduledRunnable>();

  registerRunnable(runnable: ScheduledRunnable): void {
    this.runnables.set(runnable.kind, runnable);
  }

  async tick(): Promise<boolean> {
    for (const runnable of this.runnables.values()) {
      const claimed = await runnable.claimNextDue();
      if (!claimed) continue;

      try {
        const result = await runnable.execute(claimed.id, claimed.payload);
        const nextRunAt = await runnable.reschedule(
          claimed.id,
          claimed.payload,
          result,
        );
        // null means "don't reschedule" — mark expired/completed as appropriate
        if (nextRunAt === null) {
          this.logger.info(
            { kind: runnable.kind, id: claimed.id },
            'Runnable completed, not rescheduling',
          );
        }
        return true;
      } catch (error) {
        // Failure path: still call reschedule so the runnable can decide
        // whether to retry, pause, or mark failed
        await runnable.reschedule(claimed.id, claimed.payload, {
          ok: false,
          error: error instanceof Error ? error : new Error(String(error)),
          durationMs: 0,
        });
        return true;
      }
    }
    return false;
  }
}
```

### Backward compatibility for the existing Pulse flow

During Phase 0, the `SchedulerService` is updated to use the runnable registry but **the existing `executeJob` path remains as a fallback** for any job whose `kind` doesn't have a registered runnable. This lets us migrate Pulses to the new pattern in Phase 2 without breaking anything in Phase 0.

In Phase 7 (testing), once we have confidence, we remove the fallback. By that point, every `scheduled_jobs` row has `metadata.kind` set, and every kind has a registered runnable.

---

## Execution flow

### Step-by-step: scheduler tick claims a task schedule

```
1. SchedulerService.tick()
2.   for each runnable in registry:
3.     if runnable.kind !== 'task': skip
4.     claimed = taskRunnable.claimNextDue()
5.     if claimed === null: continue
6.
7.   TaskScheduleExecutor.execute(taskScheduleId, payload)
8.     1. Load task + schedule
9.     2. Acquire execution lock (UPDATE status = 'running' WHERE id = ?)
10.    3. Create task_execution_history row (status = 'planned')
11.    4. Compute willReplan from replanPolicy + descriptionHash (see Re-planning behaviour)
12.    5. Cleanup previous run artifacts (subtasks deleted only when willReplan):
13.         a. if willReplan: subtasksRepo.deleteByTask(taskId)
14.         b. tasksRepo.update(taskId, { sessionId: null, status: 'todo' })
15.    6. Create new session: sessionService.createSession(`Task: ${title}`, 'task')
16.    7. tasksRepo.update(taskId, { sessionId: newSessionId, status: 'in_progress' })
17.    8. If willReplan:
18.         a. planningService.plan(taskId, sessionId)
19.         b. history row → status = 'planning' → 'executing'
20.    9. Else: taskExecution.executeSubtasks(taskId) OR submit description as message
21.    10. Return ok=true (the run itself is async — verification happens via RunEventEmitter)
22.
23.   TaskScheduleExecutor.reschedule(taskScheduleId, payload, result)
24.     1. If schedule.cronExpression:
25.          nextRunAt = calculateNextRun(cron, new Date())
26.        Else (one-shot):
27.          nextRunAt = null  // mark expired
28.     2. executionCount += 1
29.     3. descriptionHash = sha256(payload.taskDescription)
30.     4. If executionCount >= maxExecutions:
31.          status = 'expired'
32.     5. task_schedulesRepo.update(id, { nextRunAt, lastRunAt, status, executionCount, descriptionHash })
33.     6. Return nextRunAt
```

### Re-planning behaviour

Re-planning is controlled by the `replanPolicy` field on the schedule. There are three values:

| Policy                  | When the planning agent runs                                                                                                                | Cleanup of prior subtasks         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `never` (**default**)   | Never. The subtasks created at planning time (manually or by a prior `tasks_create` with `planningEnabled = true`) are reused on every run. | No                                |
| `on-description-change` | Only when the SHA-256 hash of `description` differs from `task_schedules.description_hash` (updated at the end of every run).               | Only when the description changed |
| `always`                | On every run, regardless of the description. Use sparingly — this is the expensive path.                                                    | Yes (always)                      |

Pseudocode for the executor's plan-decision step:

```ts
const currentHash = hashDescription(task.description);
const hashChanged = currentHash !== schedule.descriptionHash;
const willReplan =
  schedule.replanPolicy === 'always' ||
  (schedule.replanPolicy === 'on-description-change' && hashChanged);

// If we are about to replan, the old subtasks are obsolete. If we are
// not replanning, keep them so the new session can execute them.
if (willReplan) {
  await subtasksRepo.deleteByTask(taskId);
}
```

Rationale:

- The default path is **cheap**: most recurring tasks are "run the same plan over and over". Re-running the planning agent would burn tokens and add latency for no benefit.
- The `on-description-change` path is **smart**: when the user actually edits the task description, the plan should refresh. Otherwise, reuse.
- The `always` path is the **escape hatch** for the rare cases that need a fresh plan every time (e.g. a "summarise today's news" task where the input changes implicitly via time, not via the description).

The history table records the `task_description` snapshot on each row, so even when the plan is reused, the user can later inspect "what was the description at run #42?" — useful for debugging or auditing.

### Cleanup semantics

| Policy                              | Subtasks deleted before run? | Session ref reset before run? | New session created? |
| ----------------------------------- | ---------------------------- | ----------------------------- | -------------------- |
| `never`                             | **No** (reuse them)          | Yes                           | Yes                  |
| `on-description-change` (no change) | **No**                       | Yes                           | Yes                  |
| `on-description-change` (change)    | **Yes**                      | Yes                           | Yes                  |
| `always`                            | **Yes**                      | Yes                           | Yes                  |

### History row lifecycle

| Phase             | Status      | When the row enters this state                             |
| ----------------- | ----------- | ---------------------------------------------------------- |
| Pre-execution     | `planned`   | Row created at the start of `TaskScheduleExecutor.execute` |
| Planning          | `planning`  | After `planningService.plan()` is called                   |
| Subtask execution | `executing` | After session is created and messages submitted            |
| Verification      | `verifying` | After all subtasks have been submitted                     |
| Terminal success  | `completed` | Verification passed (or no subtasks to verify)             |
| Terminal failure  | `failed`    | Any step threw, or verification failed                     |

The executor updates the row's `status` and `finished_at` as the run progresses. The existing `TaskExecution.handleRunEvent` continues to drive subtask-level state changes; the history row is a parallel timeline.

---

## API surface

All routes are additions or extensions to existing `/api/tasks/*` paths. No new top-level route group.

### Extended `POST /api/tasks`

Accepts an optional `schedule` field:

```json
{
  "title": "Daily standup summary",
  "description": "Summarize what I worked on yesterday based on my notes",
  "priority": "medium",
  "planningEnabled": true,
  "schedule": { "every": "1d" }
}
```

If `schedule` is present, the server:

1. Creates the task in `tasks` (existing flow)
2. Parses the schedule
3. Creates a `task_schedules` row linked by `task_id`
4. Returns the task with a `schedule` field populated

### Extended `GET /api/tasks`

Adds `schedule` to the response shape when a task has one attached:

```json
{
  "tasks": [
    {
      "id": "...",
      "title": "Daily standup summary",
      "status": "in_progress",
      "schedule": {
        "cron": "0 9 * * *",
        "preset": "1d",
        "nextRunAt": "2026-04-23T09:00:00.000Z",
        "scheduleHuman": "Every day at 9am",
        "status": "active",
        "replanPolicy": "on-description-change",
        "maxExecutions": 9999,
        "remainingExecutions": 9987,
        "executionCount": 12,
        "lastRunAt": "2026-04-22T09:00:00.000Z"
      }
    }
  ]
}
```

### New `PATCH /api/tasks/:id/schedule`

Add, update, or remove the schedule attached to a task.

```json
// Add
{ "schedule": { "every": "6h" } }

// Update
{ "schedule": { "every": "1h" }, "status": "active" }

// Remove
{ "schedule": null }
```

### New `POST /api/tasks/:id/schedule/pause`

Shortcut for `PATCH /api/tasks/:id/schedule` with `status: 'paused'`. Useful for UI buttons and the `tasks_pause_schedule` tool.

### New `POST /api/tasks/:id/schedule/resume`

Mirror of pause. Sets `status: 'active'` and recomputes `nextRunAt` from the cron expression.

### New `GET /api/tasks/:id/executions`

Paginated history of `task_execution_history` rows for a task.

```
GET /api/tasks/:id/executions?limit=20&offset=0&status=completed
```

Response:

```json
{
  "executions": [
    {
      "id": "...",
      "taskId": "...",
      "status": "completed",
      "startedAt": "...",
      "finishedAt": "...",
      "durationMs": 45000,
      "sessionId": "...",
      "attemptNumber": 1,
      "errorCode": null,
      "errorMessage": null
    }
  ],
  "total": 47,
  "limit": 20,
  "offset": 0
}
```

### New `POST /api/tasks/:id/trigger` (already exists for one-off, extended for recurring)

The existing endpoint runs a task immediately. For recurring tasks, it must:

- Create a history row (status: `planned` → `executing` → ...)
- NOT call `reschedule` (so the next scheduled run is not affected)
- Return the history row alongside the existing response

This endpoint already exists; Phase 4 only updates the implementation to write a history row.

---

## Built-in tools (agent-facing)

Updated tools in `apps/server/src/tools/tasks/`:

| Tool name               | Change                                                                                  |
| ----------------------- | --------------------------------------------------------------------------------------- |
| `tasks_list`            | Include `schedule` field in response when present                                       |
| `tasks_create`          | Accept optional `schedule` parameter (same shape as API)                                |
| `tasks_update`          | Accept optional `schedule` parameter; can also patch `replanPolicy` and `maxExecutions` |
| `tasks_trigger_now`     | **New** — force an immediate run of a recurring task                                    |
| `tasks_pause_schedule`  | **New** — pause a task's schedule                                                       |
| `tasks_resume_schedule` | **New** — resume a paused schedule                                                      |
| `tasks_list_executions` | **New** — list execution history for a task                                             |

All new tools follow the existing pattern: a `ToolMeta` entry in `catalog.ts`, an implementation file in `tools/tasks/`, an `index.ts` re-export, and registration in `tools/registry.ts`.

---

## Web UI changes

### `TaskModal` — new "Schedule" tab

When a user opens a task in the modal, the existing tabs (`Details`, `Subtasks`, `Agents`, `History`) get a new sibling: `Schedule`. The tab is enabled only when the user has `recurring-tasks` permission (initially: everyone; later: configurable).

The tab contains:

- A schedule type selector (Interval, Daily, Cron, One-shot) — same components used by `PulsesPage`
- A preset dropdown for Interval mode
- Hour/minute inputs for Daily mode
- A cron expression field with validation and human-readable preview
- A `replanPolicy` selector (radio buttons: "Never re-plan" / "Re-plan if description changes" / "Always re-plan")
- A `maxExecutions` input (optional; defaults to 9999, no "infinite" option)
- Status indicator (`active` / `paused` / `expired`)
- Stats: `nextRunAt`, `lastRunAt`, `executionCount`
- Buttons: `Pause` / `Resume` / `Run now` / `Remove schedule`

### `TaskCard` — recurring badge

When a task has a `task_schedule` row, the Kanban card shows a small `🔁` icon and the human-readable schedule below the title. Clicking the icon scrolls to the schedule tab in the modal.

### New `TaskExecutionsPage`

At `/tasks/:id/executions`, shows a table of `task_execution_history` rows with status, timing, duration, and a link to the underlying session. Pagination via the standard limit/offset pattern.

### `TaskExecutionsPage` is also linked from `PulsesPage` indirectly

The `PulsesPage` UI stays unchanged. It is a separate domain. The two UIs share components (cron editor, preset selector) via extraction to `components/common/ScheduleEditor/`.

---

## Security model

- All `/api/tasks/*` routes require authentication, same as the existing task routes.
- Schedule manipulation requires the same scope as task creation (no new scope at launch).
- The scheduler executes task runs with the server's own dispatch credentials, not the original creator's token. This matches the existing Pulse behaviour.

---

## Performance considerations

- **Polling overhead**: the scheduler adds one new kind to its loop. With the existing 5s poll interval, the cost of an extra `claimNextDue()` query per tick is negligible (indexed by `next_run_at`).
- **Subtask cleanup**: deleting subtasks at the start of each run is bounded by the typical number of subtasks per task (1-20). For pathological cases (100+ subtasks), Phase 7 will add a `LIMIT 1000` cap and a warning log.
- **History retention**: the history table grows linearly with runs. Phase 7 includes a recommended retention policy (default: keep 1000 rows per task, archive older to a `task_execution_history_archive` table). For v1, no retention is enforced.
- **Re-planning cost**: the planning agent is invoked on each run **only when** the schedule's `replanPolicy` is `'always'`, or `'on-description-change'` with a hash mismatch. Default (`'never'`) is cheap. See "Re-planning behaviour" above.

---

## Migration plan

No data migration is required — `task_schedules` and `task_execution_history` are new tables. Existing tasks are unaffected.

After Phase 0:

- Pulses continue working identically (the refactor is internal to `SchedulerService`)
- No tasks have schedules

After Phase 1:

- Schema is ready, no behaviour change

After Phase 2:

- The polymorphic runnable registry is in place
- Pulses are registered as `PulseRunnable` (kind: `'pulse'`)
- Tasks are NOT yet recurring (no executor registered)

After Phase 3:

- `TaskScheduleExecutor` is registered
- A user can create a recurring task through the API
- The existing one-off `executeTask` flow is unchanged

Phases 4-6 layer on the API, tools, and UI.

Phase 7 cleans up deprecated code paths and adds comprehensive tests.

---

## Out of scope (deferred)

- **Distributed locking** for multi-server deployments. The SQLite single-server trust model is preserved. PostgreSQL `FOR UPDATE SKIP LOCKED` is a Phase 7 stretch goal.
- **Timezone-aware cron**. Already deferred project-wide. Will be revisited when the broader scheduling work happens.
- **`replanPolicy: 'subtask-only'`** — preserving subtasks across runs without a hash comparison. The `'never'` policy is now the cheap default that does exactly this; a separate `'subtask-only'` mode is not needed.
- **Conditional execution** — "only run if previous run failed" or "skip if predicate". Deferred; the agent itself can express this through prompt design.
- **Per-subtask recurrence** — one task with multiple independently-scheduled subtasks. Deferred; complicates the data model significantly.
- **Backfill for missed runs** — if the server was down for an hour, do we run the missed 12 hourly tasks? Default: no, just resume from the next scheduled time. A "catch-up" mode is a v2 feature.
