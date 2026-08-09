# Phase 1: Schema and Repository

## Overview

Phase 1 adds the two new tables (`task_schedules`, `task_execution_history`), the Drizzle schemas, and the repositories. This is pure data layer work — no service logic, no scheduler wiring, no API. The tables are created but nothing writes to them yet.

This phase is reversible (drop the tables) and unblocks Phases 2-3.

## Objectives

- Add Drizzle schemas for `task_schedules` and `task_execution_history`
- Wire the schemas into the existing schema barrel exports
- Generate Drizzle migration SQL
- Create `TaskSchedulesRepository` with the standard CRUD + claim operation
- Create `TaskExecutionHistoryRepository` with paginated queries
- Add shared types for the new tables to `@openaidy/shared-types`
- Add unit tests for both repositories using in-memory or test-DB fixtures

## Success criteria

- `pnpm --filter @openaidy/db generate` produces a valid migration
- The migration applies cleanly to both SQLite and PostgreSQL
- All repository methods pass unit tests
- No existing functionality is affected (no schema changes to existing tables)

---

## Implementation tasks

### 1. Add Drizzle schema for `task_schedules`

**Update: `packages/db/src/schema/tasks.ts`**

Append the new table definition. The file already exports `tasks`, `subtasks`, `taskAgents`. The new table sits alongside them.

```ts
import { sql } from 'drizzle-orm';

/**
 * Task schedule status
 * - active: schedule is enabled and will fire
 * - paused: user has suspended the schedule; will not fire
 * - expired: schedule reached maxExecutions or one-shot ran; terminal state
 */
export const taskScheduleStatusEnum = pgEnum('task_schedule_status', [
  'active',
  'paused',
  'expired',
]);

/**
 * Replan policy enum
 * - never:                  default; reuse existing subtasks across runs (cheap)
 * - on-description-change:  re-invoke planning agent only when description hash differs
 * - always:                 re-invoke planning agent on every run (expensive, opt-in)
 */
export const taskScheduleReplanPolicyEnum = pgEnum(
  'task_schedule_replan_policy',
  ['never', 'on-description-change', 'always'],
);

/**
 * Task schedules table (1:1 with tasks)
 *
 * Attached to a task to make it recurring. The scheduler polls
 * this table via TaskSchedulesRepository.claimNextDue().
 */
export const taskSchedules = pgTable(
  'task_schedules',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => nanoid()),
    taskId: text('task_id')
      .notNull()
      .unique()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    // Schedule definition (exactly one is non-null at the application layer)
    cronExpression: text('cron_expression'),
    preset: text('preset'), // '15m' | '30m' | '1h' | '6h' | '12h' | '1d' | '1w' | null
    scheduleDate: timestamp('schedule_date', { withTimezone: true }),
    // Polling state
    nextRunAt: timestamp('next_run_at', { withTimezone: true }).notNull(),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    status: taskScheduleStatusEnum('status').notNull().default('active'),
    // Execution behaviour
    replanPolicy: taskScheduleReplanPolicyEnum('replan_policy')
      .notNull()
      .default('never'),
    maxExecutions: integer('max_executions').notNull().default(9999), // ALWAYS finite; default 9999
    executionCount: integer('execution_count').notNull().default(0),
    // Description hash for change detection (used by 'on-description-change' policy).
    // NULL until the first run completes.
    descriptionHash: text('description_hash'),
    // Audit
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    nextRunAtIdx: index('task_schedules_next_run_at_idx').on(table.nextRunAt),
    statusIdx: index('task_schedules_status_idx').on(table.status),
    taskIdIdx: index('task_schedules_task_id_idx').on(table.taskId),
  }),
);
```

**Type exports** (append to the existing `export type` block):

```ts
export type TaskSchedule = typeof taskSchedules.$inferSelect;
export type NewTaskSchedule = typeof taskSchedules.$inferInsert;
export type TaskScheduleStatus =
  (typeof taskScheduleStatusEnum.enumValues)[number];
export type ReplanPolicy =
  (typeof taskScheduleReplanPolicyEnum.enumValues)[number];
```

### 2. Add Drizzle schema for `task_execution_history`

**Update: `packages/db/src/schema/tasks.ts`**

```ts
/**
 * Task execution history status
 * - planned: row created, execution not yet started
 * - planning: planning agent is regenerating subtasks
 * - executing: subtask sessions are being created/messaged
 * - verifying: follow-up agent verifying each subtask
 * - completed: terminal success
 * - failed: terminal failure
 */
export const taskExecutionHistoryStatusEnum = pgEnum(
  'task_execution_history_status',
  ['planned', 'planning', 'executing', 'verifying', 'completed', 'failed'],
);

/**
 * Task execution history table
 *
 * One row per task run triggered by a schedule. Distinct from job_runs
 * because task executions have a richer lifecycle and different foreign keys.
 */
export const taskExecutionHistory = pgTable(
  'task_execution_history',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => nanoid()),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    scheduleId: text('schedule_id')
      .notNull()
      .references(() => taskSchedules.id, { onDelete: 'cascade' }),
    status: taskExecutionHistoryStatusEnum('status')
      .notNull()
      .default('planned'),
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    sessionId: text('session_id').references(() => sessions.id, {
      onDelete: 'set null',
    }),
    // Snapshot of the task at run time
    taskTitle: text('task_title').notNull(),
    taskDescription: text('task_description').notNull(),
    // Outcome
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    attemptNumber: integer('attempt_number').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    taskIdCreatedAtIdx: index('task_execution_history_task_id_idx').on(
      table.taskId,
      table.createdAt,
    ),
    scheduleIdCreatedAtIdx: index('task_execution_history_schedule_id_idx').on(
      table.scheduleId,
      table.createdAt,
    ),
    statusIdx: index('task_execution_history_status_idx').on(table.status),
  }),
);
```

**Type exports**:

```ts
export type TaskExecutionHistory = typeof taskExecutionHistory.$inferSelect;
export type NewTaskExecutionHistory = typeof taskExecutionHistory.$inferInsert;
export type TaskExecutionHistoryStatus =
  (typeof taskExecutionHistoryStatusEnum.enumValues)[number];
```

### 3. Update the database barrel exports

**Update: `packages/db/src/index.ts`**

Add the new schema and repositories to the re-exports:

```ts
// Schemas
export * from './schema/tasks'; // already exported, but ensure new tables are included

// Repositories
export * from './repositories/task-schedules';
export * from './repositories/task-execution-history';
```

### 4. Add shared types for schedules

**Update: `packages/shared-types/src/tasks.ts`**

Add DTO types used by the API. These are decoupled from Drizzle's `$inferSelect` because the public API surface must stay stable across schema changes:

```ts
export type TaskScheduleDto = {
  id: string;
  taskId: string;
  schedule: ScheduleInput;
  cronExpression: string | null;
  preset: SchedulePreset | null;
  scheduleDate: string | null; // ISO 8601, for one-shots
  nextRunAt: string; // ISO 8601
  lastRunAt: string | null;
  status: 'active' | 'paused' | 'expired';
  replanPolicy: ReplanPolicy;
  maxExecutions: number; // ALWAYS finite (default 9999)
  remainingExecutions: number; // maxExecutions - executionCount, computed for the UI
  executionCount: number;
  scheduleHuman: string;
  createdAt: string;
  updatedAt: string;
};

export type TaskExecutionHistoryDto = {
  id: string;
  taskId: string;
  scheduleId: string;
  status:
    | 'planned'
    | 'planning'
    | 'executing'
    | 'verifying'
    | 'completed'
    | 'failed';
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  sessionId: string | null;
  attemptNumber: number;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
};

export type CreateTaskScheduleInput = {
  schedule: ScheduleInput;
  /**
   * Whether to re-invoke the planning agent before each run.
   * - 'never' (default): reuse existing subtasks; cheap
   * - 'on-description-change': re-plan only when the description has been edited
   * - 'always': re-plan every run (expensive, opt-in)
   */
  replanPolicy?: ReplanPolicy;
  /**
   * Maximum number of times the schedule will fire. Defaults to 9999 when omitted.
   * Must be a positive integer. There is no "infinite" option.
   */
  maxExecutions?: number;
};

export type UpdateTaskScheduleInput = {
  schedule?: ScheduleInput;
  status?: 'active' | 'paused';
  replanPolicy?: ReplanPolicy;
  /**
   * New cap on the number of executions. Must be a positive integer.
   * Cannot be unset to "infinite" — supply a new finite value instead.
   */
  maxExecutions?: number;
};
```

**Update: `packages/shared-types/src/index.ts`** — already re-exports from `./tasks.js` if it exists, otherwise create the file and add to the index.

### 5. Create `TaskSchedulesRepository`

**New file: `packages/db/src/repositories/task-schedules.ts`**

Mirror the structure of `JobsRepository` (in the same directory):

```ts
import { randomUUID } from 'node:crypto';
import { eq, and, lte, asc, desc, sql, isNull } from 'drizzle-orm';
import type { DatabaseClient } from '../client';
import * as schema from '../schema/tasks';

type Database = DatabaseClient;

export class TaskSchedulesRepository {
  constructor(private readonly db: Database) {}

  /**
   * Atomically claim the next due task schedule.
   * Mirrors JobsRepository.claimNextDueJob, scoped to active schedules
   * with nextRunAt <= now. Single-server SQLite trusts the polling
   * interval; PostgreSQL would use FOR UPDATE SKIP LOCKED in production.
   */
  async claimNextDue(): Promise<schema.TaskSchedule | null> {
    const rows = await this.db
      .select()
      .from(schema.taskSchedules)
      .where(
        and(
          eq(schema.taskSchedules.status, 'active'),
          lte(schema.taskSchedules.nextRunAt, new Date()),
        ),
      )
      .orderBy(asc(schema.taskSchedules.nextRunAt))
      .limit(1);
    return rows[0] ?? null;
  }

  async create(input: {
    taskId: string;
    cronExpression: string | null;
    preset: string | null;
    scheduleDate: Date | null;
    nextRunAt: Date;
    replanPolicy?: schema.ReplanPolicy;
    maxExecutions?: number; // defaults to 9999; no null/infinite option
  }): Promise<schema.TaskSchedule> {
    const [row] = await this.db
      .insert(schema.taskSchedules)
      .values({
        id: randomUUID(),
        taskId: input.taskId,
        cronExpression: input.cronExpression,
        preset: input.preset,
        scheduleDate: input.scheduleDate,
        nextRunAt: input.nextRunAt,
        replanPolicy: input.replanPolicy ?? 'never',
        maxExecutions: input.maxExecutions ?? 9999, // default 9999, always finite
        status: 'active',
        executionCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    return row!;
  }

  async findById(id: string): Promise<schema.TaskSchedule | null> {
    const rows = await this.db
      .select()
      .from(schema.taskSchedules)
      .where(eq(schema.taskSchedules.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByTaskId(taskId: string): Promise<schema.TaskSchedule | null> {
    const rows = await this.db
      .select()
      .from(schema.taskSchedules)
      .where(eq(schema.taskSchedules.taskId, taskId))
      .limit(1);
    return rows[0] ?? null;
  }

  async list(filters?: {
    status?: schema.TaskScheduleStatus;
    limit?: number;
    offset?: number;
  }): Promise<{ items: schema.TaskSchedule[]; total: number }> {
    const where = filters?.status
      ? eq(schema.taskSchedules.status, filters.status)
      : undefined;

    const items = await this.db
      .select()
      .from(schema.taskSchedules)
      .where(where)
      .orderBy(asc(schema.taskSchedules.nextRunAt))
      .limit(filters?.limit ?? 100)
      .offset(filters?.offset ?? 0);

    const countRows = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.taskSchedules)
      .where(where);

    return {
      items,
      total: countRows[0]?.count ?? 0,
    };
  }

  async update(
    id: string,
    updates: {
      nextRunAt?: Date;
      lastRunAt?: Date;
      status?: schema.TaskScheduleStatus;
      executionCount?: number;
      maxExecutions?: number; // must be > 0; no null
      cronExpression?: string;
      preset?: string | null;
      scheduleDate?: Date | null;
    },
  ): Promise<schema.TaskSchedule> {
    const [row] = await this.db
      .update(schema.taskSchedules)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(schema.taskSchedules.id, id))
      .returning();
    if (!row) throw new Error(`TaskSchedule ${id} not found`);
    return row;
  }

  async delete(id: string): Promise<void> {
    await this.db
      .delete(schema.taskSchedules)
      .where(eq(schema.taskSchedules.id, id));
  }

  async deleteByTaskId(taskId: string): Promise<void> {
    await this.db
      .delete(schema.taskSchedules)
      .where(eq(schema.taskSchedules.taskId, taskId));
  }
}
```

### 6. Create `TaskExecutionHistoryRepository`

**New file: `packages/db/src/repositories/task-execution-history.ts`**

```ts
import { randomUUID } from 'node:crypto';
import { eq, and, desc, sql } from 'drizzle-orm';
import type { DatabaseClient } from '../client';
import * as schema from '../schema/tasks';

type Database = DatabaseClient;

export class TaskExecutionHistoryRepository {
  constructor(private readonly db: Database) {}

  async create(input: {
    taskId: string;
    scheduleId: string;
    taskTitle: string;
    taskDescription: string;
    attemptNumber?: number;
  }): Promise<schema.TaskExecutionHistory> {
    const [row] = await this.db
      .insert(schema.taskExecutionHistory)
      .values({
        id: randomUUID(),
        taskId: input.taskId,
        scheduleId: input.scheduleId,
        taskTitle: input.taskTitle,
        taskDescription: input.taskDescription,
        status: 'planned',
        attemptNumber: input.attemptNumber ?? 1,
        startedAt: new Date(),
        createdAt: new Date(),
      })
      .returning();
    return row!;
  }

  async findById(id: string): Promise<schema.TaskExecutionHistory | null> {
    const rows = await this.db
      .select()
      .from(schema.taskExecutionHistory)
      .where(eq(schema.taskExecutionHistory.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async listByTask(
    taskId: string,
    filters?: {
      status?: schema.TaskExecutionHistoryStatus;
      limit?: number;
      offset?: number;
    },
  ): Promise<{
    items: schema.TaskExecutionHistory[];
    total: number;
  }> {
    const where = filters?.status
      ? and(
          eq(schema.taskExecutionHistory.taskId, taskId),
          eq(schema.taskExecutionHistory.status, filters.status),
        )
      : eq(schema.taskExecutionHistory.taskId, taskId);

    const items = await this.db
      .select()
      .from(schema.taskExecutionHistory)
      .where(where)
      .orderBy(desc(schema.taskExecutionHistory.createdAt))
      .limit(filters?.limit ?? 20)
      .offset(filters?.offset ?? 0);

    const countRows = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.taskExecutionHistory)
      .where(where);

    return { items, total: countRows[0]?.count ?? 0 };
  }

  async updateStatus(
    id: string,
    updates: {
      status?: schema.TaskExecutionHistoryStatus;
      sessionId?: string | null;
      finishedAt?: Date | null;
      errorCode?: string | null;
      errorMessage?: string | null;
    },
  ): Promise<schema.TaskExecutionHistory> {
    const [row] = await this.db
      .update(schema.taskExecutionHistory)
      .set(updates)
      .where(eq(schema.taskExecutionHistory.id, id))
      .returning();
    if (!row) throw new Error(`TaskExecutionHistory ${id} not found`);
    return row;
  }
}
```

### 7. Wire the repositories into the database adapter

**Update: `packages/db/src/adapter.ts`**

Add the new repositories to the `repositories` object returned by `createDatabaseAdapter`:

```ts
return {
  // ... existing repos ...
  taskSchedules: new TaskSchedulesRepository(db),
  taskExecutionHistory: new TaskExecutionHistoryRepository(db),
};
```

**Update: `packages/db/src/types/index.ts`**

Add the new repository types to the `Repositories` interface:

```ts
export interface Repositories {
  // ... existing ...
  taskSchedules: TaskSchedulesRepository;
  taskExecutionHistory: TaskExecutionHistoryRepository;
}
```

### 8. Generate and apply the migration

```bash
# From the repo root
pnpm --filter @openaidy/db generate
```

This produces a new SQL file in `packages/db/drizzle/`. The migration adds:

- 3 new enums (`task_schedule_status`, `task_schedule_replan_policy`, `task_execution_history_status`)
- 2 new tables with their indexes and constraints

Apply the migration to a development DB and verify the schema with:

```bash
# SQLite
sqlite3 apps/server/data/openaidy.db ".schema task_schedules"
sqlite3 apps/server/data/openaidy.db ".schema task_execution_history"
```

For PostgreSQL, run `pnpm --filter @openaidy/db migrate` against a test database.

### 9. Write repository unit tests

**New file: `packages/db/src/repositories/task-schedules.test.ts`**

Use the same test pattern as `jobs.test.ts`. Cover:

- `create` returns a row with defaults populated
- `findById` returns null for unknown IDs
- `findByTaskId` returns the unique schedule for a task
- `list` paginates correctly and filters by status
- `update` patches the specified fields and bumps `updatedAt`
- `delete` and `deleteByTaskId` remove the right rows
- `claimNextDue` returns the earliest due active schedule
- `claimNextDue` skips paused and expired schedules
- `claimNextDue` orders by `nextRunAt` ascending

**New file: `packages/db/src/repositories/task-execution-history.test.ts`**

Cover:

- `create` initializes status to `'planned'`
- `updateStatus` transitions through the lifecycle states
- `listByTask` returns rows in reverse chronological order
- `listByTask` filters by status when provided
- `listByTask` paginates via limit/offset

### 10. Update the database adapter tests

**Update: `packages/db/src/adapter.test.ts`**

Add assertions that the new repositories are present in the adapter's `repositories` object.

---

## Rollout

Phase 1 is a data-layer-only change. No runtime behaviour is affected. The tables exist but nothing writes to them.

Rollout steps:

1. Run `pnpm --filter @openaidy/db generate` and commit the migration
2. Apply the migration to staging
3. Verify the tables exist with `\d task_schedules` (Postgres) or `.schema` (SQLite)
4. Deploy
5. Run the new repository tests in CI
6. If clean, proceed to Phase 2

## Risk assessment

| Risk                                            | Mitigation                                                              |
| ----------------------------------------------- | ----------------------------------------------------------------------- |
| Migration fails on existing data                | New tables only — no changes to existing tables, no FK back-references  |
| `randomUUID()` vs `nanoid()` inconsistency      | `JobsRepository` uses `randomUUID()`; new repos follow the same pattern |
| The unique constraint on `task_id` blocks setup | Application layer enforces "1 schedule per task" before insert          |
| Index on `next_run_at` is missing               | Schema explicitly defines `task_schedules_next_run_at_idx`              |
