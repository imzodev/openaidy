/**
 * Planning Panel Component
 *
 * Displays the planning process, allows users to review and modify
 * generated subtasks, and triggers planning execution.
 */

import { createSignal, createEffect, Show, For } from 'solid-js';
import { X, RefreshCw, Plus, Pencil, Trash2, Check, AlertCircle } from 'lucide-solid';
import { listSubtasks, type Task, type Subtask, type PlanningStatus } from '../../lib/api-tasks';
import { SubtaskEditor, type SubtaskEdit } from './SubtaskEditor';

/**
 * PlanningPanel Props
 */
export type PlanningPanelProps = {
  task: Task;
  onClose: () => void;
  onPlanningComplete: () => void;
  onPlanTask: () => Promise<void>;
  onUpdateSubtask: (id: string, updates: { title: string; description: string }) => Promise<void>;
  onDeleteSubtask: (id: string) => Promise<void>;
  onAddSubtask: (subtask: { title: string; description: string }) => Promise<void>;
};

/**
 * Planning status display config
 */
const STATUS_CONFIG: Record<PlanningStatus, { label: string; color: string; icon: string }> = {
  pending: { label: 'Not Started', color: 'text-gray-500', icon: '○' },
  in_progress: { label: 'Planning...', color: 'text-blue-500', icon: '◐' },
  completed: { label: 'Completed', color: 'text-green-500', icon: '✓' },
  failed: { label: 'Failed', color: 'text-red-500', icon: '✗' },
};

/**
 * PlanningPanel Component
 */
export function PlanningPanel(props: PlanningPanelProps) {
  const [subtasks, setSubtasks] = createSignal<Subtask[]>([]);
  const [isLoading, setIsLoading] = createSignal(false);
  const [isPlanning, setIsPlanning] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [editingSubtaskId, setEditingSubtaskId] = createSignal<string | null>(null);
  const [isAddingNew, setIsAddingNew] = createSignal(false);
  const [savingId, setSavingId] = createSignal<string | null>(null);

  // Load existing subtasks when task changes
  createEffect(() => {
    if (props.task.planningStatus === 'completed') {
      loadSubtasks();
    }
  });

  /**
   * Load subtasks from API
   */
  async function loadSubtasks() {
    setIsLoading(true);
    try {
      const result = await listSubtasks(props.task.id);
      setSubtasks(result.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load subtasks');
    } finally {
      setIsLoading(false);
    }
  }

  /**
   * Start planning process
   */
  async function handleStartPlanning() {
    setIsPlanning(true);
    setError(null);
    try {
      await props.onPlanTask();
      await loadSubtasks();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Planning failed');
    } finally {
      setIsPlanning(false);
    }
  }

  /**
   * Handle save subtask edit
   */
  async function handleSaveEdit(id: string, updates: SubtaskEdit) {
    setSavingId(id);
    try {
      await props.onUpdateSubtask(id, updates);
      await loadSubtasks();
      setEditingSubtaskId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update subtask');
    } finally {
      setSavingId(null);
    }
  }

  /**
   * Handle delete subtask
   */
  async function handleDelete(id: string) {
    if (!confirm('Delete this subtask?')) return;
    try {
      await props.onDeleteSubtask(id);
      await loadSubtasks();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete subtask');
    }
  }

  /**
   * Handle add new subtask
   */
  async function handleAddNew(subtask: SubtaskEdit) {
    setSavingId('new');
    try {
      await props.onAddSubtask(subtask);
      await loadSubtasks();
      setIsAddingNew(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add subtask');
    } finally {
      setSavingId(null);
    }
  }

  /**
   * Sorted subtasks by orderIndex
   */
  const sortedSubtasks = () => {
    return [...subtasks()].sort((a, b) => a.orderIndex - b.orderIndex);
  };

  const status = () => props.task.planningStatus || 'pending';
  const statusConfig = () => STATUS_CONFIG[status()];

  return (
    <div class="planning-panel bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
      {/* Header */}
      <div class="flex items-center justify-between p-4 border-b">
        <div>
          <h2 class="text-lg font-semibold text-gray-900">Task Planning</h2>
          <p class="text-sm text-gray-500">{props.task.title}</p>
        </div>
        <button
          type="button"
          class="p-1.5 text-gray-400 hover:text-gray-600"
          onClick={props.onClose}
        >
          <X class="w-5 h-5" />
        </button>
      </div>

      {/* Content */}
      <div class="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Planning Status */}
        <div class="planning-status p-4 bg-gray-50 rounded-lg">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class={`text-lg ${statusConfig().color}`}>
                {statusConfig().icon}
              </span>
              <span class="font-medium text-gray-900">{statusConfig().label}</span>
            </div>

            <Show when={status() === 'pending' || status() === 'failed'}>
              <button
                type="button"
                class="flex items-center gap-1.5 px-3 py-1.5 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-md disabled:opacity-50"
                onClick={handleStartPlanning}
                disabled={isPlanning()}
              >
                <Show when={isPlanning()}>
                  <RefreshCw class="w-4 h-4 animate-spin" />
                </Show>
                {status() === 'failed' ? 'Retry Planning' : 'Start Planning'}
              </button>
            </Show>

            <Show when={status() === 'in_progress'}>
              <div class="flex items-center gap-2 text-blue-500">
                <RefreshCw class="w-4 h-4 animate-spin" />
                <span class="text-sm">Planning in progress...</span>
              </div>
            </Show>

            <Show when={status() === 'completed' && subtasks().length > 0}>
              <button
                type="button"
                class="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 border border-gray-300 rounded-md"
                onClick={handleStartPlanning}
                disabled={isPlanning()}
              >
                <RefreshCw class={`w-4 h-4 ${isPlanning() ? 'animate-spin' : ''}`} />
                Regenerate
              </button>
            </Show>
          </div>

          {/* Error message */}
          <Show when={error()}>
            <div class="mt-3 p-3 bg-red-50 text-red-600 rounded-md flex items-start gap-2">
              <AlertCircle class="w-4 h-4 mt-0.5 flex-shrink-0" />
              <div>
                <p class="font-medium">Planning failed</p>
                <p class="text-sm">{error()}</p>
              </div>
            </div>
          </Show>
        </div>

        {/* Subtasks List */}
        <Show when={status() === 'completed' || subtasks().length > 0}>
          <div class="subtasks-section">
            <div class="flex items-center justify-between mb-3">
              <h3 class="text-sm font-medium text-gray-900">
                Generated Subtasks ({subtasks().length})
              </h3>
            </div>

            {/* Loading state */}
            <Show when={isLoading()}>
              <div class="text-center py-8 text-gray-500">
                Loading subtasks...
              </div>
            </Show>

            {/* Subtasks list */}
            <Show when={!isLoading() && subtasks().length > 0}>
              <div class="space-y-2">
                <For each={sortedSubtasks()}>
                  {(subtask, index) => (
                    <div class="subtask-item border border-gray-200 rounded-md overflow-hidden">
                      <Show when={editingSubtaskId() === subtask.id}>
                        <SubtaskEditor
                          title={subtask.title}
                          description={subtask.description || ''}
                          onSave={(updates) => handleSaveEdit(subtask.id, updates)}
                          onCancel={() => setEditingSubtaskId(null)}
                          isLoading={savingId() === subtask.id}
                        />
                      </Show>

                      <Show when={editingSubtaskId() !== subtask.id}>
                        <div class="flex items-start gap-3 p-3">
                          {/* Order number */}
                          <span class="flex-shrink-0 w-6 h-6 flex items-center justify-center bg-gray-100 text-gray-600 text-sm rounded">
                            {index() + 1}
                          </span>

                          {/* Content */}
                          <div class="flex-1 min-w-0">
                            <h4 class="text-sm font-medium text-gray-900">
                              {subtask.title}
                            </h4>
                            <Show when={subtask.description}>
                              <p class="text-sm text-gray-500 mt-1">
                                {subtask.description}
                              </p>
                            </Show>
                          </div>

                          {/* Actions */}
                          <div class="flex items-center gap-1">
                            <button
                              type="button"
                              class="p-1 text-gray-400 hover:text-gray-600"
                              onClick={() => setEditingSubtaskId(subtask.id)}
                              title="Edit"
                            >
                              <Pencil class="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              class="p-1 text-gray-400 hover:text-red-600"
                              onClick={() => handleDelete(subtask.id)}
                              title="Delete"
                            >
                              <Trash2 class="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            </Show>

            {/* Add new subtask */}
            <Show when={isAddingNew()}>
              <div class="mt-3">
                <SubtaskEditor
                  onSave={handleAddNew}
                  onCancel={() => setIsAddingNew(false)}
                  isLoading={savingId() === 'new'}
                />
              </div>
            </Show>

            <Show when={!isAddingNew() && status() === 'completed'}>
              <button
                type="button"
                class="mt-3 w-full flex items-center justify-center gap-1.5 px-3 py-2 text-sm text-gray-600 hover:text-gray-800 border border-dashed border-gray-300 rounded-md hover:border-gray-400"
                onClick={() => setIsAddingNew(true)}
              >
                <Plus class="w-4 h-4" />
                Add Subtask
              </button>
            </Show>
          </div>
        </Show>
      </div>

      {/* Footer */}
      <Show when={status() === 'completed' && subtasks().length > 0}>
        <div class="p-4 border-t bg-gray-50">
          <button
            type="button"
            class="w-full px-4 py-2 text-white bg-green-600 hover:bg-green-700 rounded-md font-medium"
            onClick={props.onPlanningComplete}
          >
            <Check class="w-4 h-4 inline mr-2" />
            Done - Start Execution
          </button>
        </div>
      </Show>
    </div>
  );
}
