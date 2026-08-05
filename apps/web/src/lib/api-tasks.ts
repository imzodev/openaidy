/**
 * API client for task endpoints
 */

import { API_BASE } from './api';
import { getStoredToken } from './auth-token';
import type {
  ScheduleInput,
  ReplanPolicy,
  TaskScheduleDto,
  TaskExecutionHistoryDto,
  CreateTaskScheduleInput,
} from './types';

type TaskSchedule = TaskScheduleDto;
type TaskExecutionHistoryItem = TaskExecutionHistoryDto;

function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const token = getStoredToken();
  const authHeader: Record<string, string> = token
    ? { Authorization: `Bearer ${token}` }
    : {};
  return fetch(input, {
    ...init,
    headers: {
      ...authHeader,
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
}

/**
 * Task status
 */
export type TaskStatus =
  | 'backlog'
  | 'todo'
  | 'in_progress'
  | 'review'
  | 'done'
  | 'cancelled';

/**
 * Task priority
 */
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

/**
 * Planning status
 */
export type PlanningStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

/**
 * Agent role
 */
export type AgentRole = 'primary' | 'secondary' | 'reviewer';

/**
 * Task record
 */
export type Task = {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  planningEnabled: boolean;
  planningStatus: PlanningStatus | null;
  sessionId?: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * Task agent assignment
 */
export type TaskAgent = {
  taskId: string;
  agentId: string;
  role: AgentRole;
  assignedAt: string;
};

/**
 * Subtask status
 */
export type SubtaskStatus =
  | 'pending'
  | 'assigned'
  | 'in_progress'
  | 'completed'
  | 'failed';

/**
 * Subtask kind — 'agent' runs a normal LLM session; 'approval_gate'
 * pauses execution until a human resolves it via the approval UI.
 */
export type SubtaskKind = 'agent' | 'approval_gate';

/**
 * How a conditional edge's condition is evaluated against the
 * upstream dependency's result (or its `OUTCOME: <tag>` line).
 */
export type ConditionOperator = 'equals' | 'contains' | 'matches_regex';

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
 * Subtask record
 */
export type Subtask = {
  id: string;
  taskId: string;
  /** IDs of subtasks this one depends on; it won't start until all of them complete. */
  dependsOnSubtaskIds: string[];
  title: string;
  description: string;
  status: SubtaskStatus;
  assignedAgentId: string | null;
  sessionId?: string | null;
  orderIndex: number;
  result: string | null;
  subtaskKind?: SubtaskKind;
  loopMaxIterations?: number | null;
  loopConditionOperator?: ConditionOperator | null;
  loopConditionValue?: string | null;
  loopIterationCount?: number;
  loopLastResult?: string | null;
  awaitingApprovalSince?: string | null;
  approvalDecision?: 'approved' | 'rejected' | null;
  approvalNote?: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * Task with details
 */
export type TaskWithDetails = Task & {
  agents: TaskAgent[];
  subtasks: Subtask[];
  progress: {
    total: number;
    completed: number;
    inProgress: number;
    failed: number;
  };
};

/**
 * Kanban board - tasks grouped by status
 */
export type KanbanBoard = {
  [K in TaskStatus]: Task[];
};

/**
 * Create task input.
 *
 * `schedule` uses the same `CreateTaskScheduleInput` shape as the
 * dedicated `POST /api/tasks/:taskId/schedule` endpoint. The server
 * expects an envelope, not the bare `ScheduleInput` discriminated
 * union, so the `TaskModal` wraps the editor's `ScheduleInput` in
 * `{ schedule: ... }` before posting. See
 * `packages/shared-types/src/task-schedules.ts`.
 */
export type CreateTaskInput = {
  title?: string;
  description: string;
  priority?: TaskPriority;
  planningEnabled?: boolean;
  schedule?: CreateTaskScheduleInput;
  agents?: Array<{
    agentId: string;
    role?: AgentRole;
  }>;
};

/**
 * Update task input
 */
export type UpdateTaskInput = {
  title?: string;
  description?: string;
  priority?: TaskPriority;
};

/**
 * Create subtask input
 */
export type CreateSubtaskInput = {
  taskId: string;
  /** IDs of subtasks this one depends on; it won't start until all of them complete. */
  dependsOn?: string[];
  title: string;
  description: string;
  orderIndex?: number;
  assignedAgentId?: string;
  subtaskKind?: SubtaskKind;
  loop?: LoopConfig | null;
};

/**
 * API error type
 */
type ApiError = {
  ok: false;
  error: {
    code: string;
    message: string;
  };
};

/**
 * API success type
 */
type ApiSuccess<T> = {
  ok: true;
  data: T;
};

/**
 * API result type
 */
type ApiResult<T> = ApiSuccess<T> | ApiError;

/**
 * Fetch Kanban board (tasks grouped by status)
 */
export async function fetchTasksKanban(): Promise<KanbanBoard> {
  const response = await apiFetch(`${API_BASE}/api/tasks/kanban`);
  if (!response.ok) {
    throw new Error(`Failed to fetch kanban board: ${response.statusText}`);
  }
  return response.json();
}

/**
 * List all tasks
 */
export async function listTasks(
  status?: TaskStatus,
): Promise<{ items: Task[] }> {
  const url = status
    ? `${API_BASE}/api/tasks?status=${status}`
    : `${API_BASE}/api/tasks`;
  const response = await apiFetch(url);
  if (!response.ok) {
    throw new Error(`Failed to list tasks: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Get a task by ID with details
 */
export async function getTask(id: string): Promise<ApiResult<TaskWithDetails>> {
  const response = await apiFetch(`${API_BASE}/api/tasks/${id}`);
  return response.json();
}

/**
 * Create a new task
 */
export async function createTask(
  input: CreateTaskInput,
): Promise<ApiResult<Task>> {
  const response = await apiFetch(`${API_BASE}/api/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return response.json();
}

/**
 * Update a task
 */
export async function updateTask(
  id: string,
  input: UpdateTaskInput,
): Promise<ApiResult<Task>> {
  const response = await apiFetch(`${API_BASE}/api/tasks/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return response.json();
}

/**
 * Update task status
 */
export async function updateTaskStatus(
  id: string,
  status: TaskStatus,
): Promise<ApiResult<Task>> {
  const response = await apiFetch(`${API_BASE}/api/tasks/${id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  return response.json();
}

/**
 * Delete a task
 */
export async function deleteTask(id: string): Promise<ApiResult<true>> {
  const response = await apiFetch(`${API_BASE}/api/tasks/${id}`, {
    method: 'DELETE',
  });
  return response.json();
}

/**
 * Assign agents to a task
 */
export async function assignAgents(
  taskId: string,
  agents: Array<{ agentId: string; role?: AgentRole }>,
): Promise<ApiResult<TaskAgent[]>> {
  const response = await apiFetch(`${API_BASE}/api/tasks/${taskId}/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agents }),
  });
  return response.json();
}

/**
 * Remove an agent from a task
 */
export async function removeAgent(
  taskId: string,
  agentId: string,
): Promise<ApiResult<true>> {
  const response = await apiFetch(
    `${API_BASE}/api/tasks/${taskId}/agents/${agentId}`,
    {
      method: 'DELETE',
    },
  );
  return response.json();
}

/**
 * Get task progress
 */
export async function getTaskProgress(taskId: string): Promise<
  ApiResult<{
    total: number;
    completed: number;
    inProgress: number;
    failed: number;
    pending: number;
  }>
> {
  const response = await apiFetch(`${API_BASE}/api/tasks/${taskId}/progress`);
  return response.json();
}

/**
 * List subtasks for a task
 */
export async function listSubtasks(
  taskId: string,
): Promise<{ items: Subtask[] }> {
  const response = await apiFetch(`${API_BASE}/api/tasks/${taskId}/subtasks`);
  if (!response.ok) {
    throw new Error(`Failed to list subtasks: ${response.statusText}`);
  }
  const json = await response.json();
  return json.data ?? json;
}

/**
 * Create a subtask
 */
export async function createSubtask(
  input: CreateSubtaskInput,
): Promise<ApiResult<Subtask>> {
  const response = await apiFetch(
    `${API_BASE}/api/tasks/${input.taskId}/subtasks`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
  return response.json();
}

/**
 * Update subtask status
 */
export async function updateSubtaskStatus(
  id: string,
  status: SubtaskStatus,
): Promise<ApiResult<Subtask>> {
  const response = await apiFetch(`${API_BASE}/api/subtasks/${id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  return response.json();
}

/**
 * Edit a subtask's title/description/order/kind/loop-config after planning.
 */
export async function updateSubtask(
  id: string,
  updates: {
    title?: string;
    description?: string;
    orderIndex?: number;
    subtaskKind?: SubtaskKind;
    loop?: LoopConfig | null;
  },
): Promise<ApiResult<Subtask>> {
  const response = await apiFetch(`${API_BASE}/api/subtasks/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  return response.json();
}

/**
 * Delete a subtask. Used by the workflow editor to remove nodes.
 */
export async function deleteSubtask(id: string): Promise<ApiResult<true>> {
  const response = await apiFetch(`${API_BASE}/api/subtasks/${id}`, {
    method: 'DELETE',
  });
  return response.json();
}

/**
 * Resolve a paused approval-gate subtask with a human decision.
 */
export async function resolveApproval(
  subtaskId: string,
  decision: 'approved' | 'rejected',
  note?: string,
): Promise<ApiResult<Subtask>> {
  const response = await apiFetch(
    `${API_BASE}/api/subtasks/${subtaskId}/approval/resolve`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision, note }),
    },
  );
  return response.json();
}

// ── Subtask dependency-graph edges ────────────────────────────────────────────

/**
 * List all dependency-graph edges for a task's subtasks.
 */
export async function listSubtaskEdges(
  taskId: string,
): Promise<{ items: SubtaskEdgeDto[] }> {
  const response = await apiFetch(
    `${API_BASE}/api/tasks/${taskId}/subtask-edges`,
  );
  if (!response.ok) {
    throw new Error(`Failed to list subtask edges: ${response.statusText}`);
  }
  const json = await response.json();
  return json.data ?? json;
}

/**
 * Create a dependency-graph edge (plain dependency or conditional).
 */
export async function createSubtaskEdge(
  taskId: string,
  input: {
    subtaskId: string;
    dependsOnSubtaskId: string;
    edgeKind?: 'dependency' | 'conditional';
    condition?: EdgeCondition | null;
  },
): Promise<ApiResult<SubtaskEdgeDto>> {
  const response = await apiFetch(
    `${API_BASE}/api/tasks/${taskId}/subtask-edges`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
  return response.json();
}

/**
 * Update an edge's kind/condition (e.g. converting a plain dependency
 * edge to a conditional one, or vice versa).
 */
export async function updateSubtaskEdge(
  edgeId: string,
  input: {
    edgeKind?: 'dependency' | 'conditional';
    condition?: EdgeCondition | null;
  },
): Promise<ApiResult<SubtaskEdgeDto>> {
  const response = await apiFetch(`${API_BASE}/api/subtask-edges/${edgeId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return response.json();
}

/**
 * Delete a dependency-graph edge.
 */
export async function deleteSubtaskEdge(
  edgeId: string,
): Promise<ApiResult<true>> {
  const response = await apiFetch(`${API_BASE}/api/subtask-edges/${edgeId}`, {
    method: 'DELETE',
  });
  return response.json();
}

/**
 * (Re)assign an agent to a subtask.
 */
export async function assignSubtaskAgent(
  id: string,
  agentId: string,
): Promise<ApiResult<Subtask>> {
  const response = await apiFetch(`${API_BASE}/api/subtasks/${id}/assign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentId }),
  });
  return response.json();
}

/**
 * Execute a task (creates a session)
 */
export async function executeTask(
  taskId: string,
): Promise<ApiResult<{ sessionId: string }>> {
  const response = await apiFetch(`${API_BASE}/api/tasks/${taskId}/execute`, {
    method: 'POST',
  });
  return response.json();
}

/**
 * Execute a subtask (creates a session)
 */
export async function executeSubtask(
  subtaskId: string,
): Promise<ApiResult<{ sessionId: string }>> {
  const response = await apiFetch(
    `${API_BASE}/api/subtasks/${subtaskId}/execute`,
    {
      method: 'POST',
    },
  );
  return response.json();
}

/**
 * Get the session linked to a task
 */
export async function getTaskSession(
  taskId: string,
): Promise<ApiResult<{ sessionId: string | null }>> {
  const response = await apiFetch(`${API_BASE}/api/tasks/${taskId}/session`);
  return response.json();
}

/**
 * Complete a subtask manually
 */
export async function completeSubtask(
  subtaskId: string,
  result?: string,
): Promise<ApiResult<Subtask>> {
  const response = await apiFetch(
    `${API_BASE}/api/subtasks/${subtaskId}/complete`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ result }),
    },
  );
  return response.json();
}

/**
 * Get the session linked to a subtask
 */
export async function getSubtaskSession(
  subtaskId: string,
): Promise<ApiResult<{ sessionId: string | null }>> {
  const response = await apiFetch(
    `${API_BASE}/api/subtasks/${subtaskId}/session`,
  );
  return response.json();
}

/**
 * Plan a task (decompose into subtasks using AI)
 * Can be called again to re-plan even after initial planning
 */
export async function planTask(
  taskId: string,
): Promise<ApiResult<{ subtasks: Subtask[] }>> {
  const response = await apiFetch(`${API_BASE}/api/tasks/${taskId}/plan`, {
    method: 'POST',
  });
  return response.json();
}

/**
 * Re-plan a task - calls planTask again to regenerate subtasks
 * Useful when task requirements have changed or initial plan was inadequate
 */
export async function replanTask(
  taskId: string,
): Promise<ApiResult<{ subtasks: Subtask[] }>> {
  return planTask(taskId);
}

// ── Recurring Task Schedules ──────────────────────────────────────────────────
//
// All schedule-related types are re-exported from `./types` (which
// re-exports them from `@openaidy/shared-types`). Do NOT redeclare them
// here — the API contract and the web client share the same source.
export type {
  ScheduleInput,
  SchedulePreset,
  TaskScheduleStatus,
  ReplanPolicy,
  TaskScheduleDto as TaskSchedule,
  TaskExecutionHistoryStatus,
  TaskExecutionHistoryDto as TaskExecutionHistoryItem,
  UpdateTaskScheduleInput,
  ListTaskExecutionsFilters,
  PaginatedTaskExecutions,
} from './types';

/**
 * Get the schedule for a task. Returns null when no schedule exists.
 */
export async function getTaskSchedule(
  taskId: string,
): Promise<TaskSchedule | null> {
  const response = await apiFetch(`${API_BASE}/api/tasks/${taskId}/schedule`);
  if (response.status === 404) return null;
  if (!response.ok)
    throw new Error(`Failed to fetch task schedule: ${response.status}`);
  const json = await response.json();
  return json.schedule;
}

/**
 * Create or update a task schedule. Uses POST when no schedule exists,
 * PATCH when one already does.
 */
export async function createOrUpdateTaskSchedule(
  taskId: string,
  input: {
    schedule: ScheduleInput;
    maxExecutions?: number;
    replanPolicy?: ReplanPolicy;
    status?: 'active' | 'paused';
  },
): Promise<TaskSchedule> {
  const existing = await getTaskSchedule(taskId);
  const method = existing ? 'PATCH' : 'POST';
  const response = await apiFetch(`${API_BASE}/api/tasks/${taskId}/schedule`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(
      `Failed to ${existing ? 'update' : 'create'} task schedule: ${response.status}`,
    );
  }
  const json = await response.json();
  return json.schedule;
}

/**
 * Remove a task's schedule (DELETE, idempotent).
 */
export async function removeTaskSchedule(taskId: string): Promise<void> {
  const response = await apiFetch(`${API_BASE}/api/tasks/${taskId}/schedule`, {
    method: 'DELETE',
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Failed to remove schedule: ${response.status}`);
  }
}

/**
 * Pause a task schedule. Returns the updated schedule.
 */
export async function pauseTaskSchedule(taskId: string): Promise<TaskSchedule> {
  const response = await apiFetch(
    `${API_BASE}/api/tasks/${taskId}/schedule/pause`,
    { method: 'POST' },
  );
  if (!response.ok)
    throw new Error(`Failed to pause schedule: ${response.status}`);
  const json = await response.json();
  return json.schedule;
}

/**
 * Resume a paused task schedule. Returns the updated schedule.
 */
export async function resumeTaskSchedule(
  taskId: string,
): Promise<TaskSchedule> {
  const response = await apiFetch(
    `${API_BASE}/api/tasks/${taskId}/schedule/resume`,
    { method: 'POST' },
  );
  if (!response.ok)
    throw new Error(`Failed to resume schedule: ${response.status}`);
  const json = await response.json();
  return json.schedule;
}

/**
 * Trigger an immediate execution of a scheduled task.
 * Returns the new history row ID.
 */
export async function triggerTaskNow(
  taskId: string,
): Promise<{ historyId: string }> {
  const response = await apiFetch(
    `${API_BASE}/api/tasks/${taskId}/schedule/trigger`,
    { method: 'POST' },
  );
  if (!response.ok)
    throw new Error(`Failed to trigger task: ${response.status}`);
  return response.json();
}

/**
 * List execution history for a task schedule, newest first.
 */
export async function listTaskExecutions(
  taskId: string,
  filters: { status?: string; limit?: number; offset?: number } = {},
): Promise<{
  items: TaskExecutionHistoryItem[];
  total: number;
  limit: number;
  offset: number;
}> {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.limit !== undefined) params.set('limit', String(filters.limit));
  if (filters.offset !== undefined)
    params.set('offset', String(filters.offset));
  const response = await apiFetch(
    `${API_BASE}/api/tasks/${taskId}/schedule/executions?${params.toString()}`,
  );
  if (!response.ok)
    throw new Error(`Failed to list executions: ${response.status}`);
  const json = await response.json();
  return {
    items: (json.executions ?? []) as TaskExecutionHistoryItem[],
    total: json.total as number,
    limit: json.limit as number,
    offset: json.offset as number,
  };
}

// ── Deliverables ──────────────────────────────────────────────────────────────

/**
 * Deliverable type
 */
export type DeliverableType =
  | 'document'
  | 'image'
  | 'code'
  | 'report'
  | 'data'
  | 'link'
  | 'other';

/**
 * Deliverable status
 */
export type DeliverableStatus = 'pending' | 'delivered' | 'verified';

/**
 * Deliverable record
 */
export type Deliverable = {
  id: string;
  taskId: string;
  type: DeliverableType;
  description: string;
  status: DeliverableStatus;
  format: string | null;
  size: string | null;
  path: string | null;
  url: string | null;
  version: string | null;
  metadata: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * Get deliverables for a task
 */
export async function listDeliverables(
  taskId: string,
): Promise<ApiResult<{ items: Deliverable[] }>> {
  const response = await apiFetch(
    `${API_BASE}/api/tasks/${taskId}/deliverables`,
  );
  return response.json();
}

/**
 * Update a deliverable
 */
export async function updateDeliverable(
  taskId: string,
  id: string,
  input: Partial<{
    type: DeliverableType;
    description: string;
    status: DeliverableStatus;
    format: string;
    size: string;
    path: string;
    url: string;
    version: string;
  }>,
): Promise<ApiResult<Deliverable>> {
  const response = await apiFetch(
    `${API_BASE}/api/tasks/${taskId}/deliverables/${id}`,
    {
      method: 'PATCH',
      body: JSON.stringify(input),
    },
  );
  return response.json();
}
