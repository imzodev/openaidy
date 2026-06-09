# Phase 2: Polymorphic Executor

## Overview

Phase 2 implements `TaskScheduleExecutor` — the `ScheduledRunnable` for tasks. It owns the lifecycle of one task run: claiming, optional cleanup, optional replan, execute, and reschedule. The executor is registered with the scheduler in `app.ts`, making the feature live for the first time.

By the end of Phase 2, recurring tasks work end-to-end through the existing API (no new routes yet — that comes in Phase 4). The existing one-off `executeTask` flow is unaffected.

## Objectives

- Implement `TaskScheduleExecutor` as a `ScheduledRunnable<TaskSchedulePayload>`
- Implement the per-run cleanup logic (subtasks deleted only when the replan policy says so; session ref always reset)
- Implement the replan decision (controlled by `replanPolicy` on the schedule)
- Implement the reschedule logic (cron calculation + max-executions check)
- Register the executor with the scheduler in `app.ts`
- Add integration tests covering: claim → execute → reschedule flow, and the no-op cases (paused, expired, max-executions reached)
- Add a manual trigger path that bypasses `reschedule`

## Success criteria

- A task with `task_schedules` row fires on schedule and creates a `task_execution_history` row
- The task's subtasks are reused across runs by default (`replanPolicy: 'never'`); cleaned up only when replan is triggered
- **The same `task_agents` (assigned agents) are reused on every run** — never `[]`
- Re-planning is opt-in: `'always'` replans every run, `'on-description-change'` replans only when the description hash has changed, `'never'` (default) never replans
- `paused` schedules never fire
- `expired` schedules never fire
- Schedules reach `expired` automatically when `executionCount >= maxExecutions` (default 9999)
- One-shot schedules transition to `expired` after firing
- Existing Pulses still work (regression suite passes)

---

## Implementation tasks

### 1. Define the payload type

**New file: `apps/server/src/tasks/execution/task-schedule-executor.ts`**

```ts
import type { ScheduledRunnable, ExecutionResult } from '@openaidy/runtime';
import type {
  TaskSchedule,
  TaskAgent,
  SubtasksRepository,
  TasksRepository,
  SessionsStore,
  TaskAgentsRepository,
} from '@openaidy/db';
import type { TaskExecutionHistoryRepository } from '@openaidy/db';
import type { TaskSchedulesRepository } from '@openaidy/db';
import type { SessionMessageService } from '../../sessions/service';
import type { PlanningService } from '../../planning';
import type { TaskExecution } from './task-execution';
import { calculateNextRun } from '../../scheduler/cron-utils';
import { parseScheduleInput } from '../../scheduler/schedule-input';
import type { GenericLogger } from '../../scheduler/service';
import { createHash } from 'node:crypto';

/**
 * SHA-256 hash of a task description. Used by the `on-description-change`
 * replan policy to decide whether to re-invoke the planning agent. The hash
 * is updated on `task_schedules.description_hash` at the end of every run.
 */
function hashDescription(description: string): string {
  return createHash('sha256').update(description, 'utf8').digest('hex');
}

/**
 * Payload type for the task schedule runnable.
 * Captures everything the executor needs without re-fetching.
 */
export type TaskSchedulePayload = {
  schedule: TaskSchedule;
  taskTitle: string;
  taskDescription: string;
  /**
   * The agents assigned to the task via task_agents rows.
   * Re-fetched on every claim so agent reassignments on the task take effect
   * on the next run. Always present — at minimum contains the system default
   * agent if no explicit assignment exists.
   */
  taskAssignedAgents: TaskAgent[];
};
```

### 2. Implement the executor class

Append to `task-schedule-executor.ts`:

```ts
export type TaskScheduleExecutorDeps = {
  taskSchedulesRepo: TaskSchedulesRepository;
  taskExecutionHistoryRepo: TaskExecutionHistoryRepository;
  tasksRepo: TasksRepository;
  subtasksRepo: SubtasksRepository;
  taskAgentsRepo: TaskAgentsRepository;
  sessionsStore: SessionsStore;
  sessionService: SessionMessageService;
  planningService: PlanningService | undefined;
  taskExecution: TaskExecution;
  defaultAgentIdProvider: () => string | undefined;
  logger: GenericLogger;
};

export class TaskScheduleExecutor implements ScheduledRunnable<TaskSchedulePayload> {
  readonly kind = 'task';

  constructor(private readonly deps: TaskScheduleExecutorDeps) {}

  // ========================================
  // Claim
  // ========================================

  async claimNextDue(): Promise<{
    id: string;
    payload: TaskSchedulePayload;
  } | null> {
    const schedule = await this.deps.taskSchedulesRepo.claimNextDue();
    if (!schedule) return null;

    const task = await this.deps.tasksRepo.findById(schedule.taskId);
    if (!task) {
      this.deps.logger.warn(
        { scheduleId: schedule.id, taskId: schedule.taskId },
        'Schedule references missing task, skipping',
      );
      return null;
    }

    // Re-fetch assigned agents on every claim so that user reassignments
    // (via TaskService.assignAgents) take effect on the next run.
    const assignedAgents = await this.deps.taskAgentsRepo.listByTask(task.id);

    // If the task has no explicit agent assignments, fall back to the
    // system default agent so the run always has a primary agent.
    const taskAssignedAgents: TaskAgent[] =
      assignedAgents.length > 0
        ? assignedAgents
        : this.deps.defaultAgentIdProvider()
          ? [
              {
                taskId: task.id,
                agentId: this.deps.defaultAgentIdProvider()!,
                role: 'primary',
                assignedAt: new Date(),
              },
            ]
          : [];

    if (taskAssignedAgents.length === 0) {
      this.deps.logger.warn(
        { taskId: task.id },
        'Task has no agents and no default agent is configured; run will fail',
      );
    }

    return {
      id: schedule.id,
      payload: {
        schedule,
        taskTitle: task.title,
        taskDescription: task.description,
        taskAssignedAgents,
      },
    };
  }

  // ========================================
  // Execute
  // ========================================

  async execute(
    id: string,
    payload: TaskSchedulePayload,
  ): Promise<ExecutionResult> {
    const start = Date.now();
    const { schedule, taskTitle, taskDescription } = payload;
    const taskId = schedule.taskId;

    // 1. Create history row (status: planned)
    const history = await this.deps.taskExecutionHistoryRepo.create({
      taskId,
      scheduleId: schedule.id,
      taskTitle,
      taskDescription,
    });

    try {
      // 2. Decide whether to replan this run. Re-planning is OPT-IN; the
      //    default `never` policy reuses the existing subtasks.
      const currentDescriptionHash = hashDescription(taskDescription);
      const hashChanged = currentDescriptionHash !== schedule.descriptionHash;
      const willReplan =
        schedule.replanPolicy === 'always' ||
        (schedule.replanPolicy === 'on-description-change' && hashChanged);

      // 3. Cleanup previous run (subtasks deleted ONLY when replanning; the
      //    session reference is always reset so the new run starts fresh).
      await this.cleanupPreviousRun(taskId, willReplan);

      // 4. Create new session
      const session = await this.deps.sessionService.createSession(
        `Task: ${taskTitle} (run #${schedule.executionCount + 1})`,
        'task',
      );
      await this.deps.tasksRepo.update(taskId, {
        sessionId: session.id,
        status: 'in_progress',
      });
      await this.deps.taskExecutionHistoryRepo.updateStatus(history.id, {
        sessionId: session.id,
        status: 'executing',
      });

      // 5. Plan (only when the replan policy says so)
      if (willReplan) {
        if (this.deps.planningService) {
          await this.deps.taskExecutionHistoryRepo.updateStatus(history.id, {
            status: 'planning',
          });
          await this.deps.planningService.plan(taskId, session.id);
        } else {
          this.deps.logger.warn(
            { taskId },
            'Replan policy requires planning but planningService is not available; falling back to description execution',
          );
        }
      } else {
        this.deps.logger.debug(
          { taskId, replanPolicy: schedule.replanPolicy },
          'Skipping planning this run (replan policy)',
        );
      }

      // 6. Execute subtasks (or fall back to description)
      //    taskExecution.executeSubtasks reads the agent assignment from
      //    the subtask row or from task_agents — both are preserved between
      //    runs (only subtasks are deleted when replanning, agents stay).
      const subtasks = await this.deps.subtasksRepo.listByTask(taskId);
      if (subtasks.length > 0) {
        await this.deps.taskExecution.executeSubtasks(taskId);
      } else {
        // No subtasks — submit the description directly using the primary
        // agent from the original task assignment.
        const primaryAgent = payload.taskAssignedAgents[0]?.agentId;
        const messageInput: SubmitMessageStreamingInput = {
          sessionId: session.id,
          content: taskDescription,
          role: 'user',
          onStreamEvent: () => {},
        };
        if (primaryAgent !== undefined) messageInput.agentId = primaryAgent;
        await this.deps.sessionService.submitMessageStreaming(messageInput);
      }

      // History row will be transitioned to 'completed' or 'failed'
      // by the TaskExecution handleRunEvent flow (via the existing
      // RunEventEmitter subscription). We mark 'verifying' here to
      // signal that the work has been submitted.
      await this.deps.taskExecutionHistoryRepo.updateStatus(history.id, {
        status: 'verifying',
      });

      return { ok: true, durationMs: Date.now() - start };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.deps.logger.error(
        { taskId, scheduleId: id, error: err.message },
        'Task schedule execution failed',
      );
      await this.deps.taskExecutionHistoryRepo.updateStatus(history.id, {
        status: 'failed',
        finishedAt: new Date(),
        errorCode: err.name || 'EXECUTION_ERROR',
        errorMessage: err.message,
      });
      return { ok: false, error: err, durationMs: Date.now() - start };
    }
  }

  // ========================================
  // Reschedule
  // ========================================

  async reschedule(
    id: string,
    payload: TaskSchedulePayload,
    result: ExecutionResult,
  ): Promise<Date | null> {
    const { schedule } = payload;
    const newCount = schedule.executionCount + 1;
    const now = new Date();

    // Determine next status
    let nextStatus: 'active' | 'paused' | 'expired' = 'active';
    let nextRunAt: Date | null = null;

    if (schedule.cronExpression) {
      // Recurring
      if (newCount >= schedule.maxExecutions) {
        // Reached the cap — terminal
        nextStatus = 'expired';
        nextRunAt = null;
      } else {
        try {
          nextRunAt = calculateNextRun(schedule.cronExpression, now);
        } catch (error) {
          this.deps.logger.error(
            { scheduleId: id, error: String(error) },
            'Failed to calculate next run time, marking expired',
          );
          nextStatus = 'expired';
          nextRunAt = null;
        }
      }
    } else {
      // One-shot — terminal after first execution
      nextStatus = 'expired';
      nextRunAt = null;
    }

    // If the run failed but we still have headroom, keep active for retry.
    // Failed runs DO count toward maxExecutions (no free retries).
    if (
      !result.ok &&
      nextStatus === 'active' &&
      newCount >= schedule.maxExecutions
    ) {
      nextStatus = 'expired';
      nextRunAt = null;
    }

    await this.deps.taskSchedulesRepo.update(id, {
      nextRunAt: nextRunAt ?? now, // null would break NOT NULL; use now for expired
      lastRunAt: now,
      status: nextStatus,
      executionCount: newCount,
      descriptionHash: hashDescription(payload.taskDescription),
    });

    return nextRunAt;
  }

  // ========================================
  // Manual trigger (bypasses reschedule)
  // ========================================

  /**
   * Run a task schedule immediately, without affecting nextRunAt.
   * Used by the POST /api/tasks/:id/trigger endpoint.
   */
  async triggerNow(scheduleId: string): Promise<{
    ok: boolean;
    historyId: string;
    error?: string;
  }> {
    const schedule = await this.deps.taskSchedulesRepo.findById(scheduleId);
    if (!schedule) {
      return { ok: false, historyId: '', error: 'Schedule not found' };
    }
    const task = await this.deps.tasksRepo.findById(schedule.taskId);
    if (!task) {
      return { ok: false, historyId: '', error: 'Task not found' };
    }

    // Load the same agents the scheduled run would use.
    const assignedAgents = await this.deps.taskAgentsRepo.listByTask(task.id);
    const taskAssignedAgents: TaskAgent[] =
      assignedAgents.length > 0
        ? assignedAgents
        : this.deps.defaultAgentIdProvider()
          ? [
              {
                taskId: task.id,
                agentId: this.deps.defaultAgentIdProvider()!,
                role: 'primary',
                assignedAt: new Date(),
              },
            ]
          : [];

    const payload: TaskSchedulePayload = {
      schedule,
      taskTitle: task.title,
      taskDescription: task.description,
      taskAssignedAgents,
    };

    const history = await this.deps.taskExecutionHistoryRepo.create({
      taskId: task.id,
      scheduleId: schedule.id,
      taskTitle: task.title,
      taskDescription: task.description,
    });

    const result = await this.execute(schedule.id, payload);

    // Trigger does NOT call reschedule — nextRunAt is preserved.
    return {
      ok: result.ok,
      historyId: history.id,
      ...(result.ok ? {} : { error: result.error.message }),
    };
  }

  // ========================================
  // Helpers
  // ========================================

  private async cleanupPreviousRun(
    taskId: string,
    willReplan: boolean,
  ): Promise<void> {
    this.deps.logger.info(
      { taskId, willReplan },
      'Preparing task for next run',
    );

    // Delete subtasks ONLY when replanning. Otherwise, the new session will
    // pick up and execute the existing subtasks (cheap path).
    // NOTE: task_agents rows are NEVER deleted — the assignment is a
    // property of the task, not of any individual run. This is how the
    // recurring task preserves its agent assignment across cycles.
    if (willReplan) {
      await this.deps.subtasksRepo.deleteByTask?.(taskId);
    }

    // Detach the previous session reference but do NOT delete the
    // session itself — it stays in the sessions list for audit.
    await this.deps.tasksRepo.update(taskId, {
      sessionId: null,
      status: 'todo',
    });
  }
}
```

### 3. Verify `SubtasksRepository` has a `deleteByTask` method

**Check: `packages/db/src/repositories/subtasks.ts`**

If `deleteByTask` does not exist, add it:

```ts
async deleteByTask(taskId: string): Promise<void> {
  await this.db
    .delete(schema.subtasks)
    .where(eq(schema.subtasks.taskId, taskId));
}
```

This is a simple bulk delete, no soft-delete needed. If the table needs soft-delete for audit, the migration is a follow-up.

### 4. Verify `SessionsStore.create` accepts the title argument

**Check: `apps/server/src/sessions/service.ts` and `packages/db/src/repositories/sessions.ts`**

The current `SessionMessageService.createSession` signature is `(title, type?)`. For executor use, we want a direct `sessionsStore.create` call. Verify the store has a `create({ title })` method; if not, use the service:

```ts
const session = await this.deps.sessionService.createSession(
  `Task: ${taskTitle} (run #${schedule.executionCount + 1})`,
  'task',
);
```

Use the service (not the store directly) to keep the side effects (audit logs, etc.) consistent with the rest of the codebase.

### 5. Wire the executor into `app.ts`

**Update: `apps/server/src/app.ts`**

Inside the `dbAdapter` block where `taskService` is created, instantiate the executor and register it with the scheduler:

```ts
if (dbAdapter) {
  // ... existing taskService creation ...

  const taskScheduleExecutor = new TaskScheduleExecutor({
    taskSchedulesRepo: dbAdapter.repositories.taskSchedules,
    taskExecutionHistoryRepo: dbAdapter.repositories.taskExecutionHistory,
    tasksRepo: dbAdapter.repositories.tasks,
    subtasksRepo: dbAdapter.repositories.subtasks,
    taskAgentsRepo: dbAdapter.repositories.taskAgents,
    sessionsStore: dbAdapter.repositories.sessions,
    sessionService: services.sessions!,
    planningService,
    taskExecution: taskService.execution, // expose this from TaskService (see below)
    defaultAgentIdProvider: () => configService.getConfig().defaults.agentId,
    logger: log as unknown as FastifyBaseLogger,
  });

  // Register with the scheduler if it exists
  if (scheduler) {
    scheduler.registerRunnable(taskScheduleExecutor);
  }
}
```

### 6. Expose `TaskExecution` from `TaskService`

**Update: `apps/server/src/tasks/service.ts`**

Add a public getter so `app.ts` can grab the executor instance:

```ts
/**
 * The internal TaskExecution instance. Exposed for the schedule executor
 * to share the subtask lifecycle handler.
 */
get execution(): TaskExecution {
  return this.execution;
}
```

Rename the existing private `this.execution` field to `this.executionInstance` to avoid shadowing:

```ts
private readonly executionInstance: TaskExecution;
// ...
this.executionInstance = new TaskExecution(/* ... */);
```

Then:

```ts
get execution(): TaskExecution {
  return this.executionInstance;
}
```

### 7. Integrate with the existing `TaskExecution.handleRunEvent`

The existing `TaskExecution.handleRunEvent` already transitions subtasks from `in_progress` to `completed`/`failed` when the underlying run completes. We need it to ALSO transition the corresponding `task_execution_history` row.

**Update: `apps/server/src/tasks/execution/task-execution.ts`**

Inject the `TaskExecutionHistoryRepository`:

```ts
constructor(
  // ... existing params ...
  private readonly taskExecutionHistoryRepo: TaskExecutionHistoryRepository | undefined,
) {
  // ...
}
```

In `handleRunEvent`, after the existing subtask transition logic, find the history row for the session and update it:

```ts
// After updating subtask status (existing code)
const history = await this.taskExecutionHistoryRepo?.findBySessionId(
  event.sessionId,
);
if (history && history.status !== 'completed' && history.status !== 'failed') {
  await this.taskExecutionHistoryRepo?.updateStatus(history.id, {
    status: event.type === 'run.completed' ? 'completed' : 'failed',
    finishedAt: new Date(),
  });
}
```

Add a `findBySessionId` method to `TaskExecutionHistoryRepository`:

```ts
async findBySessionId(sessionId: string): Promise<schema.TaskExecutionHistory | null> {
  const rows = await this.db
    .select()
    .from(schema.taskExecutionHistory)
    .where(eq(schema.taskExecutionHistory.sessionId, sessionId))
    .orderBy(desc(schema.taskExecutionHistory.createdAt))
    .limit(1);
  return rows[0] ?? null;
}
```

### 8. Unit tests

**New file: `apps/server/src/tasks/execution/task-schedule-executor.test.ts`**

Cover:

- `claimNextDue` returns null when no schedules are due
- `claimNextDue` returns the earliest due schedule
- `claimNextDue` skips schedules whose task no longer exists
- `claimNextDue` populates `taskAssignedAgents` from `taskAgentsRepo.listByTask`
- `claimNextDue` falls back to `defaultAgentIdProvider` when the task has no explicit agents
- `execute` creates a history row in 'planned' state
- `execute` cleans up previous subtasks only when `willReplan` is true (and only subtasks — `task_agents` rows are preserved)
- `execute` creates a new session and updates the task
- `execute` re-plans on every run when `replanPolicy = 'always'`
- `execute` re-plans when `replanPolicy = 'on-description-change'` and the description hash has changed
- `execute` skips planning when `replanPolicy = 'never'` (default)
- `execute` falls back to description execution with the primary agent when no subtasks exist
- `execute` returns ok=false and writes error info when an exception is thrown
- `reschedule` computes the next cron run time for recurring schedules
- `reschedule` marks expired for one-shots
- `reschedule` marks expired when executionCount reaches maxExecutions (default 9999)
- `reschedule` returns null for expired schedules
- `reschedule` counts failed runs toward maxExecutions
- `reschedule` updates the `descriptionHash` on the schedule row
- `triggerNow` does not modify nextRunAt or executionCount
- `triggerNow` uses the same agents as a scheduled run

**New file: `apps/server/src/tasks/execution/task-schedule-executor.integration.test.ts`**

End-to-end test with real DB + real scheduler:

- Create a task with a 10-second cron
- Wait 15 seconds
- Verify a history row exists in the database
- Verify the task's subtasks from a prior "warmup" run are gone

### 9. Documentation

Update the existing `docs/recurring-tasks/recurring-tasks-technical-specification.md` execution flow diagram to reflect the new `TaskScheduleExecutor` boundary.

---

## Rollout

Phase 2 makes the feature live. The risk is real — if the executor misbehaves, recurring tasks could spam the system or leak state.

Rollout steps:

1. Ship behind a feature flag: `RECURRING_TASKS_ENABLED` env var (default: `false` in production, `true` in dev)
2. In `app.ts`, only register the executor when the flag is on
3. Deploy with flag off
4. Enable the flag in dev/staging
5. Run the integration test suite
6. Manually create a recurring task with a 1-minute schedule
7. Verify it fires 3 times, then verify `lastRunAt` and `executionCount` update
8. Pause the schedule and verify it stops firing
9. Set `maxExecutions: 2`, let it run twice, verify status becomes `expired`
10. Enable the flag in production for 1% of instances (or 1 instance) for a day
11. Monitor for errors
12. Ramp to 100% over a week

## Risk assessment

| Risk                                                     | Mitigation                                                                                                                                                                                                            |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Executor crashes mid-execution, leaves task in bad state | Cleanup runs at the START of the next execution — self-healing                                                                                                                                                        |
| Re-planning agent calls flood the system                 | Re-planning is opt-in via the schedule's `replanPolicy`. Default `'never'` reuses subtasks (cheap). `'on-description-change'` is cheap when the description is stable. `'always'` is the explicit-but-expensive path. |
| Subtask delete conflicts with an in-flight run           | Acquire a soft lock on `task_schedules` row at claim time; release after execute                                                                                                                                      |
| History table grows unbounded                            | `maxExecutions` is finite (default 9999). For longer-running schedules, the user sets a higher cap. Phase 7 adds retention policy.                                                                                    |
| Scheduler tick takes longer with the new runnable        | One extra `claimNextDue` per tick is O(1) on the indexed query                                                                                                                                                        |
| `executeSubtasks` errors leak into executor              | Try/catch wraps the entire `execute` body; errors map to history row                                                                                                                                                  |
| Agents change between runs                               | `taskAgentsRepo.listByTask` is re-fetched on every claim; user reassignment takes effect on the next run.                                                                                                             |
