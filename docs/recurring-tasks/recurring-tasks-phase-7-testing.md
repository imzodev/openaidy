# Phase 7: Testing and Validation

## Overview

Phase 7 is the test-and-cleanup phase. We add the test coverage that should have shipped incrementally, fix any regressions discovered, and remove the now-unused legacy code paths from Phase 0.

By the end of Phase 7, the feature is production-ready: tested on both SQLite and PostgreSQL, with the legacy `tickLegacy` path removed, and a recommended retention policy in place.

## Objectives

- Add comprehensive unit + integration tests for the new code
- Verify zero regressions in the existing Pulse flow
- Remove the `tickLegacy` fallback from `SchedulerService`
- Remove the now-unused `pulses/utils.ts` re-exports
- Add a history retention policy (recommended default; not enforced in v1)
- Run a 24-hour soak test with a high-frequency recurring task
- Document any known limitations or follow-up work

## Success criteria

- All new tests pass
- All existing tests pass
- The Pulse flow is regression-tested with at least 5 end-to-end scenarios
- The recurring task flow is regression-tested with at least 10 end-to-end scenarios
- The legacy `tickLegacy` code path is removed
- A migration guide for the legacy `executeJob` branch is written (in case future work needs to add a third kind)
- The 24-hour soak test runs without errors

---

## Implementation tasks

### 1. Add unit tests for the scheduling refactor

**Update: `apps/server/src/scheduler/service.test.ts`**

- Scheduler dispatches to the first runnable that claims an item
- Scheduler calls reschedule on success
- Scheduler calls reschedule on failure
- Scheduler does not call reschedule when no runnable claims anything
- Multiple runnables registered: each gets a turn per tick
- Order of runnables is registration order (deterministic)

### 2. Add integration tests for `PulseRunnableAdapter`

**New file: `apps/server/src/scheduler/pulse-runnable.integration.test.ts`**

- A scheduled pulse with `every: '1m'` fires within 65 seconds
- A session-attached pulse writes to the pinned session
- An isolated pulse creates a new session per run
- A one-shot pulse transitions to `completed` after firing
- A pulse with `maxRetries: 0` does not retry on failure
- A pulse that exhausts retries transitions to `failed`

### 3. Add unit tests for `TaskScheduleExecutor`

Already covered in Phase 2, but expand coverage:

- Executor handles a task with `replanPolicy: 'never'` and no subtasks (skips planning, runs description)
- Executor handles a task with `replanPolicy: 'never'` and existing subtasks (executes them, no cleanup)
- Executor **re-plans on every run when `replanPolicy = 'always'`**, regardless of whether the description has changed
- Executor **re-plans only when the description hash has changed** when `replanPolicy = 'on-description-change'`
- Executor handles missing planning service gracefully (falls back to description)
- Executor handles task deletion mid-execution (catches and records error)
- Executor handles schedule deletion mid-execution
- **Executor reuses the same `task_agents` on every run** (regression: previous spec had `taskAssignedAgents: []` which would silently run with no agent)
- **Executor falls back to the default agent when the task has no explicit `task_agents` row**
- Executor uses the primary assigned agent when running the description as a single message (no-subtasks path)
- **Default `maxExecutions` is 9999** when not specified
- `maxExecutions: 0` is rejected by the service layer with a `400`-like error

### 4. Add integration tests for `TaskScheduleService`

**New file: `apps/server/src/tasks/schedule-service.integration.test.ts`**

- `createSchedule` rejects when a schedule already exists
- `createSchedule` parses and stores cron expressions correctly
- `createSchedule` parses and stores one-shot schedules correctly
- `updateSchedule` recomputes nextRunAt when the schedule changes
- `pauseSchedule` + `resumeSchedule` transitions work
- `removeSchedule` deletes the schedule row
- `triggerNow` creates a history row
- `listExecutions` paginates and filters
- `updateSchedule` rejects `maxExecutions` ≤ 0 with `schedule.invalid_max_executions`

### 5. Add API integration tests

**Update: `apps/server/src/routes/tasks.test.ts`** (or new file)

For each new endpoint:

- `POST /api/tasks` with `schedule` field
- `POST /api/tasks` without `schedule` (backward compat)
- `GET /api/tasks/:id/schedule`
- `PATCH /api/tasks/:id/schedule` (add, update, remove)
- `POST /api/tasks/:id/schedule/pause`
- `POST /api/tasks/:id/schedule/resume`
- `DELETE /api/tasks/:id/schedule`
- `GET /api/tasks/:id/executions`
- `POST /api/tasks/:id/trigger` on a recurring task
- Auth: all endpoints reject unauthenticated requests

### 6. Add tool tests

**Update: `apps/server/src/tools/tasks/tools.test.ts`**

- `tasks_pause_schedule` calls the service
- `tasks_resume_schedule` calls the service
- `tasks_trigger_now` calls the executor
- `tasks_list_executions` paginates
- `tasks_create` with `schedule` forwards to the service
- `tasks_create` without `schedule` is backward compatible
- `tasks_update` with `schedule: null` removes the schedule
- `tasks_update` with `schedule: {...}` updates the schedule

### 7. Add frontend tests

**Update: `apps/web/src/components/tasks/TaskCard.test.tsx`**

- Shows the recurring badge when a schedule is attached
- Hides the badge when no schedule
- Shows the paused indicator when status is 'paused'

**New file: `apps/web/src/components/tasks/TaskScheduleTab.test.tsx`**

- Renders empty state when no schedule
- Renders schedule info when present
- Calls save on submit
- Calls remove on remove
- Calls pause on pause
- Calls run-now on trigger

**New file: `apps/web/src/components/pages/TaskExecutionsPage.test.tsx`**

- Renders the executions table
- Paginates correctly
- Filters by status
- Links to the session

### 8. Cross-database validation

Run the full test suite against both backends:

```bash
# SQLite (default)
pnpm test

# PostgreSQL (requires a running instance)
DATABASE_URL=postgres://localhost:5432/openaidy_test DB_KIND=postgres pnpm test
```

Fix any SQL that doesn't translate (e.g. `json_extract` syntax differences).

### 9. 24-hour soak test

Create a manual test script (`scripts/soak-test-recurring-tasks.sh`):

```bash
#!/bin/bash
set -e

# Start the server with the feature flag on
RECURRING_TASKS_ENABLED=true pnpm dev:server &

# Wait for server to be ready
until curl -s http://localhost:3001/api/health; do sleep 1; done

# Create a task with a 1-minute schedule
TASK_ID=$(curl -s -X POST http://localhost:3001/api/tasks \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"title":"Soak test","description":"Recurring test task","schedule":{"every":"1m"}}' \
  | jq -r '.id')

echo "Created task $TASK_ID with 1-minute schedule"
echo "Soak test running for 24 hours..."

# Wait 24 hours, then check that ~1440 history rows exist
sleep 86400

COUNT=$(curl -s "http://localhost:3001/api/tasks/$TASK_ID/executions?limit=1" \
  -H "Authorization: Bearer $TOKEN" \
  | jq -r '.total')

echo "Total executions: $COUNT"
if [ "$COUNT" -lt 1400 ] || [ "$COUNT" -gt 1480 ]; then
  echo "FAIL: expected ~1440 executions, got $COUNT"
  exit 1
fi

echo "PASS"
```

The soak test runs as a CI nightly job. Document expected failure modes (server restart causes missed runs by design — count is allowed to be slightly below 1440).

### 10. Remove legacy code paths

**Update: `apps/server/src/scheduler/service.ts`**

Remove `tickLegacy`. The new `tick()` only iterates registered runnables. If no runnables are registered, the scheduler does nothing (which is correct — the system has no work to do).

```ts
async tick(): Promise<boolean> {
  if (!this.isRunning) return false;
  this.tickInProgress = true;
  try {
    for (const runnable of this.runnables.values()) {
      const claimed = await runnable.claimNextDue();
      if (!claimed) continue;
      // ... existing logic ...
      return true;
    }
    return false; // nothing to do
  } catch (error) {
    this.logger.error({ error }, 'Scheduler tick failed');
    return false;
  } finally {
    this.tickInProgress = false;
  }
}
```

**Update: `apps/server/src/scheduler/pulse-runnable.ts`**

`PulseRunnableAdapter.execute()` no longer delegates to the legacy `executeJob`. The adapter is self-contained.

**Update: `apps/server/src/scheduler/service.ts`**

`executeJob` is removed entirely. The Pulse adapter has its own execution logic.

**Update: `apps/server/src/pulses/utils.ts`**

Remove the deprecated `parseScheduleInput` re-export. The canonical location is `apps/server/src/scheduler/schedule-input.ts`. Update all callers to import from the new location.

### 11. Add history retention

**New file: `apps/server/src/tasks/schedule-retention.ts`**

A periodic cleanup task that archives or deletes old history rows:

```ts
import type { TaskExecutionHistoryRepository } from '@openaidy/db';

const DEFAULT_RETENTION = 1000; // keep 1000 rows per task

export async function pruneExecutionHistory(
  repo: TaskExecutionHistoryRepository,
  retentionPerTask: number = DEFAULT_RETENTION,
): Promise<{ deleted: number }> {
  // Find tasks with more than retentionPerTask rows
  // Delete the oldest excess rows
  // ...
}
```

Wire the prune into the existing `taskService.checkStuckSubtasks` interval (runs every 5 minutes). Add a config knob `TASK_HISTORY_RETENTION` (default: 1000).

### 12. Add observability

The existing logger calls in `SchedulerService` are sufficient for v1. Add a couple of metrics hooks for future Prometheus integration:

```ts
// In SchedulerService.registerRunnable:
this.logger.info({ kind: runnable.kind }, 'ScheduledRunnable registered');
this.runnables.set(runnable.kind, runnable);
```

Optional: add a `runnables` getter for an admin endpoint to inspect what's registered.

### 13. Migration guide for future kinds

**New file: `docs/recurring-tasks/adding-a-new-scheduled-kind.md`**

A short guide for future contributors who want to add a third kind of scheduled work (e.g. recurring memory cleanup):

1. Implement the `ScheduledRunnable<TPayload>` interface
2. Add a repository for your state (or reuse an existing one)
3. Register the runnable with the scheduler in `app.ts`
4. Add a route file (if HTTP exposure is needed)
5. Add a tool (if agent exposure is needed)
6. Add tests

Include the existing `TaskScheduleExecutor` and `PulseRunnableAdapter` as reference implementations.

### 14. Known limitations document

**New file: `docs/recurring-tasks/known-limitations.md`**

Document what the v1 does NOT do:

- No `replanPolicy: 'subtask-only'` (always reuse or replan; subtask-only mode was renamed to `replanPolicy: 'never'` with the cheap path)
- No timezone-aware cron (uses UTC)
- No backfill for missed runs (server downtime = missed runs)
- No conditional execution (e.g. "only run if previous run failed")
- No multi-server distributed locking (single-server trust)
- No per-subtask recurrence
- History table grows unbounded; retention is configurable but not enforced by default
- **No "infinite" `maxExecutions`**. Every recurring task must declare a finite cap. Default is 9999, set explicitly via `maxExecutions` if you need more. After the cap is reached, the schedule auto-transitions to `expired` and stops firing.
- **Re-planning is opt-in, not automatic.** The default `replanPolicy: 'never'` reuses the existing subtasks across runs (cheap). To re-plan on every run, set `replanPolicy: 'always'`. To re-plan only when the description changes, set `replanPolicy: 'on-description-change'`. The previous behaviour of re-planning on every run by default was changed for performance — see the Re-planning behaviour section in the spec.

### 15. Update the `docs/recurring-tasks/README.md`

Reflect the completed state. Add a "Status: v1 shipped" note at the top. Update the link list to include the new `known-limitations.md` and `adding-a-new-scheduled-kind.md`.

---

## Rollout

Phase 7 is the final phase. It's the polish + verification step.

Rollout steps:

1. Run the full test suite on both backends
2. Run the 24-hour soak test in staging
3. Run a manual user-acceptance test with a real recurring task
4. Remove the feature flag (`RECURRING_TASKS_ENABLED`) — feature is now on by default
5. Deploy to production
6. Monitor for 1 week

## Risk assessment

| Risk                                                 | Mitigation                                                                       |
| ---------------------------------------------------- | -------------------------------------------------------------------------------- |
| Removing `tickLegacy` breaks some hidden integration | The 24-hour soak test exercises the full path                                    |
| Retention policy accidentally deletes important data | Default retention is 1000 rows per task; configurable; never deletes recent rows |
| Cross-database SQL breaks production                 | Both backends tested in CI; `json_extract` validated on both                     |
| Soak test flakes cause false alarms                  | Allow ±2% tolerance in the count check; treat any error log as a failure         |
