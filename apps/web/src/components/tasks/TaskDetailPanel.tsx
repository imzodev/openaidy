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
} from '../../lib/api-tasks';
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
  const [isLoading, setIsLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [isEditing, setIsEditing] = createSignal(false);
  const [editTitle, setEditTitle] = createSignal('');
  const [editDescription, setEditDescription] = createSignal('');
  const [isDeleting, setIsDeleting] = createSignal(false);

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
                onOpenSession={(sessionId) => {
                  const url = new URL(window.location.href);
                  url.pathname = '/chat';
                  url.searchParams.set('sessionId', sessionId);
                  window.open(url.toString(), '_blank');
                }}
              />
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
        </Show>
      </div>
    </div>
  );
}
