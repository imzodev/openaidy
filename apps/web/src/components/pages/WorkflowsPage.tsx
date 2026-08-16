/**
 * Workflows Page
 *
 * Graph-first home for tasks with planning mode enabled — the same
 * tasks/subtasks/subtask_edges data the Tasks page's Kanban + modal Flow
 * tab already use, just browsed as a dedicated list with a graph preview
 * per card, and opened into a full page instead of a modal for authoring.
 * There is no separate "workflow" backend concept: a workflow is a task
 * with `planningEnabled: true`.
 */

import { createSignal, createMemo, Show, For, onMount } from 'solid-js';
import { Workflow, Plus, ArrowRight, AlertCircle } from 'lucide-solid';
import { Layout } from './Layout';
import {
  CreateWorkflowModal,
  type CreateWorkflowSubmitInput,
} from '../workflows/CreateWorkflowModal';
import { WorkflowThumbnail } from '../workflows/WorkflowThumbnail';
import {
  listTasks,
  createTask,
  applyWorkflowTemplate,
  type Task,
  type TaskStatus,
  type TaskPriority,
} from '../../lib/api-tasks';

export type WorkflowsPageProps = {
  onOpenWorkflow: (taskId: string) => void;
};

const STATUS_STYLES: Record<TaskStatus, string> = {
  backlog: 'bg-gray-100 text-gray-700 dark:bg-gray-700/50 dark:text-gray-300',
  todo: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  in_progress:
    'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
  review:
    'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  done: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

const STATUS_LABELS: Record<TaskStatus, string> = {
  backlog: 'Backlog',
  todo: 'To do',
  in_progress: 'In progress',
  review: 'Review',
  done: 'Done',
  cancelled: 'Cancelled',
};

const PRIORITY_DOT: Record<TaskPriority, string> = {
  low: 'bg-gray-400',
  medium: 'bg-blue-400',
  high: 'bg-orange-400',
  urgent: 'bg-red-500',
};

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function WorkflowsPage(props: WorkflowsPageProps) {
  const [workflows, setWorkflows] = createSignal<Task[]>([]);
  const [isLoading, setIsLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [isModalOpen, setIsModalOpen] = createSignal(false);

  const load = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await listTasks();
      setWorkflows(result.items.filter((t) => t.planningEnabled));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load workflows');
    } finally {
      setIsLoading(false);
    }
  };

  onMount(() => void load());

  const activeCount = createMemo(
    () => workflows().filter((t) => t.status === 'in_progress').length,
  );

  const handleCreate = () => setIsModalOpen(true);
  const handleCloseModal = () => setIsModalOpen(false);

  const handleSubmit = async ({
    task,
    template,
  }: CreateWorkflowSubmitInput) => {
    const result = await createTask(task);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    if (template) {
      const templateResult = await applyWorkflowTemplate(
        result.data.id,
        template.templateId,
        template.inputs,
      );
      if (!templateResult.ok) {
        throw new Error(templateResult.error.message);
      }
    }
    setIsModalOpen(false);
    props.onOpenWorkflow(result.data.id);
  };

  return (
    <Layout
      title="Workflows"
      description="Multi-step subtask graphs — dependency edges, conditional branches, bounded loops, and approval gates"
      actions={
        <button
          onClick={handleCreate}
          class="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-hover text-white rounded-lg shadow-sm transition-colors text-sm font-medium flex-shrink-0"
        >
          <Plus class="w-4 h-4" />
          <span class="hidden sm:inline">New Workflow</span>
          <span class="sm:hidden">New</span>
        </button>
      }
    >
      <Show when={!isLoading() && !error() && workflows().length > 0}>
        <div class="flex items-center gap-2 text-xs text-text-tertiary mb-4">
          <span>
            {workflows().length}{' '}
            {workflows().length === 1 ? 'workflow' : 'workflows'}
          </span>
          <Show when={activeCount() > 0}>
            <span class="inline-flex items-center gap-1.5">
              <span class="w-1.5 h-1.5 rounded-full bg-yellow-500 animate-pulse" />
              {activeCount()} running
            </span>
          </Show>
        </div>
      </Show>

      <Show when={isLoading()}>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <For each={[0, 1, 2]}>
            {() => (
              <div class="rounded-xl border border-gray-200 dark:border-gray-700 p-4 animate-pulse">
                <div class="w-full h-24 bg-gray-100 dark:bg-gray-800 rounded-lg" />
                <div class="h-4 w-2/3 bg-gray-100 dark:bg-gray-800 rounded mt-3" />
                <div class="h-3 w-full bg-gray-100 dark:bg-gray-800 rounded mt-2" />
                <div class="h-3 w-1/3 bg-gray-100 dark:bg-gray-800 rounded mt-3" />
              </div>
            )}
          </For>
        </div>
      </Show>

      <Show when={!isLoading() && error()}>
        <div class="text-center py-16 rounded-xl border border-dashed border-red-200 dark:border-red-800/50">
          <AlertCircle class="w-10 h-10 mx-auto mb-3 text-red-400" />
          <p class="text-red-600 dark:text-red-400 mb-4 text-sm">{error()}</p>
          <button
            onClick={() => void load()}
            class="px-4 py-2 bg-primary hover:bg-primary-hover text-white rounded-lg transition-colors text-sm font-medium"
          >
            Retry
          </button>
        </div>
      </Show>

      <Show when={!isLoading() && !error() && workflows().length === 0}>
        <div class="text-center py-16 px-6 rounded-xl border border-dashed border-gray-300 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/20">
          <div class="w-14 h-14 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
            <Workflow class="w-7 h-7 text-primary" />
          </div>
          <h3 class="text-lg font-semibold text-text-primary mb-1.5">
            No workflows yet
          </h3>
          <p class="text-text-secondary text-sm mb-5 max-w-sm mx-auto">
            Create a workflow to hand-author a subtask graph — dependency and
            conditional edges, loops, and approval gates.
          </p>
          <button
            onClick={handleCreate}
            class="inline-flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-hover text-white rounded-lg shadow-sm transition-colors text-sm font-medium"
          >
            <Plus class="w-4 h-4" />
            Create Workflow
          </button>
        </div>
      </Show>

      <Show when={!isLoading() && !error() && workflows().length > 0}>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <For each={workflows()}>
            {(task) => (
              <button
                onClick={() => props.onOpenWorkflow(task.id)}
                class="group text-left bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 shadow-sm hover:shadow-md hover:border-primary/50 hover:-translate-y-0.5 transition-all duration-150"
              >
                <WorkflowThumbnail taskId={task.id} />
                <div class="flex items-start justify-between gap-2 mt-3">
                  <h3 class="text-sm font-semibold text-text-primary truncate min-w-0">
                    {task.title || 'Untitled workflow'}
                  </h3>
                  <ArrowRight class="w-4 h-4 text-primary flex-shrink-0 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
                </div>
                <Show when={task.description}>
                  <p class="text-xs text-text-secondary mt-1 line-clamp-2 min-h-[2rem]">
                    {task.description}
                  </p>
                </Show>
                <div class="flex items-center justify-between gap-2 mt-3">
                  <div class="flex items-center gap-2 min-w-0">
                    <span
                      class={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${STATUS_STYLES[task.status]}`}
                    >
                      <span class="w-1.5 h-1.5 rounded-full bg-current" />
                      {STATUS_LABELS[task.status]}
                    </span>
                    <span class="inline-flex items-center gap-1 text-xs text-text-tertiary capitalize whitespace-nowrap">
                      <span
                        class={`w-1.5 h-1.5 rounded-full ${PRIORITY_DOT[task.priority]}`}
                      />
                      {task.priority}
                    </span>
                  </div>
                  <span class="text-xs text-text-tertiary flex-shrink-0">
                    {formatRelativeTime(task.updatedAt)}
                  </span>
                </div>
              </button>
            )}
          </For>
        </div>
      </Show>

      <CreateWorkflowModal
        isOpen={isModalOpen()}
        onClose={handleCloseModal}
        onSubmit={handleSubmit}
      />
    </Layout>
  );
}
