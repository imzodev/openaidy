# Adding a new scheduled kind

This guide walks you through the changes required to add a new
"scheduled kind" — that is, a new domain that wants to be driven by
the central scheduler.

> **What is a "scheduled kind"?** Anything that has a database table
> holding rows with a `nextRunAt`/`status` shape and needs to be
> claimed and executed on a recurring basis. Examples today: the
> legacy `pulse` rows in `scheduled_jobs` and the recurring `task`
> rows in `task_schedules`. After Phase 7, the central
> `SchedulerService` is the single polling loop that drives both.

## The `ScheduledRunnable` contract

Every scheduled kind implements the `ScheduledRunnable` interface
defined in `packages/runtime/src/scheduling.ts`:

```ts
export interface ScheduledRunnable<P = unknown> {
  readonly kind: string; // unique kind identifier
  claimNextDue(): Promise<ClaimedItem<P> | null>;
  execute(id: string, payload: P): Promise<ExecutionResult>;
  reschedule(
    id: string,
    payload: P,
    result: ExecutionResult,
  ): Promise<Date | null>;
}

export type ClaimedItem<P> = { id: string; payload: P };
export type ExecutionResult =
  | { ok: true; durationMs: number }
  | { ok: false; error: { code: string; message: string } };
```

**Constraints** (these are the contract — break them and the
scheduler will misbehave):

1. **`kind` must be globally unique** within a process. The
   `SchedulerService.registerRunnable()` call will throw if you
   register a duplicate.
2. **`claimNextDue` must be idempotent** — if the same row is
   claimed by two processes (or two ticks of the same process), only
   one must succeed. The Drizzle helpers in `task_schedules` and
   `scheduled_jobs` repositories already do this with
   `update().where(status='active')` and a `returning()` check.
3. **`execute` must NOT modify the schedule row** — that's
   `reschedule`'s job. The executor just performs the work and
   returns a result. This separation matters for crash recovery: if
   the process dies after `execute` but before `reschedule`, the
   schedule row's `nextRunAt` is still the old value, and the next
   tick will re-run it. That's the intended behaviour.
4. **`reschedule` MUST be called by the scheduler, not by the
   executor** — even if `execute` throws. The scheduler's
   `runRunnable` catches throws and synthesises a failure result
   that is then handed to `reschedule`.
5. **`reschedule` may return `null`** — that means "terminal" (the
   schedule should not run again). For one-shots, the executor
   returns `null` after the first execution. For recurring, it
   returns the next `Date` or `null` if `executionCount` has
   reached `maxExecutions`.
6. **`reschedule` may throw** — the scheduler catches the throw,
   logs it, and moves on. Don't worry about wrapping your `reschedule`
   in defensive try/catch; the scheduler has you covered.

## Steps to add a new kind

### 1. Define the data model

Add a new table to `packages/db/src/schema/` and a new repository
to `packages/db/src/repositories/`. Follow the existing pattern in
`task-schedules.ts`:

- `status: 'active' | 'paused' | 'expired'`
- `nextRunAt: Date` (NOT NULL; for "terminal" rows use `now()`,
  see `task-schedule-executor.ts:418`)
- `lastRunAt: Date | null`
- `executionCount: integer` (default 0)
- `maxExecutions: integer` (default 9999 — see design note below)
- `id: uuid` primary key
- `createdAt` / `updatedAt` timestamps

### 2. Implement the `ScheduledRunnable` contract

Create a new class in `apps/server/src/<your-kind>/executor.ts`:

```ts
import type { ScheduledRunnable, ExecutionResult } from '@openaidy/runtime';

export type MyKindPayload = {
  // Whatever data your executor needs to run. Cache it in
  // claimNextDue so execute() doesn't re-read the DB.
  schedule: MyKindRow;
  // ...other cached fields
};

export class MyKindExecutor implements ScheduledRunnable<MyKindPayload> {
  readonly kind = 'my-kind';

  constructor(
    private readonly deps: {
      myKindRepo: MyKindStore;
      myExecutionRepo: MyExecutionStore;
      // ...session service, planning service, etc.
    },
  ) {}

  async claimNextDue(): Promise<ClaimedItem<MyKindPayload> | null> {
    const row = await this.deps.myKindRepo.claimNextDue();
    if (!row) return null;
    return {
      id: row.id,
      payload: {
        schedule: row,
        // ...other cached fields (e.g. task data, agents)
      },
    };
  }

  async execute(id: string, payload: MyKindPayload): Promise<ExecutionResult> {
    const start = Date.now();
    try {
      // ...do the work
      return { ok: true, durationMs: Date.now() - start };
    } catch (err) {
      return {
        ok: false,
        error: { code: 'EXECUTION_ERROR', message: String(err) },
      };
    }
  }

  async reschedule(
    id: string,
    payload: MyKindPayload,
    result: ExecutionResult,
  ): Promise<Date | null> {
    const { schedule } = payload;
    const newCount = schedule.executionCount + 1;

    // Determine if the schedule should terminate.
    if (newCount >= schedule.maxExecutions) {
      await this.deps.myKindRepo.update(id, {
        nextRunAt: new Date(),
        lastRunAt: new Date(),
        status: 'expired',
        executionCount: newCount,
      });
      return null;
    }

    // Otherwise compute the next run.
    const next = this.deps.calculateNextRun(schedule);
    await this.deps.myKindRepo.update(id, {
      nextRunAt: next,
      lastRunAt: new Date(),
      status: 'active',
      executionCount: newCount,
    });
    return next;
  }
}
```

### 3. Wire it into the central scheduler

In `apps/server/src/app.ts`, after both the scheduler and your
executor are constructed, register the runnable:

```ts
const myExecutor = new MyKindExecutor({ ... });
scheduler.registerRunnable(myExecutor);
```

The `SchedulerService.tick()` will now consider your executor on
every poll (every 5s by default). The first runnable to claim an
item wins for that tick.

### 4. (Optional) Subscribe to run events

If your executor creates sessions that emit `RunEventEmitter`
events (every modern session does), and you need to clean up
post-run state, subscribe a listener the same way the recurring
tasks feature does:

```ts
const myListener = createMyKindRunListener({
  myKindRepo: dbAdapter.repositories.myKind,
  myExecutionRepo: dbAdapter.repositories.myExecution,
  executor: myExecutor,
  runEvents: services.runEvents,
  getSessionType: async (sessionId) => {
    const session = await dbAdapter!.repositories.sessions.findById(sessionId);
    return session && 'type' in session
      ? (session as { type?: string }).type
      : null;
  },
  logger: log,
});
myListener.start(); // subscribes to runEvents
```

The `RecurringTasksService` (now a listener-only service after
Phase 7) is the reference implementation — see
`apps/server/src/recurring/service.ts`.

### 5. Add unit + integration tests

Required:

- **Unit tests** for the executor's `claimNextDue`, `execute`,
  and `reschedule` paths. Use the same `makeHarness` pattern as
  `task-schedule-executor.test.ts`.
- **Integration tests** with a real SQLite database that drive
  the full scheduler tick → claim → execute → reschedule cycle.
  See `scheduler/scheduler.integration.test.ts`.

Recommended:

- **API tests** for the HTTP routes that mutate your schedule rows.
- **Tool tests** if you expose agent tools for your kind.

### 6. Add a DTO + frontend surface

If your kind is user-facing, you'll want:

- A `toDto()` function in `apps/server/src/<your-kind>/dto.ts`
  that maps the DB row to a public DTO. Put the DTO in
  `packages/shared-types/src/`.
- A component or page in the web app for surfacing the schedule.
  Reuse `ScheduleDisplay` and `ScheduleEditor` if applicable.

## Design notes

### Why `maxExecutions: 9999` by default?

The user's design preference is to default to "practically
infinite" rather than a small finite number. A default of `20`
would force the user to think about the cap on every task, which
they don't want. `9999` is a sentinel that means "effectively
unbounded" without the schema cost of a nullable column. When
adding your new kind, **use the same default**.

### Why a centralised `SchedulerService`?

Before Phase 7, the recurring-tasks feature had its own
`setInterval` polling loop running in parallel to the
`SchedulerService` (which only handled the legacy `pulse` path).
This made observability harder (two ticks to instrument), made
back-pressure unclear (what if both loops try to claim something
at the same time?), and duplicated code. The centralised loop
with the `ScheduledRunnable` registry solves all three.

### Why don't we migrate `pulse` to the registry?

Because pulses have a different shape: they target a
`SessionMessageService` directly, not an executor, and their
payload is the session message itself, not a schedule. Migrating
them would require wrapping the session service in a
`ScheduledRunnable` adapter. That's a Phase 7+ stretch — see
`known-limitations.md` for the full list of what's deferred.

## Reference implementations

- **`TaskScheduleExecutor`** (the canonical example):
  `apps/server/src/tasks/execution/task-schedule-executor.ts`
- **`RecurringTasksService`** (the canonical listener):
  `apps/server/src/recurring/service.ts`
- **Scheduler with the registry**:
  `apps/server/src/scheduler/service.ts`

Read these three files end-to-end before adding your own kind.
The patterns are well-commented and the test files
(`*.test.ts` next to each) demonstrate the contract.
