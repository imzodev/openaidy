/**
 * Subtask List Component
 *
 * Displays a list of subtasks with status indicators and agent assignments.
 */

import { Show, For, createSignal } from 'solid-js';
import {
  CheckCircle,
  RotateCcw,
  ExternalLink,
  Pencil,
  Check,
  X,
} from 'lucide-solid';
import type { Subtask } from '../../lib/api-tasks';
import { updateSubtask, assignSubtaskAgent } from '../../lib/api-tasks';
import type { Agent } from './AgentSelector';

/**
 * Statuses where a subtask may still be edited/reassigned — after planning but
 * before it runs, or after a failure (so it can be tweaked and retried).
 * In-progress and completed subtasks are left alone.
 */
const EDITABLE_STATUSES = new Set(['pending', 'assigned', 'failed']);

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
  // Inline edit state. Only one subtask edits at a time, so single draft
  // signals are enough. `editingId` gates which row shows the editor.
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [draftDescription, setDraftDescription] = createSignal('');
  const [draftAgentId, setDraftAgentId] = createSignal('');
  const [saving, setSaving] = createSignal(false);
  const [editError, setEditError] = createSignal<string | null>(null);

  const canEdit = (subtask: Subtask) => EDITABLE_STATUSES.has(subtask.status);

  function startEdit(subtask: Subtask) {
    setEditError(null);
    setDraftDescription(subtask.description);
    setDraftAgentId(subtask.assignedAgentId ?? '');
    setEditingId(subtask.id);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditError(null);
  }

  async function saveEdit(subtask: Subtask) {
    setSaving(true);
    setEditError(null);
    try {
      const description = draftDescription().trim();
      const agentId = draftAgentId();

      // Only persist what actually changed. Description must be non-empty
      // (server requires min length); an unchanged/empty pick is a no-op.
      if (description && description !== subtask.description) {
        const res = await updateSubtask(subtask.id, { description });
        if (!res.ok) {
          setEditError(res.error.message);
          return;
        }
      }
      if (agentId && agentId !== (subtask.assignedAgentId ?? '')) {
        const res = await assignSubtaskAgent(subtask.id, agentId);
        if (!res.ok) {
          setEditError(res.error.message);
          return;
        }
      }

      setEditingId(null);
      props.onSubtaskUpdate?.();
    } finally {
      setSaving(false);
    }
  }

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

                <Show
                  when={editingId() === subtask.id}
                  fallback={
                    <>
                      <Show when={subtask.description}>
                        <p class="text-sm text-gray-600 dark:text-gray-400 mt-1 whitespace-pre-wrap break-words">
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
                    </>
                  }
                >
                  {/* Inline editor — description + a small agent quick-selector */}
                  <div class="mt-1 space-y-2">
                    <textarea
                      class="w-full text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1.5 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary resize-y"
                      rows={2}
                      value={draftDescription()}
                      onInput={(e) =>
                        setDraftDescription(e.currentTarget.value)
                      }
                      placeholder="Subtask description"
                      disabled={saving()}
                    />
                    <div class="flex flex-wrap items-center gap-2">
                      <select
                        class="min-w-0 max-w-full sm:max-w-[14rem] text-xs rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
                        value={draftAgentId()}
                        onChange={(e) => setDraftAgentId(e.currentTarget.value)}
                        disabled={saving()}
                        aria-label="Assign agent"
                      >
                        <option value="">Select agent…</option>
                        <For each={props.agents ?? []}>
                          {(agent) => (
                            <option value={agent.id}>{agent.name}</option>
                          )}
                        </For>
                      </select>
                      <div class="flex items-center gap-1 ml-auto">
                        <button
                          type="button"
                          onClick={() => void saveEdit(subtask)}
                          disabled={saving()}
                          class="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 dark:hover:bg-green-900/30 rounded transition-colors disabled:opacity-50"
                          title="Save changes"
                        >
                          <Check class="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={cancelEdit}
                          disabled={saving()}
                          class="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 rounded transition-colors disabled:opacity-50"
                          title="Cancel"
                        >
                          <X class="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    <Show when={editError()}>
                      <p class="text-xs text-red-500">{editError()}</p>
                    </Show>
                  </div>
                </Show>
              </div>

              {/* Edit (description + agent) — minimal icon, only for
                  editable statuses and when not already editing this row. */}
              <Show when={canEdit(subtask) && editingId() !== subtask.id}>
                <button
                  type="button"
                  onClick={() => startEdit(subtask)}
                  class="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded transition-colors flex-shrink-0"
                  title="Edit description / assign agent"
                >
                  <Pencil class="w-4 h-4" />
                </button>
              </Show>

              <Show when={subtask.sessionId}>
                <a
                  href={`/chat?sessionId=${subtask.sessionId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded transition-colors inline-flex flex-shrink-0"
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
