/**
 * Workflow Detail Page
 *
 * A purpose-built full-page authoring surface for a single workflow (a
 * task with planning mode enabled) — not a repurposed modal. The graph
 * canvas (WorkflowEditor, which already fills whatever height/width its
 * container gives it) takes the entire viewport below a slim header bar
 * for identity/status/run/delete. No card chrome, no fixed-height box.
 */

import { createSignal, onMount, For, Show } from 'solid-js';
import { ArrowLeft, Play, Trash2, Pencil, Workflow } from 'lucide-solid';
import { WorkflowEditor } from '../tasks/workflow/WorkflowEditor';
import {
  getTask,
  updateTask,
  updateTaskStatus,
  deleteTask,
  executeTask,
  type TaskWithDetails,
  type TaskStatus,
} from '../../lib/api-tasks';
import { listAgents, type Agent } from '../../lib/api';

export type WorkflowDetailPageProps = {
  taskId: string;
  onBack: () => void;
};

const STATUS_OPTIONS: Array<{ value: TaskStatus; label: string }> = [
  { value: 'backlog', label: 'Backlog' },
  { value: 'todo', label: 'To Do' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'review', label: 'Review' },
  { value: 'done', label: 'Done' },
  { value: 'cancelled', label: 'Cancelled' },
];

const STATUS_COLORS: Record<TaskStatus, string> = {
  backlog: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  todo: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  in_progress:
    'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
  review:
    'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  done: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

export function WorkflowDetailPage(props: WorkflowDetailPageProps) {
  const [task, setTask] = createSignal<TaskWithDetails | null>(null);
  const [agents, setAgents] = createSignal<Agent[]>([]);
  const [isLoading, setIsLoading] = createSignal(true);
  const [isEditingTitle, setIsEditingTitle] = createSignal(false);
  const [titleDraft, setTitleDraft] = createSignal('');
  const [isRunning, setIsRunning] = createSignal(false);
  const [isDeleting, setIsDeleting] = createSignal(false);
  const [actionError, setActionError] = createSignal<string | null>(null);

  const load = async () => {
    const result = await getTask(props.taskId);
    if (result.ok) setTask(result.data);
    setIsLoading(false);
  };

  onMount(() => {
    void load();
    void (async () => {
      try {
        const result = await listAgents();
        setAgents(result.items);
      } catch (err) {
        console.error('Failed to load agents:', err);
      }
    })();
  });

  const handleBack = () => props.onBack();

  const startEditingTitle = () => {
    setTitleDraft(task()?.title ?? '');
    setIsEditingTitle(true);
  };

  const saveTitle = async () => {
    const title = titleDraft().trim();
    setIsEditingTitle(false);
    if (!title || title === task()?.title) return;
    const result = await updateTask(props.taskId, { title });
    if (result.ok) {
      setTask((prev) => (prev ? { ...prev, title: result.data.title } : prev));
    }
  };

  const handleStatusChange = async (status: TaskStatus) => {
    const result = await updateTaskStatus(props.taskId, status);
    if (result.ok) {
      setTask((prev) =>
        prev ? { ...prev, status: result.data.status } : prev,
      );
    }
  };

  const handleRun = async () => {
    setIsRunning(true);
    setActionError(null);
    try {
      const result = await executeTask(props.taskId);
      if (!result.ok) throw new Error(result.error.message);
      await load();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Failed to run workflow',
      );
    } finally {
      setIsRunning(false);
    }
  };

  const handleDelete = async () => {
    if (
      !confirm(
        `Delete "${task()?.title ?? 'this workflow'}"? This cannot be undone.`,
      )
    ) {
      return;
    }
    setIsDeleting(true);
    try {
      const result = await deleteTask(props.taskId);
      if (!result.ok) throw new Error(result.error.message);
      handleBack();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Failed to delete workflow',
      );
      setIsDeleting(false);
    }
  };

  return (
    <div class="flex-1 flex flex-col h-full overflow-hidden bg-gray-50 dark:bg-gray-900">
      {/* Header — purpose-built for graph authoring, not a repurposed modal */}
      <div class="flex items-center gap-3 px-4 py-2.5 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex-shrink-0">
        <button
          onClick={handleBack}
          class="p-1.5 rounded-lg text-text-tertiary hover:bg-gray-100 dark:hover:bg-gray-700 flex-shrink-0"
          title="Back to Workflows"
        >
          <ArrowLeft class="w-4 h-4" />
        </button>

        <div class="hidden sm:flex w-7 h-7 rounded-lg bg-primary/10 items-center justify-center flex-shrink-0">
          <Workflow class="w-3.5 h-3.5 text-primary" />
        </div>

        <div class="flex items-center gap-2 min-w-0 flex-1">
          <Show
            when={!isEditingTitle()}
            fallback={
              <input
                type="text"
                value={titleDraft()}
                onInput={(e) => setTitleDraft(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void saveTitle();
                  if (e.key === 'Escape') setIsEditingTitle(false);
                }}
                onBlur={() => void saveTitle()}
                autofocus
                class="text-base font-semibold bg-white dark:bg-gray-900 border border-primary rounded-lg px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-primary/30 text-text-primary min-w-0 flex-1"
              />
            }
          >
            <button
              onClick={startEditingTitle}
              class="group flex items-center gap-1.5 min-w-0 text-left"
              title="Click to rename"
            >
              <h1 class="text-base font-semibold text-text-primary truncate">
                {task()?.title || 'Untitled workflow'}
              </h1>
              <Pencil class="w-3 h-3 text-text-tertiary opacity-0 group-hover:opacity-100 flex-shrink-0" />
            </button>
          </Show>

          <Show when={task()}>
            <select
              value={task()!.status}
              onChange={(e) =>
                void handleStatusChange(e.currentTarget.value as TaskStatus)
              }
              class={`text-xs font-medium rounded-full px-2.5 py-1 border-0 cursor-pointer flex-shrink-0 ${STATUS_COLORS[task()!.status]}`}
            >
              <For each={STATUS_OPTIONS}>
                {(opt) => <option value={opt.value}>{opt.label}</option>}
              </For>
            </select>
          </Show>
        </div>

        <div class="flex items-center gap-2 flex-shrink-0">
          <Show when={actionError()}>
            <span class="text-xs text-red-600 dark:text-red-400 max-w-xs truncate">
              {actionError()}
            </span>
          </Show>
          <button
            onClick={() => void handleRun()}
            disabled={isRunning()}
            class="flex items-center gap-1.5 px-3 py-1.5 bg-primary hover:bg-primary-hover text-white rounded-lg shadow-sm text-sm font-medium disabled:opacity-50 transition-colors"
          >
            <Play class="w-3.5 h-3.5" />
            <span class="hidden sm:inline">
              {isRunning() ? 'Running...' : 'Run'}
            </span>
          </button>
          <button
            onClick={() => void handleDelete()}
            disabled={isDeleting()}
            class="p-1.5 rounded-lg text-text-tertiary hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400 disabled:opacity-50 transition-colors"
            title="Delete workflow"
          >
            <Trash2 class="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Graph canvas + property panel — fills the rest of the viewport */}
      <div class="flex-1 min-h-0">
        <Show
          when={!isLoading()}
          fallback={
            <div class="h-full flex flex-col items-center justify-center gap-2 text-text-tertiary">
              <div class="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
              <span class="text-sm">Loading workflow…</span>
            </div>
          }
        >
          <WorkflowEditor
            taskId={props.taskId}
            agents={agents()}
            isTaskRunning={task()?.status === 'in_progress'}
          />
        </Show>
      </div>
    </div>
  );
}
