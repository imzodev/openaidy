# Phase 3: Service Layer

## Overview

Phase 3 introduces the `TaskScheduleService` — the user-facing service layer that mediates between the API/routes, the executor, and the repositories. It exposes the operations a user (or agent) needs: create, update, pause, resume, trigger, list executions.

By the end of Phase 3, all domain logic for schedules is in one place. The route layer (Phase 4) is a thin adapter over this service.

This phase is where the executor and the rest of the app meet. The wiring in `app.ts` becomes a real dependency graph.

## Objectives

- Implement `TaskScheduleService` with full CRUD + lifecycle operations
- Define DTO ↔ record mappers (schedule row → `TaskScheduleDto`, history row → `TaskExecutionHistoryDto`)
- Integrate with `TaskService` so creating a task with a schedule is a single call
- Expose the service through the `AppServices` decoration so routes can inject it
- Add a `getScheduleForTask(taskId)` convenience method used by the existing task routes
- Backfill: when `TaskService.createTask` is called without a schedule, no schedule row is created (backward compatible)

## Success criteria

- `TaskScheduleService.createSchedule(taskId, input)` creates a schedule row linked to an existing task
- `TaskScheduleService.updateSchedule(taskId, input)` updates the schedule (or removes it if input is null)
- `TaskScheduleService.pauseSchedule(taskId)` / `resumeSchedule(taskId)` toggle the status
- `TaskScheduleService.triggerNow(taskId)` runs the schedule immediately without rescheduling
- `TaskScheduleService.listExecutions(taskId, filters)` returns paginated history
- The DTO mappers produce the documented `TaskScheduleDto` and `TaskExecutionHistoryDto` shapes
- `AppServices.taskSchedules` is available in `app.ts` for injection
- The service is fully unit-testable with in-memory repository fakes

---

## Implementation tasks

### 1. Create the DTO mapper

**New file: `apps/server/src/tasks/schedule-dto.ts`**

This module converts DB rows + schedule input into the public DTO shape.

```ts
import type { TaskSchedule, TaskExecutionHistory } from '@openaidy/db';
import type {
  TaskScheduleDto,
  TaskExecutionHistoryDto,
  ScheduleInput,
} from '@openaidy/shared-types';
import { describeCronExpression } from '../scheduler/cron-utils';
import { parseScheduleInput } from '../scheduler/schedule-input';

/**
 * Map a task_schedules row to its public DTO.
 * Derives the human-readable schedule description and the original
 * ScheduleInput shape for the UI.
 */
export function taskScheduleToDto(schedule: TaskSchedule): TaskScheduleDto {
  const scheduleInput: ScheduleInput | null = scheduleToInput(schedule);
  const scheduleHuman = schedule.cronExpression
    ? describeCronExpression(schedule.cronExpression)
    : schedule.scheduleDate
      ? `Once at ${schedule.scheduleDate.toISOString()}`
      : 'Unknown schedule';

  const dto: TaskScheduleDto = {
    id: schedule.id,
    taskId: schedule.taskId,
    schedule: scheduleInput ?? { cron: schedule.cronExpression ?? '' },
    cronExpression: schedule.cronExpression,
    preset: (schedule.preset as TaskScheduleDto['preset']) ?? null,
    scheduleDate: schedule.scheduleDate?.toISOString() ?? null,
    nextRunAt: schedule.nextRunAt.toISOString(),
    lastRunAt: schedule.lastRunAt?.toISOString() ?? null,
    status: schedule.status,
    replanPolicy: schedule.replanPolicy,
    maxExecutions: schedule.maxExecutions, // always a positive number, default 9999
    remainingExecutions: Math.max(
      0,
      schedule.maxExecutions - schedule.executionCount,
    ),
    executionCount: schedule.executionCount,
    scheduleHuman,
    createdAt: schedule.createdAt.toISOString(),
    updatedAt: schedule.updatedAt.toISOString(),
  };
  return dto;
}

/**
 * Best-effort reconstruction of the original ScheduleInput that
 * produced this schedule row. Returns null if the row's shape
 * does not match any known ScheduleInput variant.
 */
function scheduleToInput(schedule: TaskSchedule): ScheduleInput | null {
  if (schedule.preset) {
    return {
      every: schedule.preset as
        | '15m'
        | '30m'
        | '1h'
        | '6h'
        | '12h'
        | '1d'
        | '1w',
    };
  }
  if (schedule.cronExpression && !schedule.scheduleDate) {
    return { cron: schedule.cronExpression };
  }
  if (schedule.scheduleDate) {
    return { at: schedule.scheduleDate.toISOString() };
  }
  return null;
}

/**
 * Map a task_execution_history row to its public DTO.
 */
export function taskExecutionHistoryToDto(
  row: TaskExecutionHistory,
): TaskExecutionHistoryDto {
  const durationMs =
    row.finishedAt && row.startedAt
      ? row.finishedAt.getTime() - row.startedAt.getTime()
      : null;
  return {
    id: row.id,
    taskId: row.taskId,
    scheduleId: row.scheduleId,
    status: row.status,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    durationMs,
    sessionId: row.sessionId,
    attemptNumber: row.attemptNumber,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
  };
}
```

### 2. Implement `TaskScheduleService`

**New file: `apps/server/src/tasks/schedule-service.ts`**

```ts
import type {
  TasksRepository,
  TaskSchedulesRepository,
  TaskExecutionHistoryRepository,
} from '@openaidy/db';
import type {
  CreateTaskScheduleInput,
  UpdateTaskScheduleInput,
} from '@openaidy/shared-types';
import type { TaskScheduleExecutor } from './execution/task-schedule-executor';
import { parseScheduleInput } from '../scheduler/schedule-input';
import { taskScheduleToDto, taskExecutionHistoryToDto } from './schedule-dto';
import { createLogger } from '../lib/logger';

export type TaskScheduleServiceDeps = {
  tasksRepo: TasksRepository;
  taskSchedulesRepo: TaskSchedulesRepository;
  taskExecutionHistoryRepo: TaskExecutionHistoryRepository;
  taskScheduleExecutor: TaskScheduleExecutor;
};

export type ServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

export class TaskScheduleService {
  private readonly logger = createLogger('TaskScheduleService');

  constructor(private readonly deps: TaskScheduleServiceDeps) {}

  // ========================================
  // Read
  // ========================================

  async getScheduleForTask(
    taskId: string,
  ): Promise<ServiceResult<ReturnType<typeof taskScheduleToDto>>> {
    const schedule = await this.deps.taskSchedulesRepo.findByTaskId(taskId);
    if (!schedule) {
      return {
        ok: false,
        error: {
          code: 'schedule.not_found',
          message: `No schedule for task ${taskId}`,
        },
      };
    }
    return { ok: true, data: taskScheduleToDto(schedule) };
  }

  async getScheduleById(
    id: string,
  ): Promise<ServiceResult<ReturnType<typeof taskScheduleToDto>>> {
    const schedule = await this.deps.taskSchedulesRepo.findById(id);
    if (!schedule) {
      return {
        ok: false,
        error: {
          code: 'schedule.not_found',
          message: `Schedule ${id} not found`,
        },
      };
    }
    return { ok: true, data: taskScheduleToDto(schedule) };
  }

  // ========================================
  // Create
  // ========================================

  async createSchedule(
    taskId: string,
    input: CreateTaskScheduleInput,
  ): Promise<ServiceResult<ReturnType<typeof taskScheduleToDto>>> {
    const task = await this.deps.tasksRepo.findById(taskId);
    if (!task) {
      return {
        ok: false,
        error: { code: 'task.not_found', message: `Task ${taskId} not found` },
      };
    }

    // Refuse if a schedule already exists
    const existing = await this.deps.taskSchedulesRepo.findByTaskId(taskId);
    if (existing) {
      return {
        ok: false,
        error: {
          code: 'schedule.already_exists',
          message: 'Task already has a schedule. Use updateSchedule to modify.',
        },
      };
    }

    const parsed = parseScheduleInput(input.schedule);
    if (parsed.type !== 'cron' && parsed.type !== 'one-shot') {
      return {
        ok: false,
        error: { code: 'schedule.invalid', message: 'Invalid schedule type' },
      };
    }

    const schedule = await this.deps.taskSchedulesRepo.create({
      taskId,
      cronExpression: parsed.cronExpression ?? null,
      preset: 'every' in input.schedule ? input.schedule.every : null,
      scheduleDate: parsed.schedule ?? null,
      nextRunAt: parsed.nextRunAt,
      replanPolicy: input.replanPolicy ?? 'never',
      maxExecutions: input.maxExecutions ?? 9999, // default 9999; no null allowed
    });

    this.logger.info({ taskId, scheduleId: schedule.id }, 'Schedule created');
    return { ok: true, data: taskScheduleToDto(schedule) };
  }

  // ========================================
  // Update
  // ========================================

  async updateSchedule(
    taskId: string,
    input: UpdateTaskScheduleInput,
  ): Promise<ServiceResult<ReturnType<typeof taskScheduleToDto>>> {
    const existing = await this.deps.taskSchedulesRepo.findByTaskId(taskId);
    if (!existing) {
      return {
        ok: false,
        error: {
          code: 'schedule.not_found',
          message: `No schedule for task ${taskId}`,
        },
      };
    }

    const updates: Parameters<typeof this.deps.taskSchedulesRepo.update>[1] =
      {};

    if (input.schedule !== undefined) {
      const parsed = parseScheduleInput(input.schedule);
      updates.cronExpression = parsed.cronExpression ?? null;
      updates.preset = 'every' in input.schedule ? input.schedule.every : null;
      updates.scheduleDate = parsed.schedule ?? null;
      updates.nextRunAt = parsed.nextRunAt;
    }

    if (input.status !== undefined) {
      // Cannot transition out of 'expired' (terminal)
      if (existing.status === 'expired' && input.status !== 'expired') {
        return {
          ok: false,
          error: {
            code: 'schedule.expired',
            message: 'Cannot resume an expired schedule. Create a new one.',
          },
        };
      }
      updates.status = input.status;
    }

    if (input.maxExecutions !== undefined) {
      // Validate: must be a positive integer. The DB CHECK constraint also
      // enforces this, but we surface a clean error before hitting it.
      if (!Number.isInteger(input.maxExecutions) || input.maxExecutions <= 0) {
        return {
          ok: false,
          error: {
            code: 'schedule.invalid_max_executions',
            message: 'maxExecutions must be a positive integer',
          },
        };
      }
      updates.maxExecutions = input.maxExecutions;
    }

    const updated = await this.deps.taskSchedulesRepo.update(
      existing.id,
      updates,
    );
    this.logger.info({ taskId, scheduleId: existing.id }, 'Schedule updated');
    return { ok: true, data: taskScheduleToDto(updated) };
  }

  // ========================================
  // Remove
  // ========================================

  async removeSchedule(taskId: string): Promise<ServiceResult<true>> {
    const existing = await this.deps.taskSchedulesRepo.findByTaskId(taskId);
    if (!existing) {
      return {
        ok: false,
        error: {
          code: 'schedule.not_found',
          message: `No schedule for task ${taskId}`,
        },
      };
    }
    await this.deps.taskSchedulesRepo.delete(existing.id);
    this.logger.info({ taskId, scheduleId: existing.id }, 'Schedule removed');
    return { ok: true, data: true };
  }

  // ========================================
  // Pause / Resume
  // ========================================

  async pauseSchedule(
    taskId: string,
  ): Promise<ServiceResult<ReturnType<typeof taskScheduleToDto>>> {
    return this.updateSchedule(taskId, { status: 'paused' });
  }

  async resumeSchedule(
    taskId: string,
  ): Promise<ServiceResult<ReturnType<typeof taskScheduleToDto>>> {
    return this.updateSchedule(taskId, { status: 'active' });
  }

  // ========================================
  // Trigger
  // ========================================

  async triggerNow(taskId: string): Promise<
    ServiceResult<{
      historyId: string;
    }>
  > {
    const schedule = await this.deps.taskSchedulesRepo.findByTaskId(taskId);
    if (!schedule) {
      return {
        ok: false,
        error: {
          code: 'schedule.not_found',
          message: `No schedule for task ${taskId}`,
        },
      };
    }
    const result = await this.deps.taskScheduleExecutor.triggerNow(schedule.id);
    if (!result.ok) {
      return {
        ok: false,
        error: {
          code: 'execution.failed',
          message: result.error ?? 'Unknown error',
        },
      };
    }
    return { ok: true, data: { historyId: result.historyId } };
  }

  // ========================================
  // History
  // ========================================

  async listExecutions(
    taskId: string,
    filters: {
      status?:
        | 'planned'
        | 'planning'
        | 'executing'
        | 'verifying'
        | 'completed'
        | 'failed';
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<
    ServiceResult<{
      items: ReturnType<typeof taskExecutionHistoryToDto>[];
      total: number;
      limit: number;
      offset: number;
    }>
  > {
    const { items, total } =
      await this.deps.taskExecutionHistoryRepo.listByTask(taskId, {
        ...(filters.status !== undefined ? { status: filters.status } : {}),
        ...(filters.limit !== undefined ? { limit: filters.limit } : {}),
        ...(filters.offset !== undefined ? { offset: filters.offset } : {}),
      });
    return {
      ok: true,
      data: {
        items: items.map(taskExecutionHistoryToDto),
        total,
        limit: filters.limit ?? 20,
        offset: filters.offset ?? 0,
      },
    };
  }

  // ========================================
  // Helpers
  // ========================================

  // The description hash is owned and updated by the executor (in reschedule).
  // This service layer doesn't need to do anything on description changes —
  // the executor compares the current hash against schedule.descriptionHash
  // on the next claim and decides whether to replan.
}
```

### 3. Expose `TaskScheduleService` through `AppServices`

**Update: `apps/server/src/types.ts`**

Add the new service to the type:

```ts
import type { TaskScheduleService } from './tasks/schedule-service';

export type AppServices = {
  // ... existing fields ...
  taskSchedules: TaskScheduleService | undefined;
};
```

**Update: `apps/server/src/app.ts`**

Inside the `dbAdapter` block where `taskService` is created, instantiate the schedule service and add it to the `services` object:

```ts
const taskScheduleService = new TaskScheduleService({
  tasksRepo: dbAdapter.repositories.tasks,
  taskSchedulesRepo: dbAdapter.repositories.taskSchedules,
  taskExecutionHistoryRepo: dbAdapter.repositories.taskExecutionHistory,
  taskScheduleExecutor,
});

const services: AppServices = {
  // ... existing fields ...
  taskSchedules: taskScheduleService,
};
```

### 4. Hook into `TaskService.createTask` and `TaskService.updateTask`

**Update: `apps/server/src/tasks/operations/task-operations.ts`**

In `createTask`, accept an optional `schedule: CreateTaskScheduleInput` field. If present, call `taskSchedules.createSchedule(taskId, schedule)`.

In `updateTask`, no extra work is needed for the schedule. The executor re-reads the task's `description` on every claim, so any update to the description is automatically picked up by the next run. The only relevant side effect is that if the user changes the task's `agentId` via `assignAgents`, that change takes effect on the next run too (the executor re-fetches `task_agents` on each claim).

**Concrete changes**:

```ts
// In TaskOperations constructor or method signature, accept taskSchedulesService:
constructor(
  // ... existing params ...
  private readonly taskSchedulesService: TaskScheduleService | undefined,
) {}

// In createTask, after creating the task:
async createTask(input: CreateTaskInput): Promise<ServiceResult<Task>> {
  const result = /* existing create logic */;
  if (result.ok && input.schedule && this.taskSchedulesService) {
    await this.taskSchedulesService.createSchedule(result.data.id, input.schedule);
  }
  return result;
}

// In updateTask, no schedule-related work is needed. The executor reads
// the latest task state (description, agents) on every claim. The only
// task-side effect relevant to schedules is preserving the task_id
// link, which is already handled by the existing update flow.
```

**Update: `apps/server/src/types.ts`**

Extend `CreateTaskInput` to include the optional `schedule`:

```ts
export type CreateTaskInput = {
  // ... existing fields ...
  schedule?: CreateTaskScheduleInput;
};
```

### 5. Expose the schedule on the task DTO

**Update: `apps/server/src/tasks/operations/task-operations.ts`**

In `getTaskWithDetails` and `listTasksForKanban`, fetch the schedule for each task and attach the DTO:

```ts
async getTaskWithDetails(id: string): Promise<TaskWithDetails | null> {
  const task = await this.tasksRepo.findById(id);
  if (!task) return null;
  const schedule = this.taskSchedulesService
    ? await this.taskSchedulesService.getScheduleForTask(id)
    : undefined;
  return {
    ...task,
    ...(schedule && schedule.ok ? { schedule: schedule.data } : {}),
  };
}
```

Add the `schedule` field to the `TaskWithDetails` type:

```ts
export type TaskWithDetails = Task & {
  subtasks: Subtask[];
  agents: TaskAgent[];
  schedule?: TaskScheduleDto;
};
```

The Kanban board's `listTasksForKanban` similarly attaches a `schedule` field to each task object so the UI can show the recurring badge (Phase 6).

### 6. Unit tests

**New file: `apps/server/src/tasks/schedule-service.test.ts`**

Use in-memory fakes for the repositories. Cover:

- `createSchedule` creates a row with parsed cron and correct nextRunAt
- `createSchedule` defaults `maxExecutions` to 9999 when not provided
- `createSchedule` defaults `replanPolicy` to `'never'` when not provided
- `createSchedule` rejects when task does not exist
- `createSchedule` rejects when a schedule already exists
- `updateSchedule` updates cron and recomputes nextRunAt
- `updateSchedule` can change status to 'paused'
- `updateSchedule` cannot transition out of 'expired'
- `updateSchedule` rejects `maxExecutions` that are not positive integers
- `removeSchedule` deletes the row
- `pauseSchedule` and `resumeSchedule` toggle the status
- `triggerNow` delegates to the executor and returns the history ID
- `listExecutions` paginates correctly
- DTO mapper computes `remainingExecutions = max(0, maxExecutions - executionCount)`

### 7. Integration smoke test

**New file: `apps/server/src/tasks/schedule-service.integration.test.ts`**

With a real DB:

- Create a task, then create a schedule with `every: '1m'`
- Verify the schedule row exists in the DB
- Call `triggerNow`, verify a history row is created
- Call `removeSchedule`, verify the row is gone

---

## Rollout

Phase 3 introduces the service layer. The feature is still not user-facing (no API routes). It can be deployed and unit-tested without external visibility.

Rollout steps:

1. Ship the service code
2. Run the unit test suite
3. Run a smoke test from a debug REPL: `taskSchedules.createSchedule(...)` and verify the DB row
4. Confirm the executor still works in dev (already enabled in Phase 2 dev environment)
5. If clean, proceed to Phase 4

## Risk assessment

| Risk                                                   | Mitigation                                                                                                                       |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `updateSchedule` racing with executor                  | Status transitions are atomic; the executor reads the snapshot at claim time, so a concurrent update is a no-op or a small delay |
| Circular dependency: TaskService ↔ TaskScheduleService | TaskScheduleService does not depend on TaskService. TaskService depends on TaskScheduleService (loose, optional).                |
| DTO mapper throws on malformed rows                    | `taskScheduleToDto` is pure; all `??` fallbacks prevent crashes                                                                  |
| User supplies `maxExecutions: 0` or negative           | Service-layer validation rejects before hitting the DB CHECK constraint                                                          |
