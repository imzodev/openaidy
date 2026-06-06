/**
 * Task Card Component
 *
 * Displays a single task in the Kanban board with title, priority badge,
 * and agent avatars. Supports drag-and-drop and click to open detail view.
 */

import { Show, createResource } from 'solid-js';
import { Play, Loader2, CheckCircle2, AlertCircle, Repeat } from 'lucide-solid';
import type { Task, TaskPriority } from '../../lib/api-tasks';
import { getTaskSchedule } from '../../lib/api-tasks';

/**
 * Priority badge colors
 */
const PRIORITY_COLORS: Record<TaskPriority, string> = {
  low: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  medium: 'bg-blue-100 text-blue-600 dark:bg-blue-900/50 dark:text-blue-300',
  high: 'bg-orange-100 text-orange-600 dark:bg-orange-900/50 dark:text-orange-300',
  urgent: 'bg-red-100 text-red-600 dark:bg-red-900/50 dark:text-red-300',
};

/**
 * TaskCard Props
 */
export type TaskCardProps = {
  task: Task;
  onClick?: () => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  isDragging?: boolean;
  onExecute?: () => void;
  isExecuting?: boolean;
};

/**
 * TaskCard Component
 */
export function TaskCard(props: TaskCardProps) {
  function handleDragStart(e: DragEvent) {
    e.dataTransfer!.effectAllowed = 'move';
    e.dataTransfer!.setData('text/plain', props.task.id);
    props.onDragStart?.();
  }

  function handleDragEnd() {
    props.onDragEnd?.();
  }

  const cardClass = () => {
    let base =
      'task-card bg-white dark:bg-gray-800 dark:border dark:border-gray-700 rounded-md shadow-sm p-3 cursor-pointer hover:shadow-md transition-shadow';
    if (props.isDragging) {
      base += ' opacity-50';
    }
    return base;
  };

  return (
    <div
      class={cardClass()}
      draggable={true}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onClick={props.onClick}
    >
      {/* Recurring schedule badge */}
      <ScheduleBadge taskId={props.task.id} />

      {/* Title */}
      <h4 class="font-medium text-gray-900 dark:text-gray-100 text-sm mb-2 line-clamp-2">
        {props.task.title}
      </h4>

      {/* Priority Badge and Planning Status */}
      <div class="flex items-center gap-2">
        <span
          class={`text-xs px-2 py-0.5 rounded ${PRIORITY_COLORS[props.task.priority]}`}
        >
          {props.task.priority}
        </span>

        {/* Planning status indicator */}
        <Show when={props.task.planningEnabled}>
          <Show when={props.task.planningStatus === 'in_progress'}>
            <span
              class="text-xs text-blue-500 dark:text-blue-400 flex items-center gap-1"
              title="Planning in progress..."
            >
              <Loader2 class="w-3 h-3 animate-spin" />
            </span>
          </Show>
          <Show when={props.task.planningStatus === 'completed'}>
            <span
              class="text-xs text-green-500 dark:text-green-400 flex items-center gap-1"
              title="Planning complete"
            >
              <CheckCircle2 class="w-3 h-3" />
            </span>
          </Show>
          <Show when={props.task.planningStatus === 'failed'}>
            <span
              class="text-xs text-red-500 dark:text-red-400 flex items-center gap-1"
              title="Planning failed"
            >
              <AlertCircle class="w-3 h-3" />
            </span>
          </Show>
          <Show
            when={
              props.task.planningStatus === 'pending' ||
              !props.task.planningStatus
            }
          >
            <span
              class="text-xs text-purple-500 dark:text-purple-400 flex items-center gap-1"
              title="Planning pending"
            >
              🧠
            </span>
          </Show>
        </Show>
      </div>

      {/* Description preview */}
      <Show when={props.task.description}>
        <p class="mt-2 text-xs text-gray-500 dark:text-gray-400 line-clamp-2">
          {props.task.description}
        </p>
      </Show>

      {/* Execute button - show for backlog/todo tasks */}
      <Show
        when={
          props.onExecute &&
          (props.task.status === 'backlog' || props.task.status === 'todo')
        }
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            props.onExecute?.();
          }}
          disabled={
            props.isExecuting || props.task.planningStatus === 'in_progress'
          }
          title={
            props.task.planningStatus === 'in_progress'
              ? 'Planning in progress...'
              : props.task.planningStatus === 'failed'
                ? 'Planning failed - retry or edit task'
                : ''
          }
          class="mt-3 w-full flex items-center justify-center gap-1 px-2 py-1 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed rounded transition-colors"
        >
          <Show
            when={props.isExecuting}
            fallback={
              <>
                <Play class="w-3 h-3" />
                <Show
                  when={props.task.planningStatus === 'in_progress'}
                  fallback="Start Task"
                >
                  Planning...
                </Show>
              </>
            }
          >
            Starting...
          </Show>
        </button>
      </Show>
    </div>
  );
}

/**
 * Internal badge that fetches the schedule for a task and displays
 * a recurring indicator if one exists.
 */
function ScheduleBadge(props: { taskId: string }) {
  const [schedule] = createResource(
    () => props.taskId,
    async (id) => {
      try {
        return await getTaskSchedule(id);
      } catch {
        return null;
      }
    },
  );

  return (
    <Show when={schedule()}>
      {(s) => (
        <div class="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 mb-1">
          <Repeat class="w-3 h-3" />
          <span>{s().scheduleHuman}</span>
          <Show when={s().status === 'paused'}>
            <span class="px-1.5 py-0.5 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 rounded text-xs">
              paused
            </span>
          </Show>
        </div>
      )}
    </Show>
  );
}
