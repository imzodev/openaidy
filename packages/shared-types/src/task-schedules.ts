/**
 * DTOs for the recurring-tasks feature.
 *
 * These types are the public API surface — used by the REST routes
 * (Phase 4), the agent-facing tools (Phase 5), and the web UI (Phase 6).
 * They're decoupled from Drizzle's `$inferSelect` so the API contract
 * stays stable even if the underlying schema evolves.
 *
 * @see docs/recurring-tasks/recurring-tasks-phase-1-schema-repository.md
 */

import type { ScheduleInput } from './pulses.js';

/**
 * Preset values for the `every` variant of ScheduleInput.
 * Re-exported here for convenience so callers don't have to import from
 * `pulses.ts` just to type-check a schedule.
 */
export type SchedulePreset = '15m' | '30m' | '1h' | '6h' | '12h' | '1d' | '1w';

/**
 * Replan policy values.
 *
 * - `never` (default): reuse existing subtasks across runs; cheap.
 * - `on-description-change`: re-invoke the planning agent only when
 *   the task's description has been edited since the last run.
 *   The executor compares SHA-256 hashes.
 * - `always`: re-invoke the planning agent on every run, ignoring
 *   the description. Expensive, opt-in.
 */
export type ReplanPolicy = 'never' | 'on-description-change' | 'always';

/**
 * Status of a task schedule row.
 *
 * - `active`:  schedule is firing on its cron/preset
 * - `paused`:  user paused the schedule; scheduler skips it
 * - `expired`: terminal — schedule reached `maxExecutions` or finished
 *              a one-shot. The executor transitions to this state.
 */
export type TaskScheduleStatus = 'active' | 'running' | 'paused' | 'expired';

/**
 * Status of a single execution history row.
 *
 * - `planned`:    row created at the start of a run, before a session exists
 * - `planning`:   planning agent is running (only when replan policy triggered)
 * - `executing`:  agents are running on subtasks or the description
 * - `verifying`:  work was submitted, waiting on RunEventEmitter
 * - `completed`:  run finished successfully
 * - `failed`:     run finished with an error
 */
export type TaskExecutionHistoryStatus =
  | 'planned'
  | 'planning'
  | 'executing'
  | 'verifying'
  | 'completed'
  | 'failed';

/**
 * A task schedule as returned by the API.
 *
 * Dates are ISO 8601 strings (not Date objects) because the public API
 * serialises them as JSON. The server-side DTO mapper converts from
 * the DB's `Date` columns.
 */
export type TaskScheduleDto = {
  id: string;
  taskId: string;
  /** The original input that produced this schedule. */
  schedule: ScheduleInput;
  /** Normalised cron form, if applicable. */
  cronExpression: string | null;
  /** Preset string for UI display ('Every 15m'), or null. */
  preset: SchedulePreset | null;
  /** ISO 8601 — only set for one-shots. */
  scheduleDate: string | null;
  nextRunAt: string;
  lastRunAt: string | null;
  status: TaskScheduleStatus;
  replanPolicy: ReplanPolicy;
  /** ALWAYS finite (default 9999). No "infinite" option. */
  maxExecutions: number;
  /** maxExecutions - executionCount. Computed for the UI. */
  remainingExecutions: number;
  executionCount: number;
  /** Human-readable description ('Every day at 9am'). */
  scheduleHuman: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * Snapshot of a single subtask's status at the time a run completed.
 * Used in {@link ExecutionSubtaskSummary}.
 */
export type ExecutionSubtaskSummaryItem = {
  id: string;
  title: string;
  status: string;
  sessionId: string | null;
};

/**
 * JSON snapshot of all subtask statuses when a recurring run
 * completed. Stored in `task_execution_history.subtask_summary`
 * because subtasks are reset between runs — without this snapshot,
 * historical runs would have no subtask data.
 */
export type ExecutionSubtaskSummary = {
  total: number;
  completed: number;
  failed: number;
  inProgress: number;
  pending: number;
  items: ExecutionSubtaskSummaryItem[];
};

/**
 * A single execution history row as returned by the API.
 */
export type TaskExecutionHistoryDto = {
  id: string;
  taskId: string;
  scheduleId: string;
  status: TaskExecutionHistoryStatus;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  sessionId: string | null;
  attemptNumber: number;
  didReplan: boolean;
  taskTitle: string;
  taskDescription: string;
  errorCode: string | null;
  errorMessage: string | null;
  /** JSON snapshot of subtask statuses when the run completed, or null. */
  subtaskSummary: ExecutionSubtaskSummary | null;
  createdAt: string;
};

/**
 * Input for creating a new task schedule.
 *
 * Used by POST /api/tasks (when the body has a `schedule` field) and
 * by the `tasks_create` tool.
 */
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
   * Maximum number of times the schedule will fire.
   * Defaults to 9999 when omitted. Must be a positive integer.
   * There is no "infinite" option.
   */
  maxExecutions?: number;
};

/**
 * Input for updating an existing task schedule.
 *
 * All fields are optional. A field not present is left unchanged.
 */
export type UpdateTaskScheduleInput = {
  schedule?: ScheduleInput;
  /** Pause or resume. Other status transitions are not user-facing. */
  status?: 'active' | 'paused';
  replanPolicy?: ReplanPolicy;
  /**
   * New cap on the number of executions. Must be a positive integer.
   * Cannot be unset to "infinite" — supply a new finite value instead.
   */
  maxExecutions?: number;
};

/**
 * Filters for listing task execution history.
 */
export type ListTaskExecutionsFilters = {
  status?: TaskExecutionHistoryStatus;
  scheduleId?: string;
  limit: number;
  offset: number;
};

/**
 * Paginated list response for execution history.
 */
export type PaginatedTaskExecutions = {
  executions: TaskExecutionHistoryDto[];
  total: number;
  limit: number;
  offset: number;
};
