/**
 * Tasks Page
 *
 * Main task management page with Kanban board, task creation modal,
 * and drag-and-drop status updates.
 */

import { createSignal, Show, onMount } from 'solid-js';
import { Layout } from './Layout';
import { KanbanBoard } from '../tasks/KanbanBoard';
import { TaskModal } from '../tasks/TaskModal';
import {
  type Task,
  type TaskStatus,
  createTask,
  updateTask,
  executeTask,
  type CreateTaskInput,
} from '../../lib/api-tasks';
import { listAgents, type Agent } from '../../lib/api';

export function TasksPage() {
  const [refreshTrigger, setRefreshTrigger] = createSignal(0);
  const [error, setError] = createSignal<string | null>(null);
  const [isModalOpen, setIsModalOpen] = createSignal(false);
  const [selectedTask, setSelectedTask] = createSignal<Task | null>(null);
  const [agents, setAgents] = createSignal<Agent[]>([]);
  const [executingTasks, setExecutingTasks] = createSignal<Set<string>>(
    new Set(),
  );

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

  const handleTaskStatusChange = async (
    taskId: string,
    newStatus: TaskStatus,
  ) => {
    // Auto-execute when moved to 'todo'
    if (newStatus === 'todo') {
      await handleExecuteTask(taskId);
    }
  };

  const handleExecuteTask = async (taskId: string) => {
    setExecutingTasks((prev) => new Set(prev).add(taskId));
    try {
      const result = await executeTask(taskId);
      if (result.ok) {
        // Task started successfully - refresh to show updated state
        setRefreshTrigger((prev) => prev + 1);
      } else {
        setError(`Failed to execute task: ${result.error.message}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to execute task');
    } finally {
      setExecutingTasks((prev) => {
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });
    }
  };

  const handleTaskCreated = (_task: Task) => {
    setIsModalOpen(false);
    setRefreshTrigger((prev) => prev + 1);
  };

  const handleTaskUpdated = (_task: Task) => {
    setIsModalOpen(false);
    setSelectedTask(null);
    setRefreshTrigger((prev) => prev + 1);
  };

  const handleSubmit = async (input: CreateTaskInput) => {
    const task = selectedTask();
    if (task) {
      // Update existing task
      const result = await updateTask(task.id, input);
      if (result.ok) {
        handleTaskUpdated(result.data);
      } else {
        throw new Error(result.error.message);
      }
    } else {
      // Create new task
      const result = await createTask(input);
      if (result.ok) {
        handleTaskCreated(result.data);
      } else {
        throw new Error(result.error.message);
      }
    }
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
          <svg
            class="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12 4v16m8-8H4"
            />
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
          onExecuteTask={handleExecuteTask}
          executingTasks={executingTasks()}
          refreshTrigger={refreshTrigger()}
        />
      </div>

      {/* Task Modal */}
      <TaskModal
        isOpen={isModalOpen()}
        onClose={handleCloseModal}
        task={selectedTask() || undefined}
        agents={agents()}
        onSubmit={handleSubmit}
      />
    </Layout>
  );
}
