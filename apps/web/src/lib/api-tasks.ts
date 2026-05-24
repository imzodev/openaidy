/**
 * API client for task endpoints
 */

import { API_BASE } from './api';
import { getStoredToken } from './auth-token';

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
 * Subtask record
 */
export type Subtask = {
  id: string;
  taskId: string;
  parentSubtaskId: string | null;
  title: string;
  description: string;
  status: SubtaskStatus;
  assignedAgentId: string | null;
  sessionId?: string | null;
  orderIndex: number;
  result: string | null;
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
 * Create task input
 */
export type CreateTaskInput = {
  title?: string;
  description: string;
  priority?: TaskPriority;
  planningEnabled?: boolean;
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
  parentSubtaskId?: string;
  title: string;
  description: string;
  orderIndex?: number;
  assignedAgentId?: string;
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
  const response = await apiFetch(`${API_BASE}/tasks/kanban`);
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
    ? `${API_BASE}/tasks?status=${status}`
    : `${API_BASE}/tasks`;
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
  const response = await apiFetch(`${API_BASE}/tasks/${id}`);
  return response.json();
}

/**
 * Create a new task
 */
export async function createTask(
  input: CreateTaskInput,
): Promise<ApiResult<Task>> {
  const response = await apiFetch(`${API_BASE}/tasks`, {
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
  const response = await apiFetch(`${API_BASE}/tasks/${id}`, {
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
  const response = await apiFetch(`${API_BASE}/tasks/${id}/status`, {
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
  const response = await apiFetch(`${API_BASE}/tasks/${id}`, {
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
  const response = await apiFetch(`${API_BASE}/tasks/${taskId}/agents`, {
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
    `${API_BASE}/tasks/${taskId}/agents/${agentId}`,
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
  const response = await apiFetch(`${API_BASE}/tasks/${taskId}/progress`);
  return response.json();
}

/**
 * List subtasks for a task
 */
export async function listSubtasks(
  taskId: string,
): Promise<{ items: Subtask[] }> {
  const response = await apiFetch(`${API_BASE}/tasks/${taskId}/subtasks`);
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
    `${API_BASE}/tasks/${input.taskId}/subtasks`,
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
  const response = await apiFetch(`${API_BASE}/subtasks/${id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  return response.json();
}

/**
 * Execute a task (creates a session)
 */
export async function executeTask(
  taskId: string,
): Promise<ApiResult<{ sessionId: string }>> {
  const response = await apiFetch(`${API_BASE}/tasks/${taskId}/execute`, {
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
  const response = await apiFetch(`${API_BASE}/subtasks/${subtaskId}/execute`, {
    method: 'POST',
  });
  return response.json();
}

/**
 * Get the session linked to a task
 */
export async function getTaskSession(
  taskId: string,
): Promise<ApiResult<{ sessionId: string | null }>> {
  const response = await apiFetch(`${API_BASE}/tasks/${taskId}/session`);
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
    `${API_BASE}/subtasks/${subtaskId}/complete`,
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
  const response = await apiFetch(`${API_BASE}/subtasks/${subtaskId}/session`);
  return response.json();
}

/**
 * Plan a task (decompose into subtasks using AI)
 * Can be called again to re-plan even after initial planning
 */
export async function planTask(
  taskId: string,
): Promise<ApiResult<{ subtasks: Subtask[] }>> {
  const response = await apiFetch(`${API_BASE}/tasks/${taskId}/plan`, {
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
  const response = await apiFetch(`${API_BASE}/tasks/${taskId}/deliverables`);
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
    `${API_BASE}/tasks/${taskId}/deliverables/${id}`,
    {
      method: 'PATCH',
      body: JSON.stringify(input),
    },
  );
  return response.json();
}
