/**
 * Planning Panel Component
 *
 * Displays the planning process, allows users to review and modify generated subtasks,
 * and triggers planning execution.
 */

import { createSignal, createEffect, Show, For } from 'solid-js';
import { X, Play, RefreshCw, Loader2, Check, AlertCircle } from 'lucide-solid';
import { planTask, listSubtasks, type Task, type Subtask, type PlanningStatus } from '../../lib/api-tasks';
import { SubtaskEditor } from './SubtaskEditor';

/**
 * PlanningPanel Props
 */
export type PlanningPanelProps = {
  task: Task;
  onClose: () => void;
  onPlanningComplete: () => void;
};

/**
 * PlanningPanel Component
 */
export function PlanningPanel(props: PlanningPanelProps) {
  const [planningStatus, setPlanningStatus] = createSignal<PlanningStatus>(
    props.task.planningStatus || 'pending'
  );
  const [subtasks, setSubtasks] = createSignal<Subtask[]>([]);
  const [isPlanning, setIsPlanning] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [editingSubtaskId, setEditingSubtaskId] = createSignal<string | null>(null);

  // Load existing subtasks when planning is completed
  createEffect(() => {
    if (props.task.planningStatus === 'completed') {
      loadSubtasks();
    }
  });

  /**
   * Load subtasks from API
   */
  async function loadSubtasks() {
    try {
      const result = await listSubtasks(props.task.id);
      setSubtasks(result.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load subtasks');
    }
  }

  /**
   * Start planning process
   */
  async function startPlanning() {
    setIsPlanning(true);
    setError(null);
    setPlanningStatus('in_progress');

    try {
      const result = await planTask(props.task.id);
      if (result.ok) {
        setPlanningStatus('completed');
        setSubtasks(result.data.subtasks);
      } else {
        setPlanningStatus('failed');
        setError(result.error.message);
      }
    } catch (err) {
      setPlanningStatus('failed');
      setError(err instanceof Error ? err.message : 'Planning failed');
    } finally {
      setIsPlanning(false);
    }
  }

  /**
   * Handle subtask save
   */
  function handleSubtaskSave(updates: { title: string; description: string }) {
    // In a real implementation, this would call an API to update/create the subtask
    console.log('Subtask save:', editingSubtaskId(), updates);
    setEditingSubtaskId(null);
    loadSubtasks();
  }

  /**
   * Get sorted subtasks
   */
  const sortedSubtasks = () => {
    return [...subtasks()].sort((a, b) => a.orderIndex - b.orderIndex);
  };

  return (
    <div class="planning-panel bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
      {/* Header */}
      <div class="flex items-center justify-between p-4 border-b bg-gray-50">
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
        <div class="planning-status">
          <Show when={planningStatus() === 'pending'}>
            <div class="text-center py-8">
              <div class="text-gray-500 mb-4">
                <Play class="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>Planning has not been started yet.</p>
                <p class="text-sm mt-1">The AI will analyze your task and create subtasks.</p>
              </div>
              <button
                type="button"
                class="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                onClick={startPlanning}
                disabled={isPlanning()}
              >
                <Show when={isPlanning()} fallback="Start Planning">
                  <span class="flex items-center gap-2">
                    <Loader2 class="w-4 h-4 animate-spin" />
                    Starting...
                  </span>
                </Show>
              </button>
            </div>
          </Show>

          <Show when={planningStatus() === 'in_progress'}>
            <div class="flex flex-col items-center justify-center py-8">
              <Loader2 class="w-8 h-8 animate-spin text-blue-500 mb-3" />
              <p class="text-gray-700 font-medium">Planning in progress...</p>
              <p class="text-sm text-gray-500 mt-1">AI is analyzing your task and creating subtasks</p>
            </div>
          </Show>

          <Show when={planningStatus() === 'completed'}>
            <div class="flex items-center gap-2 p-3 bg-green-50 text-green-700 rounded-md">
              <Check class="w-5 h-5" />
              <span>Planning completed - {subtasks().length} subtasks generated</span>
            </div>
          </Show>

          <Show when={planningStatus() === 'failed'}>
            <div class="flex items-start gap-2 p-3 bg-red-50 text-red-700 rounded-md">
              <AlertCircle class="w-5 h-5 flex-shrink-0 mt-0.5" />
              <div>
                <p class="font-medium">Planning failed</p>
                <Show when={error()}>
                  <p class="text-sm mt-1">{error()}</p>
                </Show>
                <button
                  type="button"
                  class="mt-2 px-3 py-1 text-sm bg-red-100 rounded hover:bg-red-200"
                  onClick={startPlanning}
                >
                  Retry
                </button>
              </div>
            </div>
          </Show>
        </div>

        {/* Subtasks List */}
        <Show when={subtasks().length > 0}>
          <div class="subtasks-section">
            <div class="flex items-center justify-between mb-3">
              <h3 class="text-sm font-medium text-gray-700">Generated Subtasks</h3>
              <button
                type="button"
                class="flex items-center gap-1 px-2 py-1 text-sm text-gray-600 hover:text-gray-900"
                onClick={startPlanning}
                disabled={isPlanning()}
              >
                <RefreshCw class={`w-4 h-4 ${isPlanning() ? 'animate-spin' : ''}`} />
                Regenerate
              </button>
            </div>

            <div class="space-y-2">
              <For each={sortedSubtasks()}>
                {(subtask, index) => (
                  <div class="subtask-item border rounded-md p-3">
                    <Show when={editingSubtaskId() === subtask.id}>
                      <SubtaskEditor
                        onSave={handleSubtaskSave}
                        onCancel={() => setEditingSubtaskId(null)}
                      />
                    </Show>

                    <Show when={editingSubtaskId() !== subtask.id}>
                      <div class="flex items-start gap-3">
                        <div class="flex-shrink-0 w-6 h-6 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-sm font-medium">
                          {index() + 1}
                        </div>
                        <div class="flex-1 min-w-0">
                          <h4 class="text-sm font-medium text-gray-900">{subtask.title}</h4>
                          <p class="text-sm text-gray-600 mt-1">{subtask.description}</p>
                        </div>
                        <div class="flex items-center gap-1">
                          <button
                            type="button"
                            class="px-2 py-1 text-xs text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded"
                            onClick={() => setEditingSubtaskId(subtask.id)}
                          >
                            Edit
                          </button>
                        </div>
                      </div>
                    </Show>
                  </div>
                )}
              </For>
            </div>

            {/* Add manual subtask */}
            <Show when={editingSubtaskId() === 'new'}>
              <div class="mt-2 border rounded-md p-3">
                <SubtaskEditor
                  onSave={handleSubtaskSave}
                  onCancel={() => setEditingSubtaskId(null)}
                />
              </div>
            </Show>

            <button
              type="button"
              class="mt-2 w-full py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-50 border border-dashed rounded-md"
              onClick={() => setEditingSubtaskId('new')}
            >
              + Add Subtask
            </button>
          </div>
        </Show>
      </div>

      {/* Footer */}
      <Show when={planningStatus() === 'completed'}>
        <div class="p-4 border-t bg-gray-50 flex justify-end gap-2">
          <button
            type="button"
            class="px-4 py-2 text-gray-700 hover:text-gray-900 border border-gray-300 rounded-md"
            onClick={props.onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
            onClick={props.onPlanningComplete}
          >
            Done - Start Execution
          </button>
        </div>
      </Show>
    </div>
  );
}
