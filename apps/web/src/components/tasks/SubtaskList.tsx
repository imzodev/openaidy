/**
 * Subtask List Component
 *
 * Displays a list of subtasks with status indicators and agent assignments.
 */

import { Show, For } from 'solid-js';
import { CheckCircle, RotateCcw, ExternalLink } from 'lucide-solid';
import type { Subtask } from '../../lib/api-tasks';
import type { Agent } from './AgentSelector';

/**
 * SubtaskList Props
 */
export type SubtaskListProps = {
  subtasks: Subtask[];
  agents?: Agent[];
  onSubtaskUpdate?: () => void;
  onCompleteSubtask?: (subtaskId: string) => void;
  onRetrySubtask?: (subtaskId: string) => void;
};

/**
 * Status icons
 */
const STATUS_ICONS: Record<string, string> = {
  pending: '○',
  assigned: '●',
  in_progress: '▶',
  completed: '✓',
  failed: '✗',
};

/**
 * Status colors
 */
const STATUS_COLORS: Record<string, string> = {
  pending: 'text-gray-400',
  assigned: 'text-blue-400',
  in_progress: 'text-yellow-500',
  completed: 'text-green-500',
  failed: 'text-red-500',
};

/**
 * SubtaskList Component
 */
export function SubtaskList(props: SubtaskListProps) {
  /**
   * Sort subtasks by orderIndex
   */
  const sortedSubtasks = () => {
    return [...props.subtasks].sort((a, b) => a.orderIndex - b.orderIndex);
  };

  /**
   * Get agent name by ID
   */
  function getAgentName(agentId: string | null): string | undefined {
    if (!agentId || !props.agents) return undefined;
    return props.agents.find((a) => a.id === agentId)?.name;
  }

  return (
    <div class="subtask-list space-y-2">
      <Show when={props.subtasks.length === 0}>
        <div class="text-sm text-gray-500 dark:text-gray-400 py-4 text-center">
          No subtasks yet
        </div>
      </Show>

      <For each={sortedSubtasks()}>
        {(subtask) => (
          <div
            class={`subtask-item p-3 rounded-md border ${
              subtask.status === 'completed'
                ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                : subtask.status === 'failed'
                  ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
                  : subtask.status === 'in_progress'
                    ? 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800'
                    : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700'
            }`}
          >
            <div class="flex items-start gap-3">
              {/* Status icon */}
              <span class={`text-lg ${STATUS_COLORS[subtask.status]}`}>
                {STATUS_ICONS[subtask.status]}
              </span>

              {/* Content */}
              <div class="flex-1 min-w-0">
                <h4 class="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {subtask.title}
                </h4>
                <Show when={subtask.description}>
                  <p class="text-sm text-gray-600 dark:text-gray-400 mt-1">
                    {subtask.description}
                  </p>
                </Show>
                <Show when={subtask.assignedAgentId}>
                  <p class="text-xs text-purple-600 dark:text-purple-400 mt-1">
                    Assigned to:{' '}
                    {getAgentName(subtask.assignedAgentId) ??
                      subtask.assignedAgentId}
                  </p>
                </Show>
              </div>

              <Show when={subtask.sessionId}>
                <a
                  href={`/chat?sessionId=${subtask.sessionId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded transition-colors inline-flex"
                  title="Open session in new tab"
                  onClick={(e) => {
                    // Ensure the link opens properly even if there are event handling issues
                    e.stopPropagation();
                  }}
                >
                  <ExternalLink class="w-4 h-4" />
                </a>
              </Show>

              {/* Action buttons for stuck subtasks */}
              <Show when={subtask.status === 'in_progress'}>
                <div class="flex items-center gap-1 ml-1">
                  <Show when={props.onCompleteSubtask}>
                    <button
                      type="button"
                      onClick={() => props.onCompleteSubtask!(subtask.id)}
                      class="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 dark:hover:bg-green-900/30 rounded transition-colors"
                      title="Mark as complete"
                    >
                      <CheckCircle class="w-4 h-4" />
                    </button>
                  </Show>
                  <Show when={props.onRetrySubtask}>
                    <button
                      type="button"
                      onClick={() => props.onRetrySubtask!(subtask.id)}
                      class="p-1.5 text-gray-400 hover:text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-900/30 rounded transition-colors"
                      title="Retry subtask"
                    >
                      <RotateCcw class="w-4 h-4" />
                    </button>
                  </Show>
                </div>
              </Show>
            </div>
          </div>
        )}
      </For>
    </div>
  );
}
