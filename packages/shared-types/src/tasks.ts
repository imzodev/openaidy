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
