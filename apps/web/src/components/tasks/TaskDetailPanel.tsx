/**
 * Task Detail Panel Component
 *
 * Displays full task information including assigned agents, subtasks,
 * progress, and allows editing.
 */

import { createSignal, createEffect, Show, For } from 'solid-js';
import { X, Edit2, Trash2 } from 'lucide-solid';
import {
  getTask,
  updateTask,
  deleteTask,
  listSubtasks,
  getTaskProgress,
  assignAgents,
  replanTask,
  listDeliverables,
  updateDeliverable,
  type Deliverable,
} from '../../lib/api-tasks';
import { readWorkspaceFile } from '../../lib/api';
import { AgentSelector, type Agent, type SelectedAgent } from './AgentSelector';
import { SubtaskList } from './SubtaskList';
import type {
  Task,
  TaskStatus,
  TaskPriority,
  Subtask,
} from '../../lib/api-tasks';

/**
 * TaskWithAgents extends Task to include agents
 */
type TaskWithAgents = Task & {
  agents?: Array<{ agentId: string; role: string }>;
};

/**
 * TaskProgress type
 */
type TaskProgress = {
  total: number;
  completed: number;
  inProgress: number;
  failed: number;
  pending: number;
};

/**
 * TaskDetailPanel Props
 */
export type TaskDetailPanelProps = {
  taskId: string;
  agents: Agent[];
  onClose: () => void;
  onTaskUpdated: () => void;
  onTaskDeleted: () => void;
};

/**
 * Status badge colors
 */
const STATUS_COLORS: Record<TaskStatus, string> = {
  backlog: 'bg-gray-100 text-gray-700',
  todo: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-yellow-100 text-yellow-700',
  review: 'bg-purple-100 text-purple-700',
  done: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
};

/**
 * Priority badge colors
 */
const PRIORITY_COLORS: Record<TaskPriority, string> = {
  low: 'bg-gray-100 text-gray-600',
  medium: 'bg-blue-100 text-blue-600',
  high: 'bg-orange-100 text-orange-600',
  urgent: 'bg-red-100 text-red-600',
};

/**
 * TaskDetailPanel Component
 */
export function TaskDetailPanel(props: TaskDetailPanelProps) {
  const [task, setTask] = createSignal<TaskWithAgents | null>(null);
  const [subtasks, setSubtasks] = createSignal<Subtask[]>([]);
  const [progress, setProgress] = createSignal<TaskProgress | null>(null);
  const [deliverables, setDeliverables] = createSignal<Deliverable[]>([]);
  const [isLoading, setIsLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [isEditing, setIsEditing] = createSignal(false);
  const [editTitle, setEditTitle] = createSignal('');
  const [editDescription, setEditDescription] = createSignal('');
  const [isDeleting, setIsDeleting] = createSignal(false);
  const [isReplanning, setIsReplanning] = createSignal(false);
  const [deliverableModal, setDeliverableModal] = createSignal<{
    isOpen: boolean;
    content: string;
    path: string;
    isText: boolean;
  }>({ isOpen: false, content: '', path: '', isText: true });

  // Load task data when taskId changes
  createEffect(() => {
    if (props.taskId) {
      loadTaskData();
    }
  });

  /**
   * Load task, subtasks, and progress data
   */
  async function loadTaskData() {
    setIsLoading(true);
    setError(null);
    try {
      const taskResult = await getTask(props.taskId);
      if (!taskResult.ok) {
        setError(taskResult.error.message);
        return;
      }
      setTask(taskResult.data);

      // Load subtasks
      const subtasksData = await listSubtasks(props.taskId);
      setSubtasks(subtasksData.items);

      // Load progress if planning is enabled
      if (taskResult.data.planningEnabled) {
        const progressResult = await getTaskProgress(props.taskId);
        if (progressResult.ok) {
          setProgress(progressResult.data);
        }
      }

      // Load deliverables
      const deliverablesResult = await listDeliverables(props.taskId);
      if (deliverablesResult.ok) {
        setDeliverables(deliverablesResult.data.items);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load task');
    } finally {
      setIsLoading(false);
    }
  }

  /**
   * Start editing
   */
  function startEditing() {
    if (task()) {
      setEditTitle(task()!.title);
      setEditDescription(task()!.description);
      setIsEditing(true);
    }
  }

  /**
   * Save edit
   */
  async function handleSaveEdit() {
    if (!task()) return;

    try {
      const result = await updateTask(props.taskId, {
        title: editTitle(),
        description: editDescription(),
      });

      if (result.ok) {
        await loadTaskData();
        setIsEditing(false);
        props.onTaskUpdated();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update task');
    }
  }

  /**
   * Handle agent change
   */
  async function handleAgentChange(selectedAgents: SelectedAgent[]) {
    try {
      const result = await assignAgents(props.taskId, selectedAgents);
      if (result.ok) {
        await loadTaskData();
        props.onTaskUpdated();
      } else {
        setError(result.error.message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to assign agents');
    }
  }

  /**
   * Handle delete
   */
  async function handleDelete() {
    if (!confirm('Are you sure you want to delete this task?')) return;

    setIsDeleting(true);
    try {
      const result = await deleteTask(props.taskId);
      if (result.ok) {
        props.onTaskDeleted();
        props.onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete task');
    } finally {
      setIsDeleting(false);
    }
  }

  /**
   * Handle deliverable status change
   */
  async function handleDeliverableStatusChange(
    id: string,
    currentStatus: string,
  ) {
    const nextStatus =
      currentStatus === 'pending'
        ? 'delivered'
        : currentStatus === 'delivered'
          ? 'verified'
          : 'verified';
    if (nextStatus === currentStatus) return;

    try {
      const result = await updateDeliverable(props.taskId, id, {
        status: nextStatus as 'pending' | 'delivered' | 'verified',
      });
      if (result.ok) {
        await loadTaskData();
        props.onTaskUpdated();
      } else {
        setError(result.error.message);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to update deliverable',
      );
    }
  }

  /**
   * Handle open deliverable (path or URL)
   * Uses readWorkspaceFile API to fetch file content instead of file:// URL
   */
  async function handleOpenDeliverable(d: Deliverable) {
    if (d.url) {
      window.open(d.url, '_blank', 'noopener,noreferrer');
    } else if (d.path) {
      // Determine the agentId from task agents - use first available
      const agentId = task()?.agents?.[0]?.agentId;
      if (!agentId) {
        setError('No agent available to read workspace file');
        return;
      }

      try {
        // The path stored is the absolute path - we need to extract the relative path
        // Expected format: .openaidy/workspaces/{agentId}/filename.txt
        // So we need to extract everything after {agentId}/
        const pathParts = d.path.split('/');
        const workspaceIndex = pathParts.findIndex((p) => p === 'workspaces');
        // relativePath = path after agentId folder (workspaceIndex + 2 to skip workspaces + agentId)
        const relativePath =
          workspaceIndex >= 0
            ? pathParts.slice(workspaceIndex + 2).join('/')
            : d.path;

        const response = await readWorkspaceFile(
          agentId,
          relativePath,
          agentId, // requestingAgentId - using same agent for simplicity
        );

        if ('error' in response) {
          setError(`Failed to read file: ${response.error}`);
          return;
        }

        setDeliverableModal({
          isOpen: true,
          content: response.content,
          path: d.path,
          isText: response.isText,
        });
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to open deliverable',
        );
      }
    }
  }

  /**
   * Handle re-plan task
   */
  async function handleReplan() {
    if (!confirm('This will regenerate subtasks for this task. Continue?'))
      return;

    setIsReplanning(true);
    try {
      const result = await replanTask(props.taskId);
      if (result.ok) {
        await loadTaskData();
        props.onTaskUpdated();
      } else {
        setError(result.error.message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to re-plan task');
    } finally {
      setIsReplanning(false);
    }
  }

  return (
    <div class="task-detail-panel bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
      {/* Header */}
      <div class="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
        <Show
          when={!isEditing()}
          fallback={
            <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Edit Task
            </h2>
          }
        >
          <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {task()?.title || 'Task Details'}
          </h2>
        </Show>
        <div class="flex items-center gap-2">
          <Show when={!isEditing()}>
            <button
              type="button"
              class="p-1.5 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
              onClick={startEditing}
              title="Edit task"
            >
              <Edit2 class="w-4 h-4" />
            </button>
            <button
              type="button"
              class="p-1.5 text-red-400 hover:text-red-600 dark:text-red-500 dark:hover:text-red-400"
              onClick={handleDelete}
              disabled={isDeleting()}
              title="Delete task"
            >
              <Trash2 class="w-4 h-4" />
            </button>
          </Show>
          <button
            type="button"
            class="p-1.5 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
            onClick={props.onClose}
          >
            <X class="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div class="p-4 space-y-4">
        {/* Loading state */}
        <Show when={isLoading()}>
          <div class="flex justify-center py-8">
            <div class="text-gray-500 dark:text-gray-400">Loading task...</div>
          </div>
        </Show>

        {/* Error state */}
        <Show when={error()}>
          <div class="p-4 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-md">
            {error()}
          </div>
        </Show>

        {/* Task content */}
        <Show when={!isLoading() && task()}>
          {/* Status and Priority badges */}
          <div class="flex items-center gap-2">
            <span
              class={`px-2 py-1 text-xs rounded ${STATUS_COLORS[task()!.status]}`}
            >
              {task()!.status}
            </span>
            <span
              class={`px-2 py-1 text-xs rounded ${PRIORITY_COLORS[task()!.priority]}`}
            >
              {task()!.priority}
            </span>
            <Show when={task()!.planningEnabled}>
              <span class="px-2 py-1 text-xs rounded bg-purple-100 text-purple-600">
                Planning enabled
              </span>
              <button
                type="button"
                class="ml-auto px-3 py-1 text-xs rounded bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
                onClick={handleReplan}
                disabled={isReplanning()}
              >
                {isReplanning() ? 'Re-planning...' : 'Re-plan'}
              </button>
            </Show>
          </div>

          {/* Title (edit mode) */}
          <Show when={isEditing()}>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Title
              </label>
              <input
                type="text"
                class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={editTitle()}
                onInput={(e) => setEditTitle(e.currentTarget.value)}
              />
            </div>
          </Show>

          {/* Description */}
          <Show when={isEditing()}>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Description
              </label>
              <textarea
                class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={4}
                value={editDescription()}
                onInput={(e) => setEditDescription(e.currentTarget.value)}
              />
            </div>
          </Show>
          <Show when={!isEditing()}>
            <div>
              <h3 class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Description
              </h3>
              <p class="text-gray-900 dark:text-gray-100">
                {task()?.description}
              </p>
            </div>
          </Show>

          {/* Progress (if planning enabled) */}
          <Show when={task()?.planningEnabled && progress()}>
            <div>
              <h3 class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Progress
              </h3>
              <div class="bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
                <div
                  class="bg-blue-500 h-full transition-all"
                  style={{
                    width: `${((progress()?.completed || 0) / (progress()?.total || 1)) * 100}%`,
                  }}
                />
              </div>
              <div class="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {progress()?.completed || 0} / {progress()?.total || 0} subtasks
                completed
              </div>
            </div>
          </Show>

          {/* Assigned Agents */}
          <div>
            <h3 class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Assigned Agents
            </h3>
            <Show
              when={isEditing()}
              fallback={
                <div class="flex flex-wrap gap-2">
                  <For
                    each={task()?.agents}
                    fallback={
                      <span class="text-sm text-gray-500 dark:text-gray-400">
                        No agents assigned
                      </span>
                    }
                  >
                    {(a) => (
                      <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
                        <span class="w-4 h-4 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center text-xs">
                          {props.agents.find((ag) => ag.id === a.agentId)
                            ?.name?.[0] ?? '?'}
                        </span>
                        {props.agents.find((ag) => ag.id === a.agentId)?.name ??
                          a.agentId}
                        <span class="text-xs text-gray-400 dark:text-gray-500">
                          {a.role}
                        </span>
                      </span>
                    )}
                  </For>
                </div>
              }
            >
              <AgentSelector
                agents={props.agents}
                selectedAgents={
                  task()?.agents?.map((a) => ({
                    agentId: a.agentId,
                    role: a.role as 'primary' | 'secondary' | 'reviewer',
                  })) || []
                }
                onChange={handleAgentChange}
              />
            </Show>
          </div>

          {/* Subtasks (if planning enabled) */}
          <Show when={task()?.planningEnabled}>
            <div>
              <h3 class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Subtasks
              </h3>
              <SubtaskList
                subtasks={subtasks()}
                agents={props.agents}
                onSubtaskUpdate={loadTaskData}
              />
            </div>
          </Show>

          {/* Deliverables */}
          <Show when={deliverables().length > 0}>
            <div>
              <h3 class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Deliverables
              </h3>
              <div class="space-y-2">
                <For each={deliverables()}>
                  {(d) => (
                    <div class="p-3 bg-gray-50 dark:bg-gray-800 rounded-md border border-gray-200 dark:border-gray-700">
                      <div class="flex items-start justify-between">
                        <div class="flex items-center gap-2">
                          <span class="px-2 py-0.5 text-xs rounded bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300">
                            {d.type}
                          </span>
                          <span
                            class={`px-2 py-0.5 text-xs rounded ${
                              d.status === 'verified'
                                ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                                : d.status === 'delivered'
                                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                                  : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                            }`}
                          >
                            {d.status}
                          </span>
                        </div>
                        <div class="flex items-center gap-2">
                          <Show when={d.path || d.url}>
                            <button
                              type="button"
                              class="flex items-center gap-1 px-2 py-1 text-xs text-white bg-blue-600 hover:bg-blue-700 rounded-md"
                              onClick={() => handleOpenDeliverable(d)}
                            >
                              Open
                            </button>
                          </Show>
                          <button
                            type="button"
                            class="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                            onClick={() =>
                              handleDeliverableStatusChange(d.id, d.status)
                            }
                          >
                            Update status
                          </button>
                        </div>
                      </div>
                      <p class="mt-2 text-sm text-gray-700 dark:text-gray-300">
                        {d.description}
                      </p>
                      <Show when={d.format || d.path || d.url}>
                        <div class="mt-2 flex flex-wrap gap-2 text-xs text-gray-500 dark:text-gray-400">
                          <Show when={d.format}>
                            <span>Format: {d.format}</span>
                          </Show>
                          <Show when={d.path}>
                            <span>Path: {d.path}</span>
                          </Show>
                          <Show when={d.url}>
                            <span>URL: {d.url}</span>
                          </Show>
                        </div>
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </Show>

          {/* Edit actions */}
          <Show when={isEditing()}>
            <div class="flex justify-end gap-2 pt-4 border-t border-gray-200 dark:border-gray-700">
              <button
                type="button"
                class="px-4 py-2 text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 border border-gray-300 dark:border-gray-600 rounded-md"
                onClick={() => setIsEditing(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                class="px-4 py-2 text-white bg-blue-600 hover:bg-blue-700 rounded-md"
                onClick={handleSaveEdit}
              >
                Save Changes
              </button>
            </div>
          </Show>

          {/* Deliverable viewer modal */}
          <Show when={deliverableModal().isOpen}>
            <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
              <div class="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-4xl w-full max-h-[80vh] flex flex-col">
                <div class="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                  <h3 class="text-lg font-medium text-gray-900 dark:text-gray-100">
                    {deliverableModal().path.split('/').pop()}
                  </h3>
                  <button
                    type="button"
                    class="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                    onClick={() =>
                      setDeliverableModal((prev) => ({
                        ...prev,
                        isOpen: false,
                      }))
                    }
                  >
                    ✕
                  </button>
                </div>
                <div class="flex-1 overflow-auto p-4">
                  <Show
                    when={deliverableModal().isText}
                    fallback={
                      <div class="flex items-center justify-center h-64 text-gray-500 dark:text-gray-400">
                        Non-text file preview not available
                      </div>
                    }
                  >
                    <pre class="whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300 font-mono bg-gray-50 dark:bg-gray-800 p-4 rounded-md overflow-auto max-h-[60vh]">
                      {deliverableModal().content}
                    </pre>
                  </Show>
                </div>
                <div class="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end">
                  <span class="text-xs text-gray-500 dark:text-gray-400">
                    {deliverableModal().path}
                  </span>
                </div>
              </div>
            </div>
          </Show>
        </Show>
      </div>
    </div>
  );
}
