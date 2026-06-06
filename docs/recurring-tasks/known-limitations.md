# Recurring Tasks — Known Limitations

This document tracks what the recurring-tasks feature (Phases 0–7)
intentionally does NOT do, and what is deferred to a future phase.

> **Why document these?** Because the spec calls for many
> cross-database, soak-test, and retention behaviours that the
> current implementation doesn't provide. The team should be
> able to look here and understand which of those are real gaps
> vs. conscious trade-offs.

## Deferred to future phases

### 1. Pulse migration to the `ScheduledRunnable` registry

**Status**: Deferred.

Pulses still use the legacy `SchedulerService.executeJob()` path
(`scheduled_jobs` table). After Phase 7, the
`SchedulerService.tick()` calls each registered `ScheduledRunnable`
in order; if a runnable claims an item, the legacy path is
skipped. But **pulses are not registered** as a runnable, so they
continue to use the legacy code path unchanged.

To migrate, we'd need a `PulseRunnableAdapter` that wraps the
session-message dispatch logic into the `ScheduledRunnable`
contract (claim → execute → reschedule). The legacy path would
then become a no-op fallback (the `claimNextDueJob` would always
return `null` because all real work is being driven by the
registry).

Estimated effort: 2-3 hours, mostly translation of
`executeJob`'s target-type switching into a clean
`ScheduledRunnable.execute` implementation.

### 2. Cross-database tests (Postgres, MySQL)

**Status**: Deferred.

The integration tests added in Phase 7 use a real **SQLite**
database. The repository implementations in
`packages/db/src/repositories/` are designed to be portable across
SQLite/Postgres/MySQL via Drizzle, but we have not yet run the
test suite against the other two backends.

**What to do**:

- Set up test containers (or local instances) for Postgres 15+
  and MySQL 8.0+.
- Add `test:integration:postgres` and `test:integration:mysql`
  scripts in `package.json`.
- Run the existing integration tests against each and fix any
  dialect-specific issues (date functions, boolean handling, etc.).

The current SQLite tests should be portable. Risks to watch for:

- `mode='boolean'` in Drizzle (handled differently per driver).
- `now()` for `nextRunAt` defaults (works in all three, but
  default value binding differs).
- Unique constraints and partial indexes (we use both — see
  `task_schedules` and `task_execution_history` schemas).

### 3. 24-hour soak test

**Status**: Deferred (no real infrastructure in the dev
environment to run it).

The spec calls for a 24-hour soak test that:

- Starts the scheduler with 1000 due schedules at random
  intervals between 1s and 1h.
- Verifies that no schedule is double-claimed, no execution is
  lost, and the system remains responsive.

This requires a long-running containerised environment with
real LLM mocks (because each run is a session). It's a good
**CI gate** but not something we can run on every PR.

**Recommendation**: add the soak test as a nightly job in CI
once the codebase is stable. The test would live in
`apps/server/src/scheduler/soak.test.ts` and would be marked
`test:integration:long` in the npm scripts.

### 4. Retention policy for execution history

**Status**: Deferred.

`task_execution_history` rows accumulate forever. There's no
auto-pruning. For a high-traffic setup (1000 schedules running
hourly for a year = 8.7M rows), this is a real problem.

**What to do**:

- Add a `retentionDays` config (env var: `TASK_HISTORY_RETENTION_DAYS`,
  default: 90).
- Add a background sweep that deletes rows older than the
  retention period. The sweep should run on a separate tick
  (not in the scheduler's main loop) and should batch deletes
  to avoid lock contention.
- Surface a `purge_history` admin tool for explicit cleanup.

Estimated effort: 1-2 days (including the config plumbing and
the sweep scheduler).

### 5. `maxRetries: 0` semantics

**Status**: Implemented but worth noting.

The legacy `scheduled_jobs` rows have a `maxRetries` field. The
integration test `does not retry a job with maxRetries: 0 on
failure` verifies this. **However**, the recurring-tasks executor
(`TaskScheduleExecutor`) doesn't expose `maxRetries` in its
public API. It uses `executionCount` and `maxExecutions` to
determine when a schedule terminates. The behaviour is similar
but not identical:

- Legacy `pulse`: `maxRetries: 0` means "if the run fails, mark
  the schedule `failed` immediately, do not retry."
- Recurring task: a failed run still counts as an execution. If
  `maxExecutions` is high, the next tick will pick it up again.

**Why this matters**: users migrating from pulses to recurring
tasks may be surprised that their old "fail-fast" schedules now
retry on the next tick. Document this in the migration notes.

## Conscious trade-offs (not bugs)

### 1. 5-second polling interval

The `SchedulerService` polls every 5 seconds. This is the
default. The tick interval is configurable via the
`pollIntervalMs` option in the `SchedulerService` constructor
(see `scheduler/scheduler.integration.test.ts` for an example
of using 50ms in tests).

**Why 5s?** It's a balance between:

- **Latency**: how long after `nextRunAt` the schedule actually
  fires. 5s is acceptable for most "every 15m" or "every 1h"
  schedules.
- **DB load**: each tick does an indexed `claimNextDue` query
  (cheap, but not free). 5s keeps the load to ~17 queries/min
  for the recurring-tasks kind alone.

If a user needs sub-second latency, the right answer is not
"decrease the poll interval" (that scales badly) but "use a
push-based scheduler" (out of scope for this feature).

### 2. `scheduleHuman` for non-canonical cron expressions

The `describeCronExpression` utility in
`apps/server/src/scheduler/cron-utils.ts` only knows a handful
of canonical forms:

- `* * * * *` → "Every minute"
- `0 * * * *` → "Every hour"
- `0 0 * * 0` → "Every Sunday at midnight"
- `*/N * * * *` → "Every N minutes"
- `0 */N * * *` → "Every N hours"

Anything else (e.g. `0 9 * * 1-5`, `0 9-17 * * *`) is returned as
the raw cron expression. This is **not a bug** — there's no
perfect mapping from cron to natural language — but it's
worth knowing if you see "0 9 \* \* 1-5" in the UI and wonder
why there's no human description.

**Workaround**: if you want a nicer description, use one of the
presets (`every: '1h'`, etc.) instead of raw cron. The presets
all map to canonical expressions that the describe function
knows.

### 3. Replan-policy: cached task data

The `TaskScheduleExecutor.execute()` uses the task's
description hash and the cached `taskAssignedAgents` from the
claim-time payload. It does NOT re-read the DB on every
execute().

**Why**: avoiding N+1 queries. A schedule that runs 1000 times
should not cause 1000 reads of the `task_agents` table.

**Trade-off**: if a user reassigns agents between the claim and
the execute (a 5-second window at most), the new assignment
won't take effect until the next claim. This is acceptable for
recurring tasks (which run on human time scales) but would be
wrong for high-frequency workloads.

### 4. `maxExecutions: 9999` default

Documented in the migration guide. The user's design
preference: small defaults force the user to think about the
cap on every task. `9999` means "unbounded for any practical
purpose" without the schema cost of nullable.

## What we DO have

For completeness, here is what is fully implemented and tested:

| Capability                                  | Test coverage           |
| ------------------------------------------- | ----------------------- |
| Scheduler central polling loop              | 36 unit + 5 integration |
| `ScheduledRunnable` registry + dispatch     | 8 unit                  |
| Recurring-tasks executor                    | 29 unit + 9 integration |
| `RecurringTasksService` run-event listener  | 14 unit                 |
| Schedule CRUD via API                       | 24 unit                 |
| Schedule CRUD via tools                     | 29 unit                 |
| Frontend `TaskCard` schedule badge          | 8 unit                  |
| Frontend `TaskExecutionsPage`               | 5 unit                  |
| Frontend `ScheduleEditor`                   | 13 unit                 |
| End-to-end schedule (one-shot, cron, retry) | 5 integration           |
| Domain-types re-exports (shared-types)      | n/a (compile-time)      |

If a feature is not in the table above, look for it in the
"Deferred to future phases" section. If it's not there either,
it's an **unknown** — file an issue.
