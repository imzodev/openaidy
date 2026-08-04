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

export const AGENT_ROLE_VALUES = ['primary', 'secondary', 'reviewer'] as const;

export const PLANNING_STATUS_VALUES = [
  'pending',
  'in_progress',
  'completed',
  'failed',
] as const;

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
 * Agent role on a task
 */
export type AgentRole = (typeof AGENT_ROLE_VALUES)[number];

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
