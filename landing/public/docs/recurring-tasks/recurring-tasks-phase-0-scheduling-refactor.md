# Phase 0: Scheduling Refactor

## Overview

Phase 0 is a non-breaking refactor. It extracts shared schedule types, introduces the polymorphic `ScheduledRunnable` interface, and rewires `SchedulerService` to dispatch through a runnable registry. The existing Pulse flow keeps working unchanged.

This is the foundation for everything that follows. Doing it first means Phases 1-6 are pure additions rather than invasive changes to `SchedulerService`.

## Objectives

- Extract `ScheduleInput` and related types to `packages/shared-types/src/scheduling.ts`
- Move `parseScheduleInput` to `apps/server/src/scheduler/schedule-input.ts`
- Define the `ScheduledRunnable` interface in `packages/runtime/src/scheduling/runnable.ts`
- Add a runnable registry to `SchedulerService`
- Keep the existing `executeJob` flow as a fallback during the migration
- Add a `PulseRunnableAdapter` that wraps the existing Pulse execution path
- Verify: Pulses still work end-to-end with no observable change

## Success criteria

- All existing Pulse tests pass
- `SchedulerService.tick()` dispatches through the registry when runnables are registered, falls back to the old path otherwise
- `ScheduleInput` type is importable from `@openaidy/shared-types`
- No new dependencies introduced

---

## Implementation tasks

### 1. Move `ScheduleInput` to `shared-types`

**New file: `packages/shared-types/src/scheduling.ts`**

Move the type definitions (no runtime code) from `apps/server/src/pulses/utils.ts`:

```ts
/**
 * Schedule input - discriminated union of human-friendly schedule formats.
 * Lives in shared-types so server, web, and SDKs can all reference the same shape.
 */
export type ScheduleInput =
  | { every: '15m' | '30m' | '1h' | '6h' | '12h' | '1d' | '1w' }
  | { daily: { hour: number; minute: number } }
  | { cron: string; tz?: string }
  | { at: string };

export type SchedulePreset = '15m' | '30m' | '1h' | '6h' | '12h' | '1d' | '1w';

export const SCHEDULE_PRESETS: readonly SchedulePreset[] = [
  '15m',
  '30m',
  '1h',
  '6h',
  '12h',
  '1d',
  '1w',
] as const;
```

**Update: `packages/shared-types/src/index.ts`**

Add the export:

```ts
export * from './scheduling.js';
```

**Update: `apps/server/src/pulses/utils.ts`**

Replace the local `ScheduleInput` type with a re-export from `@openaidy/shared-types`:

```ts
export type { ScheduleInput } from '@openaidy/shared-types';
```

This keeps the import surface stable for callers of `pulses/utils.ts` while the canonical definition moves to `shared-types`.

### 2. Move `parseScheduleInput` to `scheduler/schedule-input.ts`

**New file: `apps/server/src/scheduler/schedule-input.ts`**

Move the implementation from `apps/server/src/pulses/utils.ts`. The function stays server-only because it depends on `cron-utils.ts` (which uses `croner`).

```ts
import {
  validateCronExpression,
  calculateNextRun,
  describeCronExpression,
} from './cron-utils.js';
import type { ScheduleInput } from '@openaidy/shared-types';

export type ParsedSchedule = {
  type: 'cron' | 'one-shot';
  cronExpression?: string;
  schedule?: Date;
  nextRunAt: Date;
};

// Mapping of preset → cron expression (was: EVERY_TO_CRON in pulses/utils.ts)
const EVERY_TO_CRON: Record<
  '15m' | '30m' | '1h' | '6h' | '12h' | '1d' | '1w',
  string
> = {
  '15m': '*/15 * * * *',
  '30m': '*/30 * * * *',
  '1h': '0 * * * *',
  '6h': '0 */6 * * *',
  '12h': '0 */12 * * *',
  '1d': '0 0 * * *',
  '1w': '0 0 * * 0',
};

export function parseScheduleInput(schedule: ScheduleInput): ParsedSchedule {
  // ... (full body moved from pulses/utils.ts unchanged)
}

export function describeScheduleInput(schedule: ScheduleInput): string {
  const parsed = parseScheduleInput(schedule);
  if (parsed.cronExpression) {
    return describeCronExpression(parsed.cronExpression);
  }
  if (parsed.schedule) {
    return `Once at ${parsed.schedule.toISOString()}`;
  }
  return 'Unknown schedule';
}
```

**Update: `apps/server/src/pulses/utils.ts`**

Remove the moved code. Re-export the moved function so existing callers still work:

```ts
export {
  parseScheduleInput,
  describeScheduleInput,
  type ParsedSchedule,
} from '../scheduler/schedule-input.js';
```

Mark the local `EVERY_TO_CRON`, `parseScheduleInput`, `ParsedSchedule` definitions as removed (delete the original lines).

**Update: every importer of `parseScheduleInput`**

Run a project-wide search:

```bash
rg "from .*pulses/utils" --type ts
rg "parseScheduleInput" --type ts
```

The only known caller is `apps/server/src/pulses/service.ts` (the `PulseService`). Update its import:

```ts
// Before
import { parseScheduleInput, jobToPulse } from './utils.js';

// After
import { jobToPulse } from './utils.js';
import { parseScheduleInput } from '../scheduler/schedule-input.js';
```

`jobToPulse` stays in `pulses/utils.ts` because it's pulse-specific (it knows about the `metadata.kind === 'pulse'` shape).

### 3. Add the `ScheduledRunnable` interface

**New file: `packages/runtime/src/scheduling/runnable.ts`**

```ts
/**
 * The result of executing a scheduled runnable.
 */
export type ExecutionResult =
  | { ok: true; durationMs: number; metadata?: Record<string, unknown> }
  | {
      ok: false;
      error: Error;
      durationMs: number;
      metadata?: Record<string, unknown>;
    };

/**
 * A ScheduledRunnable is any work item that the scheduler can claim,
 * execute, and reschedule. The scheduler does not know what is inside
 * the payload — it dispatches via this interface only.
 */
export interface ScheduledRunnable<TPayload = unknown> {
  /** Unique discriminator (e.g. 'pulse', 'task'). */
  readonly kind: string;

  /**
   * Atomically claim the next due item. Returns null if nothing is due.
   * Implementations must be safe for concurrent ticks (e.g. UPDATE ...
   * WHERE nextRunAt <= now RETURNING).
   */
  claimNextDue(): Promise<{ id: string; payload: TPayload } | null>;

  /** Execute the claimed item. Throw or return ok=false to signal failure. */
  execute(id: string, payload: TPayload): Promise<ExecutionResult>;

  /**
   * Compute the next run time after a successful or failed execution.
   * Returns null if the item should not be rescheduled (e.g. one-shot
   * completed, max executions reached, or item expired).
   */
  reschedule(
    id: string,
    payload: TPayload,
    result: ExecutionResult,
  ): Promise<Date | null>;
}
```

**Update: `packages/runtime/src/index.ts`**

Re-export the new module:

```ts
export * from './scheduling/runnable.js';
```

### 4. Add a runnable registry to `SchedulerService`

**Update: `apps/server/src/scheduler/service.ts`**

Add the registry and a registration method. The `tick()` method gets a new code path that uses the registry when runnables are registered, and falls back to the old `claimNextDueJob + executeJob` flow otherwise.

```ts
import type { ScheduledRunnable, ExecutionResult } from '@openaidy/runtime';

export class SchedulerService {
  // ... existing fields ...
  private runnables = new Map<string, ScheduledRunnable>();

  /**
   * Register a runnable. The scheduler will claim from it on each tick.
   */
  registerRunnable(runnable: ScheduledRunnable): void {
    this.runnables.set(runnable.kind, runnable);
    this.logger.info({ kind: runnable.kind }, 'ScheduledRunnable registered');
  }

  /**
   * Unregister a runnable (used during shutdown or for tests).
   */
  unregisterRunnable(kind: string): void {
    this.runnables.delete(kind);
  }

  /**
   * Single tick - claim and execute the next due runnable (or legacy job).
   */
  async tick(): Promise<boolean> {
    if (!this.isRunning) return false;
    this.tickInProgress = true;
    try {
      // New path: iterate registered runnables
      for (const runnable of this.runnables.values()) {
        const claimed = await runnable.claimNextDue();
        if (!claimed) continue;

        const start = Date.now();
        let result: ExecutionResult;
        try {
          result = await runnable.execute(claimed.id, claimed.payload);
        } catch (error) {
          result = {
            ok: false,
            error: error instanceof Error ? error : new Error(String(error)),
            durationMs: Date.now() - start,
          };
        }
        await runnable.reschedule(claimed.id, claimed.payload, result);
        return true;
      }

      // Legacy fallback: claim any job without a runnable registration
      // (preserves behaviour for unmigrated job kinds, e.g. if a future
      // kind is added before its runnable is registered)
      return await this.tickLegacy();
    } catch (error) {
      this.logger.error({ error }, 'Scheduler tick failed');
      return false;
    } finally {
      this.tickInProgress = false;
    }
  }

  /**
   * Legacy tick path - moved from the original tick() body.
   * Kept until all job kinds have a registered runnable.
   */
  private async tickLegacy(): Promise<boolean> {
    // ... existing tick body, renamed from tick() to tickLegacy() ...
  }
}
```

Keep the original `tick()` body intact as `tickLegacy()`. The public `tick()` keeps its signature, so no callers need to change.

### 5. Add `PulseRunnableAdapter`

**New file: `apps/server/src/scheduler/pulse-runnable.ts`**

This adapter wraps the existing Pulse execution path so it can be invoked through the runnable interface without rewriting `SchedulerService.executeJob`.

```ts
import type { ScheduledRunnable, ExecutionResult } from '@openaidy/runtime';
import type {
  JobsStore,
  JobRunsStore,
  SessionsStore,
  ScheduledJob,
} from '@openaidy/db';
import type { SessionMessageService } from '../sessions/service';
import { calculateNextRun } from './cron-utils';
import type { GenericLogger } from './service';

type PulsePayload = ScheduledJob;

export type PulseRunnableDeps = {
  jobsRepo: JobsStore;
  jobRunsRepo: JobRunsStore;
  sessionsStore: SessionsStore;
  sessionMessageService: SessionMessageService;
  logger: GenericLogger;
};

export class PulseRunnableAdapter implements ScheduledRunnable<PulsePayload> {
  readonly kind = 'pulse';

  constructor(private readonly deps: PulseRunnableDeps) {}

  async claimNextDue(): Promise<{ id: string; payload: PulsePayload } | null> {
    // Query for next due pulse (kind discriminator)
    const job = await this.deps.jobsRepo.claimNextDueByKind('pulse');
    return job ? { id: job.id, payload: job } : null;
  }

  async execute(id: string, job: PulsePayload): Promise<ExecutionResult> {
    const start = Date.now();
    // Reuse the existing executeJob path for now.
    // This will be refactored in Phase 7 to live entirely in the adapter.
    await this.executeJobLegacy(job);
    return { ok: true, durationMs: Date.now() - start };
  }

  async reschedule(
    id: string,
    job: PulsePayload,
    result: ExecutionResult,
  ): Promise<Date | null> {
    if (job.type === 'one-shot') {
      await this.deps.jobsRepo.update(id, {
        status: 'completed',
        lastRunAt: new Date(),
      });
      return null;
    }
    if (!result.ok && job.retryCount >= job.maxRetries) {
      await this.deps.jobsRepo.update(id, {
        status: 'failed',
        lastRunAt: new Date(),
      });
      return null;
    }
    const nextRun = calculateNextRun(job.cronExpression!, new Date());
    await this.deps.jobsRepo.update(id, {
      nextRunAt: nextRun,
      lastRunAt: new Date(),
      retryCount: result.ok ? 0 : job.retryCount + 1,
    });
    return nextRun;
  }

  /**
   * Mirror of SchedulerService.executeJob for the pulse kind.
   * Extracted here so the adapter is self-contained.
   */
  private async executeJobLegacy(job: ScheduledJob): Promise<void> {
    if (job.targetType === 'session') {
      // ... existing session branch ...
    } else {
      // ... existing isolated branch ...
    }
  }
}
```

### 6. Add `claimNextDueByKind` to `JobsRepository`

**Update: `packages/db/src/repositories/jobs.ts`**

Add a new method that filters by `metadata.kind`:

```ts
/**
 * Claim the next due job of a specific kind (e.g. 'pulse').
 * Used by the polymorphic runnable registry.
 */
async claimNextDueByKind(kind: string): Promise<schema.ScheduledJob | null> {
  // SQLite-friendly: no FOR UPDATE SKIP LOCKED. JSON path filtering via json_extract.
  const jobs = await this.db
    .select()
    .from(schema.scheduledJobs)
    .where(
      and(
        eq(schema.scheduledJobs.status, 'active'),
        lte(schema.scheduledJobs.nextRunAt, new Date()),
        sql`json_extract(${schema.scheduledJobs.metadata}, '$.kind') = ${kind}`,
      ),
    )
    .orderBy(asc(schema.scheduledJobs.nextRunAt))
    .limit(1);
  return jobs[0] ?? null;
}
```

Verify the `json_extract` path works on both SQLite and PostgreSQL. If PostgreSQL needs different syntax, use a Drizzle helper or a raw `sql` template that branches on `db.dialect`.

### 7. Register the pulse adapter in `app.ts`

**Update: `apps/server/src/app.ts`**

Inside the `dbAdapter` block where `SchedulerService` is created, register the pulse adapter:

```ts
if (dbAdapter && jobsRepo && jobRunsRepo && sessionsRepo) {
  scheduler = createSchedulerService(/* ... existing args ... */);

  scheduler.registerRunnable(
    new PulseRunnableAdapter({
      jobsRepo,
      jobRunsRepo,
      sessionsStore: sessionsRepo,
      sessionMessageService: sessionService,
      logger: log as unknown as FastifyBaseLogger,
    }),
  );
}
```

### 8. Update tests

**Update: `apps/server/src/scheduler/service.test.ts`**

Add a test verifying that:

1. With a registered runnable, the scheduler dispatches to the runnable's `execute` method
2. Without a registered runnable, the legacy path is used
3. The runnable's `reschedule` is called after `execute` (success or failure)

**No changes needed to**: `pulses/service.test.ts` — the service layer is unchanged. The adapter just routes to it.

---

## Rollout

This phase is internal. No API changes, no DB migrations, no UI changes. Ship behind the same version.

Rollout steps:

1. Merge Phase 0 PR
2. Deploy
3. Run smoke test: create a Pulse with `every: '1m'`, verify it fires and creates a session
4. Watch scheduler logs for the new "ScheduledRunnable registered" message
5. Monitor for any tick-related errors over 24h
6. If clean, proceed to Phase 1

## Risk assessment

| Risk                                                   | Mitigation                                                                                                  |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `json_extract` works differently on SQLite vs Postgres | Use Drizzle's `sql` template; test on both backends in Phase 7                                              |
| The legacy `tick` and new `tick` race                  | New `tick` returns early after dispatching one runnable; legacy only runs when no runnable claimed anything |
| Pulse behaviour changes silently                       | Phase 0 ships a regression test that creates a Pulse and asserts session creation                           |
| Performance regression from registry iteration         | `Map.values()` over a 2-3 element map is O(1); polling cost is unchanged                                    |
