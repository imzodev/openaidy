import type { ExecutionSubtaskSummary } from './task-schedules.js';

// ========================================
// Task Type Values (shared between types and runtime)
// ========================================

export const TASK_STATUS_VALUES = [
  'backlog',
  'todo',
  'in_progress',
  'review',
  'done',
  'cancelled',
] as const;

export const TASK_PRIORITY_VALUES = [
  'low',
  'medium',
  'high',
  'urgent',
] as const;

export const SUBTASK_STATUS_VALUES = [
  'pending',
  'assigned',
  'in_progress',
  'completed',
  'failed',
  'skipped',
] as const;

export const WORKFLOW_RUN_STATUS_VALUES = [
  'running',
  'completed',
  'failed',
  'cancelled',
] as const;

export const WORKFLOW_RUN_TRIGGER_VALUES = [
  'manual',
  'schedule',
  'agent',
  'webhook',
  'channel',
] as const;

export const SUBTASK_KIND_VALUES = ['agent', 'approval_gate'] as const;

export const CONDITION_OPERATOR_VALUES = [
  'equals',
  'contains',
  'matches_regex',
] as const;

export const AGENT_ROLE_VALUES = ['primary', 'secondary', 'reviewer'] as const;

export const PLANNING_STATUS_VALUES = [
  'pending',
  'in_progress',
  'completed',
  'failed',
] as const;

export const TASK_DETAIL_VIEW_VALUES = ['detail', 'executions'] as const;

// ========================================
// Task Types
// ========================================

/**
 * Task status — Kanban column
 */
export type TaskStatus = (typeof TASK_STATUS_VALUES)[number];

/**
 * Task priority
 */
export type TaskPriority = (typeof TASK_PRIORITY_VALUES)[number];

/**
 * Planning agent status
 */
export type PlanningStatus = (typeof PLANNING_STATUS_VALUES)[number];

/**
 * Subtask status
 */
export type SubtaskStatus = (typeof SUBTASK_STATUS_VALUES)[number];

/**
 * Subtask kind — 'agent' runs a normal LLM session; 'approval_gate'
 * pauses execution until a human resolves it via the API/UI.
 */
export type SubtaskKind = (typeof SUBTASK_KIND_VALUES)[number];

/**
 * How a conditional edge's condition is evaluated against the
 * upstream dependency's result (or its `OUTCOME: <tag>` line).
 */
export type ConditionOperator = (typeof CONDITION_OPERATOR_VALUES)[number];

/**
 * Agent role on a task
 */
export type AgentRole = (typeof AGENT_ROLE_VALUES)[number];

/**
 * Which sub-view of the Tasks page's task-detail overlay is showing —
 * the task's own detail panel, or its recurring-execution history.
 */
export type TaskDetailView = (typeof TASK_DETAIL_VIEW_VALUES)[number];

/**
 * Task with full details (returned by GET /tasks/:id)
 */
export type TaskWithDetails = {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  planningEnabled: boolean;
  planningStatus: PlanningStatus | null;
  sessionId: string | null;
  agents: TaskAgentInfo[];
  progress: {
    total: number;
    completed: number;
    inProgress: number;
    failed: number;
  };
  createdAt: string;
  updatedAt: string;
};

/**
 * Task agent assignment info
 */
export type TaskAgentInfo = {
  agentId: string;
  role: AgentRole;
  assignedAt: string;
};

/**
 * Input for creating a task
 */
export type CreateTaskInput = {
  title?: string;
  description: string;
  priority?: TaskPriority;
  planningEnabled?: boolean;
  agents?: Array<{ agentId: string; role?: AgentRole }>;
};

/**
 * Input for updating a task (partial)
 */
export type UpdateTaskInput = {
  title?: string;
  description?: string;
  priority?: TaskPriority;
  planningEnabled?: boolean;
};

/**
 * Kanban board — tasks grouped by status
 */
export type KanbanBoard = Record<
  TaskStatus,
  Array<{
    id: string;
    title: string;
    priority: TaskPriority;
    planningEnabled: boolean;
    agentCount: number;
  }>
>;

/**
 * A conditional edge's condition, evaluated against the upstream
 * dependency's result (see ConditionOperator).
 */
export type EdgeCondition = {
  operator: ConditionOperator;
  value: string;
};

/**
 * Bounded single-subtask loop config: the subtask re-runs itself up
 * to maxIterations times until its own result satisfies the
 * condition, or fails once iterations are exhausted.
 */
export type LoopConfig = {
  maxIterations: number;
  conditionOperator: ConditionOperator;
  conditionValue: string;
};

/**
 * One node to seed into a task's subtask graph via `buildSubtaskGraph`.
 * `key` is a caller-local identifier (not a real subtask id) used to wire
 * up `GraphEdgeInput`s; it's resolved to a real subtask id as the graph is
 * built. Shared by the AI auto-planner and the workflow-template applier.
 */
export type GraphNodeInput = {
  key: string;
  title: string;
  description: string;
  orderIndex?: number;
  assignedAgentId?: string;
  subtaskKind?: SubtaskKind;
  loop?: LoopConfig | null;
};

/**
 * One dependency edge to seed into a task's subtask graph via
 * `buildSubtaskGraph`, referencing `GraphNodeInput.key` values rather than
 * real subtask ids.
 */
export type GraphEdgeInput = {
  subtaskKey: string;
  dependsOnKey: string;
  edgeKind?: 'dependency' | 'conditional';
  conditionOperator?: ConditionOperator;
  conditionValue?: string;
};

/**
 * A subtask dependency-graph edge, as returned by the edge-CRUD API.
 */
export type SubtaskEdgeDto = {
  id: string;
  subtaskId: string;
  dependsOnSubtaskId: string;
  edgeKind: 'dependency' | 'conditional';
  condition: EdgeCondition | null;
  createdAt: string;
};

/**
 * Subtask with details
 */
export type SubtaskWithDetails = {
  id: string;
  taskId: string;
  title: string;
  description: string;
  status: SubtaskStatus;
  assignedAgentId: string | null;
  /** IDs of subtasks this one depends on; it won't start until all of them complete. */
  dependsOnSubtaskIds: string[];
  result: string | null;
  retryCount: number;
  subtaskKind?: SubtaskKind;
  loop?: LoopConfig | null;
  loopIterationCount?: number;
  loopLastResult?: string | null;
  awaitingApprovalSince?: string | null;
  approvalDecision?: 'approved' | 'rejected' | null;
  approvalNote?: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * Subtask summary (used in list responses)
 */
export type SubtaskSummary = {
  id: string;
  taskId: string;
  title: string;
  status: SubtaskStatus;
  assignedAgentId: string | null;
  /** IDs of subtasks this one depends on; it won't start until all of them complete. */
  dependsOnSubtaskIds: string[];
  result: string | null;
  retryCount: number;
  subtaskKind?: SubtaskKind;
  loop?: LoopConfig | null;
  loopIterationCount?: number;
  loopLastResult?: string | null;
  awaitingApprovalSince?: string | null;
  approvalDecision?: 'approved' | 'rejected' | null;
  approvalNote?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WorkflowRunStatus = (typeof WORKFLOW_RUN_STATUS_VALUES)[number];
export type WorkflowRunTrigger = (typeof WORKFLOW_RUN_TRIGGER_VALUES)[number];

/**
 * WebSocket event sent to authenticated clients whenever a workflow run
 * or one of its steps changes. Clients refetch the workflow's steps and
 * runs; the payload only says which workflow changed.
 */
export const WORKFLOW_UPDATED_EVENT = 'workflow.updated';

/** An approval gate waiting for a person's decision. */
export type PendingApprovalDto = {
  subtaskId: string;
  title: string;
  description: string;
  taskId: string;
  taskTitle: string;
  /** ISO time the gate started waiting. */
  since: string;
};
export type WorkflowUpdatedPayload = { taskId: string };

/**
 * One execution of a workflow (a task's subtask graph).
 */
export type WorkflowRunDto = {
  id: string;
  taskId: string;
  trigger: WorkflowRunTrigger;
  status: WorkflowRunStatus;
  sessionId: string | null;
  /** Why the run failed (first failing step), or null. */
  error: string | null;
  /** How each step ended; null while the run is still going. */
  summary: ExecutionSubtaskSummary | null;
  /** What started the run (webhook body, channel message…), if anything. */
  input: string | null;
  startedAt: string;
  finishedAt: string | null;
};

// ========================================
// Workflow triggers
// ========================================

export const WORKFLOW_TRIGGER_KIND_VALUES = [
  'webhook',
  'channel_message',
] as const;

export type WorkflowTriggerKind = (typeof WORKFLOW_TRIGGER_KIND_VALUES)[number];

export const MESSAGE_MATCH_TYPE_VALUES = [
  'any',
  'equals',
  'starts_with',
  'contains',
  'regex',
] as const;

export type MessageMatchType = (typeof MESSAGE_MATCH_TYPE_VALUES)[number];

/** Settings of a trigger that starts a run from a channel message. */
export type ChannelMessageTriggerConfig = {
  /** Channel id from the `channels` config (e.g. a WhatsApp channel). */
  channelId: string;
  /** Which messages start the run (case-insensitive). */
  match: { type: MessageMatchType; value?: string };
  /** Only these senders (phone numbers / user ids); empty = anyone the
   * channel already accepts. */
  senders?: string[];
  /** Send the workflow's result back to the chat when the run ends. */
  replyWithResult: boolean;
  /** Reply sent right away; default "On it — running <workflow>." */
  ackText?: string;
};

export type WorkflowTriggerDto = {
  id: string;
  taskId: string;
  /** The workflow's title, for lists spanning workflows. */
  taskTitle?: string;
  kind: WorkflowTriggerKind;
  name: string;
  enabled: boolean;
  /** Channel triggers only. */
  channel?: ChannelMessageTriggerConfig;
  /** Webhook triggers only: the path to POST to (under the server URL). */
  webhookPath?: string;
  lastFiredAt: string | null;
  createdAt: string;
};

/** Returned once when a webhook is created or its token regenerated. */
export type WebhookTokenDto = {
  trigger: WorkflowTriggerDto;
  /** Send as `Authorization: Bearer <token>` or `?token=<token>`. Not stored. */
  token: string;
};

/**
 * Input for completing a subtask
 */
export type CompleteSubtaskInput = {
  result?: string;
};

/**
 * Input for failing a subtask
 */
export type FailSubtaskInput = {
  reason?: string;
};
