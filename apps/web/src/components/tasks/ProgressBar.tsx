/**
 * Progress Bar Component
 *
 * Displays task/subtask execution progress with optional real-time updates.
 */

import { createSignal, createEffect, Show, onCleanup } from 'solid-js';
import { getTaskProgress } from '../../lib/api-tasks';
import type { TaskStatus } from '../../lib/api-tasks';

/**
 * TaskProgress type
 */
export type TaskProgress = {
  total: number;
  completed: number;
  inProgress: number;
  failed: number;
  pending: number;
};

/**
 * ProgressBar Props
 */
export type ProgressBarProps = {
  taskId: string;
  initialProgress?: TaskProgress;
  showDetails?: boolean;
  pollInterval?: number;
  onComplete?: () => void;
  onProgress?: (progress: TaskProgress) => void;
};

/**
 * Get status color based on progress
 */
function getStatusColor(progress: TaskProgress): string {
  if (progress.failed > 0) return 'bg-red-500';
  if (progress.completed === progress.total && progress.total > 0) return 'bg-green-500';
  if (progress.inProgress > 0) return 'bg-blue-500';
  return 'bg-gray-300';
}

/**
 * Calculate percentage
 */
function calculatePercentage(progress: TaskProgress): number {
  if (progress.total === 0) return 0;
  return Math.round((progress.completed / progress.total) * 100);
}

/**
 * ProgressBar Component
 */
export function ProgressBar(props: ProgressBarProps) {
  const [progress, setProgress] = createSignal<TaskProgress>(
    props.initialProgress || {
      total: 0,
      completed: 0,
      inProgress: 0,
      failed: 0,
      pending: 0,
    }
  );

  const [isLoading, setIsLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  // Poll for progress updates
  createEffect(() => {
    const poll = async () => {
      setIsLoading(true);
      try {
        const result = await getTaskProgress(props.taskId);
        if (result.ok) {
          const newProgress = result.data;
          setProgress(newProgress);
          props.onProgress?.(newProgress);

          // Check for completion
          if (newProgress.completed === newProgress.total && newProgress.total > 0) {
            props.onComplete?.();
          }
        } else {
          setError(result.error.message);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch progress');
      } finally {
        setIsLoading(false);
      }
    };

    // Initial load
    poll();

    // Set up polling if interval is specified
    const interval = props.pollInterval;
    if (interval && interval > 0) {
      const timer = setInterval(poll, interval);
      onCleanup(() => clearInterval(timer));
    }
  });

  const percentage = () => calculatePercentage(progress());
  const statusColor = () => getStatusColor(progress());

  return (
    <div class="progress-bar-container">
      {/* Error state */}
      <Show when={error()}>
        <div class="text-sm text-red-600 mb-2">{error()}</div>
      </Show>

      {/* Main progress bar */}
      <div class="flex items-center gap-3">
        <div class="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
          <div
            class={`h-full transition-all duration-300 ${statusColor()}`}
            style={{ width: `${percentage()}%` }}
          />
        </div>
        <span class="text-sm font-medium text-gray-700 min-w-[3rem] text-right">
          {percentage()}%
        </span>
      </div>

      {/* Detailed breakdown */}
      <Show when={props.showDetails}>
        <div class="mt-2 grid grid-cols-4 gap-2 text-xs">
          <div class="flex items-center gap-1">
            <span class="w-2 h-2 rounded-full bg-green-500" />
            <span class="text-gray-600">Completed:</span>
            <span class="font-medium text-green-700">{progress().completed}</span>
          </div>
          <div class="flex items-center gap-1">
            <span class="w-2 h-2 rounded-full bg-blue-500" />
            <span class="text-gray-600">In Progress:</span>
            <span class="font-medium text-blue-700">{progress().inProgress}</span>
          </div>
          <div class="flex items-center gap-1">
            <span class="w-2 h-2 rounded-full bg-gray-400" />
            <span class="text-gray-600">Pending:</span>
            <span class="font-medium text-gray-700">{progress().pending}</span>
          </div>
          <Show when={progress().failed > 0}>
            <div class="flex items-center gap-1">
              <span class="w-2 h-2 rounded-full bg-red-500" />
              <span class="text-gray-600">Failed:</span>
              <span class="font-medium text-red-700">{progress().failed}</span>
            </div>
          </Show>
        </div>
      </Show>

      {/* Summary */}
      <Show when={!props.showDetails}>
        <div class="mt-1 text-xs text-gray-500">
          {progress().completed} / {progress().total} subtasks
        </div>
      </Show>
    </div>
  );
}
