import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
  pgEnum,
  primaryKey,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { sessions } from './sessions';

/**
 * Task status enum
 * - backlog: Not yet ready to work on
 * - todo: Ready to be picked up
 * - in_progress: Currently being worked on
 * - review: Awaiting review
 * - done: Completed successfully
 * - cancelled: Cancelled before completion
 */
export const taskStatusEnum = pgEnum('task_status', [
  'backlog',
  'todo',
  'in_progress',
  'review',
  'done',
  'cancelled',
]);

/**
 * Task priority enum
 */
export const taskPriorityEnum = pgEnum('task_priority', [
  'low',
  'medium',
  'high',
  'urgent',
]);

/**
 * Planning status enum
 * - pending: Planning not yet started
 * - in_progress: Planning agent is working
 * - completed: Planning finished, subtasks created
 * - failed: Planning failed
 */
export const planningStatusEnum = pgEnum('planning_status', [
  'pending',
  'in_progress',
  'completed',
  'failed',
]);

/**
 * Tasks table
 *
 * Main entity for the Kanban-style task management system.
 * Tasks can optionally use a planning agent to decompose into subtasks.
 */
export const tasks = pgTable(
  'tasks',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => nanoid()),
    title: text('title').notNull(),
    description: text('description').notNull(),
    status: taskStatusEnum('status').notNull().default('backlog'),
    priority: taskPriorityEnum('priority').notNull().default('medium'),
    planningEnabled: boolean('planning_enabled').notNull().default(false),
    planningStatus: planningStatusEnum('planning_status'),
    sessionId: text('session_id').references(() => sessions.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    sessionIdIdx: index('tasks_session_id_idx').on(table.sessionId),
  }),
);

/**
 * Subtask status enum
 * - pending: Created but not assigned
 * - assigned: Assigned to an agent
 * - in_progress: Agent is working on it
 * - completed: Successfully completed
 * - failed: Execution failed
 */
export const subtaskStatusEnum = pgEnum('subtask_status', [
  'pending',
  'assigned',
  'in_progress',
  'completed',
  'failed',
]);

/**
 * Subtasks table
 *
 * Subtasks are created by the planning agent or manually.
 * Dependencies between subtasks are modeled as a graph via the
 * `subtaskEdges` table below, not as a column on this table — a
 * subtask can depend on multiple upstream subtasks.
 */
export const subtasks = pgTable(
  'subtasks',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => nanoid()),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description').notNull(),
    status: subtaskStatusEnum('status').notNull().default('pending'),
    assignedAgentId: text('assigned_agent_id'),
    sessionId: text('session_id').references(() => sessions.id, {
      onDelete: 'set null',
    }),
    orderIndex: integer('order_index').notNull().default(0),
    result: text('result'),
    retryCount: integer('retry_count').notNull().default(0),
    // Stores the subtask result temporarily while awaiting verification
    pendingVerificationResult: text('pending_verification_result'),
    // 'agent' runs a normal LLM session; 'approval_gate' pauses execution
    // until a human resolves it via the API/UI (see awaitingApprovalSince).
    subtaskKind: text('subtask_kind').notNull().default('agent'),
    // Bounded single-subtask loop: when loopMaxIterations is set, this
    // subtask re-runs itself (see loopIterationCount) until its own result
    // satisfies loopConditionOperator/loopConditionValue, or the iteration
    // cap is hit and it fails. Null loopMaxIterations means "not a loop".
    loopMaxIterations: integer('loop_max_iterations'),
    loopConditionOperator: text('loop_condition_operator'),
    loopConditionValue: text('loop_condition_value'),
    loopIterationCount: integer('loop_iteration_count').notNull().default(0),
    loopLastResult: text('loop_last_result'),
    // Non-null = paused, awaiting a human decision (mirrors
    // pendingVerificationResult's side-channel-column pattern; not a
    // status enum value, since `status` stays 'in_progress' while paused).
    awaitingApprovalSince: timestamp('awaiting_approval_since', {
      withTimezone: true,
    }),
    approvalDecision: text('approval_decision'),
    approvalNote: text('approval_note'),
    approvedBy: text('approved_by'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    sessionIdIdx: index('subtasks_session_id_idx').on(table.sessionId),
    awaitingApprovalIdx: index('subtasks_awaiting_approval_idx')
      .on(table.awaitingApprovalSince)
      .where(sql`${table.awaitingApprovalSince} IS NOT NULL`),
  }),
);

/**
 * Subtask edges table
 *
 * Models subtask dependencies as a graph: a row means `subtaskId`
 * depends on `dependsOnSubtaskId` and cannot start until it completes.
 * A subtask may have multiple incoming edges (fan-in). `edgeKind`
 * defaults to `'dependency'` and exists so future edge types (e.g. a
 * loop-back edge for a visual workflow builder) can be added without
 * another schema migration.
 */
export const subtaskEdges = pgTable(
  'subtask_edges',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => nanoid()),
    subtaskId: text('subtask_id')
      .notNull()
      .references(() => subtasks.id, { onDelete: 'cascade' }),
    dependsOnSubtaskId: text('depends_on_subtask_id')
      .notNull()
      .references(() => subtasks.id, { onDelete: 'cascade' }),
    edgeKind: text('edge_kind').notNull().default('dependency'),
    // Set only when edgeKind === 'conditional': the edge is only
    // satisfied when evaluateCondition(dependency.result, {conditionOperator,
    // conditionValue}) is true, in addition to the dependency being
    // 'completed'. Null for plain 'dependency' edges.
    conditionOperator: text('condition_operator'),
    conditionValue: text('condition_value'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    subtaskIdIdx: index('subtask_edges_subtask_id_idx').on(table.subtaskId),
    uniqueEdgeIdx: uniqueIndex('subtask_edges_unique_idx').on(
      table.subtaskId,
      table.dependsOnSubtaskId,
    ),
    // A subtask can never depend on itself — that would deadlock it
    // forever. Cycles across multiple edges (A -> B -> A) are not
    // caught here; they're guarded against at the application layer
    // where the full graph is available.
    noSelfEdge: check(
      'subtask_edges_no_self_edge',
      sql`${table.subtaskId} <> ${table.dependsOnSubtaskId}`,
    ),
    validEdgeKind: check(
      'subtask_edges_kind_check',
      sql`${table.edgeKind} IN ('dependency', 'conditional')`,
    ),
    conditionRequiredForConditional: check(
      'subtask_edges_condition_required_check',
      sql`${table.edgeKind} <> 'conditional' OR (${table.conditionOperator} IS NOT NULL AND ${table.conditionValue} IS NOT NULL)`,
    ),
  }),
);

/**
 * Agent role enum
 * - primary: Main agent responsible
 * - secondary: Supporting agent
 * - reviewer: Reviewing agent
 */
export const agentRoleEnum = pgEnum('agent_role', [
  'primary',
  'secondary',
  'reviewer',
]);

/**
 * Task agents junction table
 *
 * Links agents to tasks with role designation.
 * Uses composite primary key (taskId, agentId).
 */
export const taskAgents = pgTable(
  'task_agents',
  {
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    agentId: text('agent_id').notNull(),
    role: agentRoleEnum('role').notNull().default('primary'),
    assignedAt: timestamp('assigned_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.taskId, table.agentId] }),
  }),
);

// Type exports
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type Subtask = typeof subtasks.$inferSelect;
export type NewSubtask = typeof subtasks.$inferInsert;
export type SubtaskEdge = typeof subtaskEdges.$inferSelect;
export type NewSubtaskEdge = typeof subtaskEdges.$inferInsert;
export type TaskAgent = typeof taskAgents.$inferSelect;
export type NewTaskAgent = typeof taskAgents.$inferInsert;
export type TaskSchedule = typeof taskSchedules.$inferSelect;
export type NewTaskSchedule = typeof taskSchedules.$inferInsert;
export type TaskExecutionHistoryRow = typeof taskExecutionHistory.$inferSelect;
export type NewTaskExecutionHistoryRow =
  typeof taskExecutionHistory.$inferInsert;

// Enum type exports
export type TaskStatus = (typeof taskStatusEnum.enumValues)[number];
export type TaskPriority = (typeof taskPriorityEnum.enumValues)[number];
export type PlanningStatus = (typeof planningStatusEnum.enumValues)[number];
export type SubtaskStatus = (typeof subtaskStatusEnum.enumValues)[number];
export type AgentRole = (typeof agentRoleEnum.enumValues)[number];
export type TaskScheduleStatus =
  (typeof taskScheduleStatusEnum.enumValues)[number];
export type ReplanPolicy =
  (typeof taskScheduleReplanPolicyEnum.enumValues)[number];
export type TaskExecutionHistoryStatus =
  (typeof taskExecutionHistoryStatusEnum.enumValues)[number];

/**
 * Task schedule status enum
 * - active:   schedule is firing on its cron/preset
 * - paused:   user paused the schedule, do not fire
 * - expired:  schedule reached maxExecutions or finished a one-shot; terminal
 */
export const taskScheduleStatusEnum = pgEnum('task_schedule_status', [
  'active',
  'running',
  'paused',
  'expired',
]);

/**
 * Replan policy enum (recurring-tasks)
 * - never:                  default; reuse existing subtasks across runs (cheap)
 * - on-description-change:  re-invoke planning agent only when description hash differs
 * - always:                 re-invoke planning agent on every run (expensive, opt-in)
 */
export const taskScheduleReplanPolicyEnum = pgEnum(
  'task_schedule_replan_policy',
  ['never', 'on-description-change', 'always'],
);

/**
 * Task execution history status enum
 * - planned:    history row created at the start of a run, before session exists
 * - planning:   planning agent is running (only set when replan policy triggers)
 * - executing:  agents are running on subtasks or the description
 * - verifying:  work was submitted, waiting on RunEventEmitter to confirm
 * - completed:  run finished successfully
 * - failed:     run finished with an error
 */
export const taskExecutionHistoryStatusEnum = pgEnum(
  'task_execution_history_status',
  ['planned', 'planning', 'executing', 'verifying', 'completed', 'failed'],
);

/**
 * Task schedules table
 *
 * 1-to-1 with `tasks`. Stores the schedule definition and polling state
 * for recurring tasks. The scheduler polls `nextRunAt` like `scheduled_jobs`,
 * but the executor (Phase 2) implements the `ScheduledRunnable` interface
 * to claim and execute these rows.
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
    // The schedule definition. Exactly one of (cronExpression, preset,
    // scheduleDate) is set. The parser (parseScheduleInput) is responsible
    // for normalising whichever form the user provided.
    cronExpression: text('cron_expression'),
    preset: text('preset'), // '15m' | '30m' | '1h' | '6h' | '12h' | '1d' | '1w' | NULL
    scheduleDate: timestamp('schedule_date', { withTimezone: true }),
    // Polling state
    nextRunAt: timestamp('next_run_at', { withTimezone: true }).notNull(),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    status: taskScheduleStatusEnum('status').notNull().default('active'),
    // Execution behaviour
    replanPolicy: taskScheduleReplanPolicyEnum('replan_policy')
      .notNull()
      .default('never'),
    // maxExecutions is ALWAYS finite — there is no "infinite" option.
    // Default 9999: most users will never hit it.
    maxExecutions: integer('max_executions').notNull().default(9999),
    executionCount: integer('execution_count').notNull().default(0),
    // SHA-256 of the task's description from the most recent run. Used by
    // the 'on-description-change' policy to decide whether to replan. NULL
    // until the first run completes (the executor sets it in reschedule).
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

/**
 * Task execution history table
 *
 * One row per run of a recurring task. The executor (Phase 2) writes
 * a row at the start of each run and updates its status as the run
 * progresses. Rows are append-only — the schedule row holds the
 * aggregate state (lastRunAt, executionCount, descriptionHash).
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
    // Lifecycle
    status: taskExecutionHistoryStatusEnum('status')
      .notNull()
      .default('planned'),
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    durationMs: integer('duration_ms'),
    // The session created for this run (set during execute, not at create time)
    sessionId: text('session_id').references(() => sessions.id, {
      onDelete: 'set null',
    }),
    // Snapshot of the task at run time. Useful for history even if the
    // task title/description changes later.
    taskTitle: text('task_title').notNull(),
    taskDescription: text('task_description').notNull(),
    // Whether this run invoked the planning agent (replan happened)
    didReplan: boolean('did_replan').notNull().default(false),
    // Error info (set on status='failed')
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    // Attempt number within this run (1 for the initial run, 2+ for retries).
    // Recurring tasks don't auto-retry on failure — the schedule will
    // just fire again at the next cron tick — but the field is here for
    // forward compatibility with one-off retry logic.
    attemptNumber: integer('attempt_number').notNull().default(1),
    // Snapshot of subtask statuses when the run completed. JSON string
    // (SubtaskSummary). Null for tasks without planning or runs that
    // haven't finished yet. Because subtasks are reset between runs,
    // without this snapshot historical runs would have no subtask data.
    subtaskSummary: text('subtask_summary'),
    // Audit
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    taskIdIdx: index('task_execution_history_task_id_idx').on(table.taskId),
    scheduleIdIdx: index('task_execution_history_schedule_id_idx').on(
      table.scheduleId,
    ),
    sessionIdIdx: index('task_execution_history_session_id_idx').on(
      table.sessionId,
    ),
    startedAtIdx: index('task_execution_history_started_at_idx').on(
      table.startedAt,
    ),
  }),
);
