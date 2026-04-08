/**
 * Task Card Component
 *
 * Displays a single task in the Kanban board with title, priority badge,
 * and agent avatars. Supports drag-and-drop and click to open detail view.
 */

import { Show } from 'solid-js';
import type { Task, TaskPriority } from '../../lib/api-tasks';

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
 * TaskCard Props
 */
export type TaskCardProps = {
  task: Task;
  onClick?: () => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  isDragging?: boolean;
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
    let base = 'task-card bg-white rounded-md shadow-sm p-3 cursor-pointer hover:shadow-md transition-shadow';
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
      {/* Title */}
      <h4 class="font-medium text-gray-900 text-sm mb-2 line-clamp-2">
        {props.task.title}
      </h4>

      {/* Priority Badge */}
      <div class="flex items-center gap-2">
        <span class={`text-xs px-2 py-0.5 rounded ${PRIORITY_COLORS[props.task.priority]}`}>
          {props.task.priority}
        </span>

        {/* Planning indicator */}
        <Show when={props.task.planningEnabled}>
          <span class="text-xs text-purple-500" title="Planning enabled">
            🧠
          </span>
        </Show>
      </div>

      {/* Description preview */}
      <Show when={props.task.description}>
        <p class="mt-2 text-xs text-gray-500 line-clamp-2">
          {props.task.description}
        </p>
      </Show>
    </div>
  );
}
