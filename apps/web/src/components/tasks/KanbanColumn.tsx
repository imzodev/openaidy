/**
 * Kanban Column Component
 *
 * Displays a single column in the Kanban board with a header
 * showing the status name and count, and a drop zone for cards.
 */

import { createSignal, Show, type JSX } from 'solid-js';
import type { Task, TaskStatus } from '../../lib/api-tasks';

/**
 * KanbanColumn Props
 */
export type KanbanColumnProps = {
  status: TaskStatus;
  title: string;
  color: string;
  tasks: Task[];
  onDrop: () => void;
  isDropTarget: boolean;
  children: JSX.Element;
};

/**
 * KanbanColumn Component
 */
export function KanbanColumn(props: KanbanColumnProps) {
  const [isOver, setIsOver] = createSignal(false);

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'move';
    setIsOver(true);
  }

  function handleDragLeave() {
    setIsOver(false);
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setIsOver(false);
    props.onDrop();
  }

  const columnClass = () => {
    let base = 'kanban-column flex flex-col w-72 min-w-[288px] rounded-lg shadow-sm';
    if (props.isDropTarget && isOver()) {
      base += ' ring-2 ring-blue-400 ring-inset';
    }
    return base;
  };

  return (
    <div
      class={columnClass()}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Column Header */}
      <div class={`px-3 py-2 rounded-t-lg ${props.color}`}>
        <div class="flex items-center justify-between">
          <h3 class="font-medium text-gray-700">{props.title}</h3>
          <span class="text-sm text-gray-500 bg-white px-2 py-0.5 rounded-full">
            {props.tasks.length}
          </span>
        </div>
      </div>

      {/* Cards Container */}
      <div class="flex-1 overflow-y-auto p-2 space-y-2 bg-gray-50 rounded-b-lg min-h-[200px]">
        <Show when={props.tasks.length === 0}>
          <div class="flex items-center justify-center h-32 text-gray-400 text-sm">
            No tasks
          </div>
        </Show>
        {props.children}
      </div>
    </div>
  );
}
