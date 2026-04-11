/**
 * Progress Bar Component
 *
 * Displays task/subtask execution progress with live updates.
 */

import { createSignal, Show } from 'solid-js';

/**
 * Task progress data
 */
export type TaskProgress = {
  taskId: string;
  total: number;
  completed: number;
  inProgress: number;
  pending: number;
  failed: number;
  percentage: number;
};

/**
 * ProgressBar Props
 */
export type ProgressBarProps = {
  taskId: string;
  initialProgress?: Partial<TaskProgress>;
  showDetails?: boolean;
  onComplete?: () => void;
  onProgress?: (progress: TaskProgress) => void;
};

/**
 * Get status color based on progress
 */
function getStatusColor(progress: TaskProgress): string {
  if (progress.failed > 0) return 'bg-red-500';
  if (progress.percentage === 100) return 'bg-green-500';
  if (progress.inProgress > 0) return 'bg-blue-500';
  return 'bg-gray-300';
}

/**
 * Get status text color based on progress
 */
function getStatusTextColor(progress: TaskProgress): string {
  if (progress.failed > 0) return 'text-red-600';
  if (progress.percentage === 100) return 'text-green-600';
  if (progress.inProgress > 0) return 'text-blue-600';
  return 'text-gray-500';
}

/**
 * ProgressBar Component
 */
export function ProgressBar(props: ProgressBarProps) {
  const defaultProgress: TaskProgress = {
    taskId: props.taskId,
    total: 0,
    completed: 0,
    inProgress: 0,
    pending: 0,
    failed: 0,
    percentage: 0,
    ...props.initialProgress,
  };

  const [progress] = createSignal<TaskProgress>(defaultProgress);

  return (
    <div class="progress-bar-container space-y-2">
      {/* Main progress bar */}
      <div class="flex items-center gap-3">
        <div class="flex-1 h-3 bg-gray-200 rounded-full overflow-hidden">
          <div
            class={`h-full transition-all duration-300 ease-out ${getStatusColor(progress())}`}
            style={{ width: `${progress().percentage}%` }}
          />
        </div>
        <span class={`text-sm font-medium min-w-[3rem] text-right ${getStatusTextColor(progress())}`}>
          {Math.round(progress().percentage)}%
        </span>
      </div>

      {/* Detailed breakdown */}
      <Show when={props.showDetails}>
        <div class="progress-details grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div class="flex items-center gap-2">
            <span class="w-2 h-2 rounded-full bg-green-500" />
            <span class="text-gray-500">Completed:</span>
            <span class="font-medium text-green-600">{progress().completed}</span>
          </div>

          <div class="flex items-center gap-2">
            <span class="w-2 h-2 rounded-full bg-blue-500" />
            <span class="text-gray-500">In Progress:</span>
            <span class="font-medium text-blue-600">{progress().inProgress}</span>
          </div>

          <div class="flex items-center gap-2">
            <span class="w-2 h-2 rounded-full bg-gray-300" />
            <span class="text-gray-500">Pending:</span>
            <span class="font-medium text-gray-600">{progress().pending}</span>
          </div>

          <Show when={progress().failed > 0}>
            <div class="flex items-center gap-2">
              <span class="w-2 h-2 rounded-full bg-red-500" />
              <span class="text-gray-500">Failed:</span>
              <span class="font-medium text-red-600">{progress().failed}</span>
            </div>
          </Show>
        </div>

        {/* Total subtasks */}
        <div class="text-xs text-gray-400 mt-1">
          {progress().total} subtask{progress().total !== 1 ? 's' : ''} total
        </div>
      </Show>
    </div>
  );
}

/**
 * Create a progress controller for external updates
 */
export function createProgressController(
  updateFn: (progress: Partial<TaskProgress>) => void
) {
  return {
    update: updateFn,
    setCompleted: (count: number) => updateFn({ completed: count }),
    setInProgress: (count: number) => updateFn({ inProgress: count }),
    setPending: (count: number) => updateFn({ pending: count }),
    setFailed: (count: number) => updateFn({ failed: count }),
    setTotal: (count: number) => updateFn({ total: count }),
    setPercentage: (pct: number) => updateFn({ percentage: pct }),
  };
}
