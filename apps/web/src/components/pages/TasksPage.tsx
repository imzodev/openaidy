/**
 * Tasks Page
 *
 * Main task management page with Kanban board, task creation modal,
 * and drag-and-drop status updates.
 */

import { createSignal, Show, onMount, onCleanup } from 'solid-js';
import { Layout } from './Layout';
import { KanbanBoard } from '../tasks/KanbanBoard';
import { TaskModal } from '../tasks/TaskModal';
import { TaskDetailPanel } from '../tasks/TaskDetailPanel';
import {
  type Task,
  type TaskStatus,
  createTask,
  updateTask,
  executeTask,
  getTask,
  type CreateTaskInput,
  type AgentRole,
} from '../../lib/api-tasks';
import { listAgents, type Agent } from '../../lib/api';

export function TasksPage() {
  const [refreshTrigger, setRefreshTrigger] = createSignal(0);
  const [error, setError] = createSignal<string | null>(null);
  const [isModalOpen, setIsModalOpen] = createSignal(false);
  const [selectedTask, setSelectedTask] = createSignal<Task | null>(null);
  const [selectedTaskAgents, setSelectedTaskAgents] = createSignal<
    Array<{ agentId: string; role?: AgentRole }>
  >([]);
  const [agents, setAgents] = createSignal<Agent[]>([]);
  const [executingTasks, setExecutingTasks] = createSignal<Set<string>>(
    new Set(),
  );
  const [detailTaskId, setDetailTaskId] = createSignal<string | null>(null);
  // Track tasks with planning in progress for polling
  const [planningTasks, setPlanningTasks] = createSignal<Set<string>>(
    new Set(),
  );
  let pollingInterval: number | null = null;

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
    setDetailTaskId(task.id);
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

  const handleTaskCreated = (task: Task) => {
    setIsModalOpen(false);
    setRefreshTrigger((prev) => prev + 1);

    // Start polling if planning is enabled
    if (task.planningEnabled && task.planningStatus === 'pending') {
      startPlanningPolling(task.id);
    }
  };

  const handleTaskUpdated = (_task: Task) => {
    setIsModalOpen(false);
    setSelectedTask(null);
    setSelectedTaskAgents([]);
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
    setSelectedTaskAgents([]);
  };

  const handleCloseDetail = () => {
    setDetailTaskId(null);
  };

  const handleDetailTaskUpdated = () => {
    setRefreshTrigger((prev) => prev + 1);
  };

  const handleDetailTaskDeleted = () => {
    setDetailTaskId(null);
    setRefreshTrigger((prev) => prev + 1);
  };

  /**
   * Start polling for planning status updates
   */
  function startPlanningPolling(taskId: string) {
    setPlanningTasks((prev) => new Set(prev).add(taskId));

    if (!pollingInterval) {
      pollingInterval = window.setInterval(() => {
        pollPlanningStatus();
      }, 3000);
    }
  }

  /**
   * Stop polling when no more tasks need monitoring
   */
  function stopPlanningPolling() {
    if (pollingInterval) {
      clearInterval(pollingInterval);
      pollingInterval = null;
    }
  }

  /**
   * Poll planning status for all tracked tasks
   */
  async function pollPlanningStatus() {
    const tasksToPoll = Array.from(planningTasks());
    if (tasksToPoll.length === 0) {
      stopPlanningPolling();
      return;
    }

    let hasChanges = false;

    for (const taskId of tasksToPoll) {
      try {
        const result = await getTask(taskId);
        if (result.ok) {
          const task = result.data;

          // Check if planning is complete or failed
          if (
            task.planningStatus === 'completed' ||
            task.planningStatus === 'failed'
          ) {
            setPlanningTasks((prev) => {
              const next = new Set(prev);
              next.delete(taskId);
              return next;
            });
            hasChanges = true;

            // Show notification
            if (task.planningStatus === 'completed') {
              console.log(
                `Task "${task.title}" planning completed with ${task.subtasks.length} subtasks`,
              );
            } else {
              console.warn(`Task "${task.title}" planning failed`);
            }
          }
        }
      } catch (err) {
        console.error(`Failed to poll task ${taskId}:`, err);
      }
    }

    // Refresh kanban board if any tasks changed
    if (hasChanges) {
      setRefreshTrigger((prev) => prev + 1);
    }

    // Stop polling if no more tasks
    if (planningTasks().size === 0) {
      stopPlanningPolling();
    }
  }

  // Cleanup polling on unmount
  onCleanup(() => {
    stopPlanningPolling();
  });

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

      {/* Task Modal (create only) */}
      <TaskModal
        isOpen={isModalOpen()}
        onClose={handleCloseModal}
        task={selectedTask() || undefined}
        initialSelectedAgents={selectedTaskAgents()}
        agents={agents()}
        onSubmit={handleSubmit}
      />

      {/* Task Detail Panel (view + subtasks) */}
      <Show when={detailTaskId()}>
        <div
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={(e) => {
            if (e.target === e.currentTarget) handleCloseDetail();
          }}
        >
          <TaskDetailPanel
            taskId={detailTaskId()!}
            agents={agents()}
            onClose={handleCloseDetail}
            onTaskUpdated={handleDetailTaskUpdated}
            onTaskDeleted={handleDetailTaskDeleted}
          />
        </div>
      </Show>
    </Layout>
  );
}
