/**
 * Kanban Board Component
 *
 * Displays tasks in columns organized by status, with drag-and-drop
 * support for changing task status.
 */

import { createSignal, createEffect, onMount, For, Show } from 'solid-js';
import { KanbanColumn } from './KanbanColumn';
import { TaskCard } from './TaskCard';
import {
  fetchTasksKanban,
  updateTaskStatus,
  type Task,
  type KanbanBoard,
  type TaskStatus,
} from '../../lib/api-tasks';

/**
 * Column configuration with display names and colors
 */
const COLUMN_CONFIG: Array<{
  status: TaskStatus;
  title: string;
  color: string;
}> = [
  { status: 'backlog', title: 'Backlog', color: 'bg-gray-100' },
  { status: 'todo', title: 'To Do', color: 'bg-blue-50' },
  { status: 'in_progress', title: 'In Progress', color: 'bg-yellow-50' },
  { status: 'review', title: 'Review', color: 'bg-purple-50' },
  { status: 'done', title: 'Done', color: 'bg-green-50' },
  { status: 'cancelled', title: 'Cancelled', color: 'bg-red-50' },
];

/**
 * KanbanBoard Props
 */
export type KanbanBoardProps = {
  onTaskClick?: (task: Task) => void;
  onTaskStatusChange?: (taskId: string, newStatus: TaskStatus) => void;
  refreshTrigger?: number;
};

/**
 * KanbanBoard Component
 */
export function KanbanBoard(props: KanbanBoardProps) {
  const [board, setBoard] = createSignal<KanbanBoard | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [draggedTask, setDraggedTask] = createSignal<{ task: Task; sourceStatus: TaskStatus } | null>(null);

  /**
   * Load kanban board data
   */
  async function loadBoard() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchTasksKanban();
      setBoard(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }

  // Load on mount and when refreshTrigger changes
  onMount(loadBoard);
  createEffect(() => {
    if (props.refreshTrigger !== undefined) {
      loadBoard();
    }
  });

  /**
   * Handle drag start
   */
  function handleDragStart(task: Task, sourceStatus: TaskStatus) {
    setDraggedTask({ task, sourceStatus });
  }

  /**
   * Handle drop on a column
   */
  async function handleDrop(targetStatus: TaskStatus) {
    const dragInfo = draggedTask();
    if (!dragInfo) return;

    const { task, sourceStatus } = dragInfo;
    if (sourceStatus === targetStatus) {
      setDraggedTask(null);
      return;
    }

    try {
      const result = await updateTaskStatus(task.id, targetStatus);
      if (result.ok) {
        props.onTaskStatusChange?.(task.id, targetStatus);
        // Optimistically update local state
        setBoard((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            [sourceStatus]: prev[sourceStatus].filter((t) => t.id !== task.id),
            [targetStatus]: [...prev[targetStatus], { ...task, status: targetStatus }],
          };
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update task status');
    } finally {
      setDraggedTask(null);
    }
  }

  /**
   * Handle drag end (cancelled)
   */
  function handleDragEnd() {
    setDraggedTask(null);
  }

  return (
    <div class="kanban-board h-full overflow-x-auto">
      <Show when={loading()}>
        <div class="flex items-center justify-center h-64">
          <div class="text-gray-500">Loading tasks...</div>
        </div>
      </Show>

      <Show when={error()}>
        <div class="flex items-center justify-center h-64">
          <div class="text-red-500">{error()}</div>
        </div>
      </Show>

      <Show when={!loading() && !error() && board()}>
        <div class="flex gap-4 h-full p-4">
          <For each={COLUMN_CONFIG}>
            {(column) => (
              <KanbanColumn
                status={column.status}
                title={column.title}
                color={column.color}
                tasks={board()![column.status]}
                onDrop={() => handleDrop(column.status)}
                isDropTarget={draggedTask()?.sourceStatus !== column.status && draggedTask() !== null}
              >
                <For each={board()![column.status]}>
                  {(task) => (
                    <TaskCard
                      task={task}
                      onClick={() => props.onTaskClick?.(task)}
                      onDragStart={() => handleDragStart(task, column.status)}
                      onDragEnd={handleDragEnd}
                      isDragging={draggedTask()?.task.id === task.id}
                    />
                  )}
                </For>
              </KanbanColumn>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
