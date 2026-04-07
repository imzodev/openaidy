/**
 * Tasks Page
 *
 * Main task management page with Kanban board, task creation modal,
 * and drag-and-drop status updates.
 */

import { createSignal, createEffect, Show, onMount } from 'solid-js';
import { Layout } from './Layout';
import { KanbanBoard } from '../tasks/KanbanBoard';
import { TaskModal } from '../tasks/TaskModal';
import {
  fetchTasksKanban,
  createTask,
  updateTaskStatus,
  type Task,
  type TaskStatus,
  type CreateTaskInput,
} from '../../lib/api-tasks';
import { listAgents, type Agent } from '../../lib/api';

export function TasksPage() {
  const [refreshTrigger, setRefreshTrigger] = createSignal(0);
  const [isLoading, setIsLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [isModalOpen, setIsModalOpen] = createSignal(false);
  const [selectedTask, setSelectedTask] = createSignal<Task | null>(null);
  const [agents, setAgents] = createSignal<Agent[]>([]);

  // Load agents on mount
  onMount(async () => {
    try {
      const result = await listAgents();
      setAgents(result.items);
    } catch (err) {
      console.error('Failed to load agents:', err);
    }
  });

  const handleTaskClick = (task: Task) => {
    setSelectedTask(task);
    setIsModalOpen(true);
  };

  const handleTaskStatusChange = async (taskId: string, newStatus: TaskStatus) => {
    // The KanbanBoard already optimistically updates, but we can refresh if needed
    // For now, we trust the optimistic update
  };

  const handleTaskCreated = (task: Task) => {
    setIsModalOpen(false);
    setRefreshTrigger((prev) => prev + 1);
  };

  const handleTaskUpdated = (task: Task) => {
    setIsModalOpen(false);
    setSelectedTask(null);
    setRefreshTrigger((prev) => prev + 1);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedTask(null);
  };

  return (
    <Layout
      title="Tasks"
      description="Kanban view of tasks"
      actions={
        <button
          onClick={() => setIsModalOpen(true)}
          class="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
          </svg>
          Create Task
        </button>
      }
    >
      {/* Error state */}
      <Show when={error()}>
        <div class="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p class="text-red-600 dark:text-red-400">{error()}</p>
          <button
            onClick={() => {
              setError(null);
              setRefreshTrigger((prev) => prev + 1);
            }}
            class="mt-2 text-sm text-red-600 hover:text-red-700 underline"
          >
            Try again
          </button>
        </div>
      </Show>

      {/* Kanban Board */}
      <div class="h-[calc(100vh-200px)] min-h-[400px]">
        <KanbanBoard
          onTaskClick={handleTaskClick}
          onTaskStatusChange={handleTaskStatusChange}
          refreshTrigger={refreshTrigger()}
        />
      </div>

      {/* Task Modal */}
      <TaskModal
        isOpen={isModalOpen()}
        onClose={handleCloseModal}
        task={selectedTask() || undefined}
        agents={agents()}
        onTaskCreated={handleTaskCreated}
        onTaskUpdated={handleTaskUpdated}
      />
    </Layout>
  );
}
