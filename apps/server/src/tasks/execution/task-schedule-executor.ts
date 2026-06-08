import { createHash } from 'node:crypto';
import type { ScheduledRunnable, ExecutionResult } from '@openaidy/runtime';
import type {
  TaskSchedule,
  TaskAgent,
  TasksStore,
  SubtasksStore,
  TaskAgentsStore,
  TaskSchedulesStore,
  TaskExecutionHistoryStore,
} from '@openaidy/db';

/**
 * TaskScheduleExecutor
 *
 * Implements the `ScheduledRunnable` interface for recurring tasks. The
 * scheduler tick calls `claimNextDue()` to find a due schedule, then
 * `execute()` to run it, then `reschedule()` to compute the next firing
 * time.
 *
 * Re-plan policy (the whole point of v1 being cheap):
 * - `never` (default): reuse the existing subtasks. The executor skips
 *   both the subtask delete AND the planning agent call. The new session
 *   simply re-runs the same plan.
 * - `on-description-change`: only re-invoke the planning agent when the
 *   task's description SHA-256 has changed since the last run. Stored on
 *   `task_schedules.description_hash`.
 * - `always`: re-invoke the planning agent on every run. The expensive
 *   path; use sparingly.
 *
 * Agent assignment: a task's `task_agents` rows are the source of truth
 * for which agents to use. The executor re-reads them on every claim
 * (cheap, single SELECT) so user reassignments on the task take effect
 * on the next run. The same agents are reused across all runs of a
 * recurring task — that's the whole point of recurring tasks.
 *
 * Concurrency: the executor assumes single-server trust (the OpenAidy
 * server runs as one process per instance). `claimNextDue` uses a simple
 * `SELECT ... WHERE nextRunAt <= now AND status = 'active' ORDER BY
 * nextRunAt LIMIT 1` — no `FOR UPDATE SKIP LOCKED` yet. Multi-server
 * safety is a Phase 7 stretch goal (PostgreSQL).
 */
export type TaskSchedulePayload = {
  schedule: TaskSchedule;
  taskTitle: string;
  taskDescription: string;
  taskAssignedAgents: TaskAgent[];
  /**
   * Hash of the task description at claim time. The executor compares
   * it to the schedule's stored hash to decide whether to re-plan.
   */
  currentDescriptionHash: string;
};

/**
 * Minimal TaskService surface that the executor needs. We type against
 * a structural shape so the executor can be unit-tested with a fake.
 */
export type ExecutorTaskService = {
  executeTask(
    taskId: string,
    options?: { sessionId?: string },
  ): Promise<
    | { ok: true; data: { sessionId: string } }
    | { ok: false; error: { code: string; message: string } }
  >;
  executeSubtasks(
    taskId: string,
    options?: { sessionId?: string },
  ): Promise<
    | { ok: true; data: { startedCount: number } }
    | { ok: false; error: { code: string; message: string } }
  >;
};

/**
 * Minimal PlanningService surface. Only `planTask` is needed.
 */
export type ExecutorPlanningService = {
  planTask(
    taskId: string,
  ): Promise<
    | { ok: true; data?: unknown }
    | { ok: false; error: { code: string; message: string } }
  >;
};

/**
 * Minimal SessionMessageService surface. The executor creates the new
 * session itself (so the title includes "run #N") rather than letting
 * `executeTask` create a generic "Task: <title>" session.
 *
 * The shape is a strict subset of the real `SessionMessageService`. We
 * keep it narrow so the executor can be unit-tested with a fake, and so
 * wiring code (in `app.ts`) does a duck-typed adapter rather than
 * depending on the full service type.
 */
export type ExecutorSessionService = {
  createSession(
    title: string,
    type?: string,
  ): Promise<{ id: string; title: string }>;
  submitMessageStreaming(input: {
    sessionId: string;
    content: string;
    role: 'user';
    agentId?: string;
    /** Optional no-op when the caller doesn't care about stream events. */
    onStreamEvent?: (event: unknown) => void;
  }): Promise<
    { ok: true } | { ok: false; error: { code: string; message: string } }
  >;
};

export type TaskScheduleExecutorDeps = {
  tasksRepo: TasksStore;
  subtasksRepo: SubtasksStore;
  taskAgentsRepo: TaskAgentsStore;
  taskSchedulesRepo: TaskSchedulesStore;
  taskExecutionHistoryRepo: TaskExecutionHistoryStore;
  taskService: ExecutorTaskService;
  /** Optional — when missing, the executor skips planning (with a warning). */
  planningService?: ExecutorPlanningService;
  sessionService: ExecutorSessionService;
  /**
   * Provider for the default agent ID when a task has no `task_agents`
   * rows. Returns undefined to leave the task with no agent (the executor
   * will then fail the run with a clear error).
   */
  defaultAgentIdProvider: () => string | undefined;
  /**
   * Function that returns the next cron run time. Pulled out for
   * testability — production code wires the real `calculateNextRun`
   * from `apps/server/src/scheduler/cron-utils.ts`.
   */
  calculateNextRun: (cron: string, now: Date) => Date;
  /**
   * Logger. We use a minimal interface compatible with the scheduler's
   * `GenericLogger` so the executor can be passed the same logger.
   */
  logger: {
    info: (objOrMsg: unknown, msg?: string) => void;
    warn: (objOrMsg: unknown, msg?: string) => void;
    error: (objOrMsg: unknown, msg?: string) => void;
    debug: (objOrMsg: unknown, msg?: string) => void;
  };
};

/**
 * SHA-256 hash of a task description, lowercase hex. Stable across
 * Node versions and platforms (uses `node:crypto` which is
 * deterministic). Used by the `on-description-change` replan policy
 * to decide whether to re-invoke the planning agent.
 */
export function hashDescription(description: string): string {
  return createHash('sha256').update(description, 'utf8').digest('hex');
}

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
    const claimed = await this.deps.taskSchedulesRepo.claimNextDue();
    if (!claimed) return null;
    const schedule = claimed.payload.schedule;

    const task = await this.deps.tasksRepo.findById(schedule.taskId);
    if (!task) {
      // The task was deleted between the schedule claim and the task
      // lookup. Mark the schedule expired so we don't loop on it.
      this.deps.logger.warn(
        { scheduleId: schedule.id, taskId: schedule.taskId },
        'Schedule claims a task that no longer exists; marking expired',
      );
      await this.deps.taskSchedulesRepo.update(schedule.id, {
        status: 'expired',
      });
      return null;
    }

    // Load the agents the original task was assigned. Re-fetched on every
    // claim so agent reassignments on the task take effect on the next run.
    let taskAssignedAgents = await this.deps.taskAgentsRepo.listByTask(task.id);
    if (taskAssignedAgents.length === 0) {
      const fallbackId = this.deps.defaultAgentIdProvider();
      if (fallbackId) {
        this.deps.logger.debug(
          { taskId: task.id },
          'Task has no explicit agents; falling back to default agent',
        );
        taskAssignedAgents = [
          {
            taskId: task.id,
            agentId: fallbackId,
            role: 'primary',
            assignedAt: new Date(),
          },
        ];
      } else {
        this.deps.logger.warn(
          { taskId: task.id },
          'Task has no agents and no default agent is configured; run will fail',
        );
      }
    }

    return {
      id: schedule.id,
      payload: {
        schedule,
        taskTitle: task.title,
        taskDescription: task.description,
        taskAssignedAgents,
        currentDescriptionHash: hashDescription(task.description),
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
    const { schedule, taskTitle, taskDescription, currentDescriptionHash } =
      payload;
    const taskId = schedule.taskId;

    // 1. Create the history row (always, even if we skip planning).
    const history = await this.deps.taskExecutionHistoryRepo.create({
      taskId,
      scheduleId: schedule.id,
      taskTitle,
      taskDescription,
      attemptNumber: schedule.executionCount + 1,
    });

    try {
      // 2. Decide whether to replan this run. Re-planning is OPT-IN; the
      //    default `never` policy reuses the existing subtasks.
      const hashChanged = currentDescriptionHash !== schedule.descriptionHash;
      const willReplan =
        schedule.replanPolicy === 'always' ||
        (schedule.replanPolicy === 'on-description-change' && hashChanged);

      // 3. Cleanup previous run. Subtasks are deleted ONLY when we're
      //    about to replan (otherwise the new session will execute the
      //    existing ones — the cheap path). We also clear subtask
      //    sessionIds so Run N subtasks don't accidentally reuse Run
      //    N-1 sessions (which would break verification event routing).
      if (willReplan) {
        await this.deps.subtasksRepo.deleteByTask?.(taskId);
      } else {
        // No replan: subtasks are kept (cheap path) but their sessionIds
        // must be cleared so each run's subtasks attach to the new
        // "Task: <title> (run #N)" session instead of stale sessions
        // from a previous run.
        await this.deps.subtasksRepo.clearSessionIdsByTask?.(taskId);
      }
      await this.deps.tasksRepo.update(taskId, { sessionId: null });
      await this.deps.tasksRepo.updateStatus?.(taskId, 'todo');

      // 4. Create the new session BEFORE planning so the planning agent
      //    can attach to it. Title includes the run number for audit.
      const session = await this.deps.sessionService.createSession(
        `Task: ${taskTitle} (run #${schedule.executionCount + 1})`,
        'task',
      );
      await this.deps.tasksRepo.update(taskId, { sessionId: session.id });
      await this.deps.tasksRepo.updateStatus?.(taskId, 'in_progress');
      await this.deps.taskExecutionHistoryRepo.updateStatus(history.id, {
        sessionId: session.id,
        status: 'executing',
      });

      // 5. Replan (if policy says so).
      if (willReplan) {
        if (this.deps.planningService) {
          await this.deps.taskExecutionHistoryRepo.updateStatus(history.id, {
            status: 'planning',
            didReplan: true,
          });
          const planResult = await this.deps.planningService.planTask(taskId);
          if (!planResult.ok) {
            // Planning failed — bail out. The reschedule() below will
            // record the failure on the schedule (but the task remains
            // resumable for the next tick).
            throw new Error(
              `Planning failed for task "${taskId}": ${planResult.error.code} — ${planResult.error.message}`,
            );
          }
        } else {
          this.deps.logger.warn(
            { taskId, replanPolicy: schedule.replanPolicy },
            'Replan policy requires planning but planningService is not available; falling back to description execution',
          );
        }
      } else {
        this.deps.logger.debug(
          { taskId, replanPolicy: schedule.replanPolicy },
          'Skipping planning this run (replan policy)',
        );
      }

      // 6. Run the work. We re-use the existing `TaskService` flow
      //    rather than re-implementing session/subtask dispatch here.
      //    The session was already created above (with the "run #N"
      //    title) — pass its id through so `executeTask` /
      //    `executeSubtasks` reuse it instead of creating a second
      //    "Task: <title>" or "Subtask: <title>" session for the
      //    same run.
      const subtasks = await this.deps.subtasksRepo.listByTask(taskId);
      let submittedWork = false;
      if (subtasks.length > 0) {
        const result = await this.deps.taskService.executeSubtasks(taskId, {
          sessionId: session.id,
        });
        if (!result.ok) {
          throw new Error(
            `executeSubtasks failed: ${result.error.code} — ${result.error.message}`,
          );
        }
        // If no subtasks were actually executed (all completed or no pending),
        // fall through to executeTask to submit the task description to the
        // executor's session. This ensures the "run #N" session always has content.
        submittedWork = result.data.startedCount > 0;
      }

      // If no work was submitted (no subtasks, or all subtasks were already done),
      // submit the task description directly to the executor's session so the
      // "run #N" session always has content.
      if (!submittedWork) {
        const result = await this.deps.taskService.executeTask(taskId, {
          sessionId: session.id,
        });
        if (!result.ok) {
          throw new Error(
            `executeTask failed: ${result.error.code} — ${result.error.message}`,
          );
        }
      }

      // 7. The history row will be transitioned to `completed` or
      //    `failed` by the existing `TaskExecution.handleRunEvent` flow
      //    (via RunEventEmitter), which the user wires up in app.ts.
      //    We mark `verifying` here to signal that the work has been
      //    submitted and is awaiting confirmation.
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
      await this.deps.taskExecutionHistoryRepo.markFailed(
        history.id,
        Date.now() - start,
        {
          code: err.name || 'EXECUTION_ERROR',
          message: err.message,
        },
      );
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
    const { schedule, currentDescriptionHash } = payload;
    const newCount = schedule.executionCount + 1;
    const now = new Date();

    let nextStatus: 'active' | 'paused' | 'expired' = 'active';
    let nextRunAt: Date | null = null;

    if (schedule.cronExpression) {
      // Recurring.
      if (newCount >= schedule.maxExecutions) {
        // Reached the cap — terminal.
        nextStatus = 'expired';
        nextRunAt = null;
      } else {
        try {
          nextRunAt = this.deps.calculateNextRun(schedule.cronExpression, now);
        } catch (error) {
          this.deps.logger.error(
            { scheduleId: id, error: String(error) },
            'Failed to calculate next run time; marking expired',
          );
          nextStatus = 'expired';
          nextRunAt = null;
        }
      }
    } else {
      // One-shot — terminal after first execution, regardless of success.
      nextStatus = 'expired';
      nextRunAt = null;
    }

    // If the run failed but we still have headroom, keep `active` for
    // the next tick. Failed runs DO count toward maxExecutions (no
    // free retries — a misbehaving task should not run forever).
    if (
      !result.ok &&
      nextStatus === 'active' &&
      newCount >= schedule.maxExecutions
    ) {
      nextStatus = 'expired';
      nextRunAt = null;
    }

    await this.deps.taskSchedulesRepo.update(id, {
      // null would break NOT NULL on the column; use now() for expired rows
      // so the constraint is satisfied even when we're not rescheduling.
      nextRunAt: nextRunAt ?? now,
      lastRunAt: now,
      status: nextStatus,
      executionCount: newCount,
      // Update the description hash so the next run's `on-description-change`
      // comparison is against the description we just executed.
      descriptionHash: currentDescriptionHash,
    });

    return nextRunAt;
  }

  // ========================================
  // Manual trigger (bypasses reschedule)
  // ========================================

  /**
   * Run a task schedule immediately, without affecting `nextRunAt` or
   * `executionCount`. Used by the `POST /api/tasks/:id/trigger` route
   * (Phase 4) and the `tasks_trigger_now` tool (Phase 5).
   *
   * Returns the new history row's ID so the caller can show progress.
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

    // Load the same agents a scheduled run would use.
    let taskAssignedAgents = await this.deps.taskAgentsRepo.listByTask(task.id);
    if (taskAssignedAgents.length === 0) {
      const fallbackId = this.deps.defaultAgentIdProvider();
      if (fallbackId) {
        taskAssignedAgents = [
          {
            taskId: task.id,
            agentId: fallbackId,
            role: 'primary',
            assignedAt: new Date(),
          },
        ];
      }
    }

    const payload: TaskSchedulePayload = {
      schedule,
      taskTitle: task.title,
      taskDescription: task.description,
      taskAssignedAgents,
      currentDescriptionHash: hashDescription(task.description),
    };

    // We create the history row up front so the caller can poll its
    // status, but we do NOT call reschedule() afterwards — the schedule
    // row's `nextRunAt` and `executionCount` are preserved.
    const history = await this.deps.taskExecutionHistoryRepo.create({
      taskId: task.id,
      scheduleId: schedule.id,
      taskTitle: task.title,
      taskDescription: task.description,
      attemptNumber: schedule.executionCount + 1,
    });

    const result = await this.execute(schedule.id, payload);
    return {
      ok: result.ok,
      historyId: history.id,
      ...(result.ok ? {} : { error: result.error.message }),
    };
  }
}
