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
import { TaskExecutionsPage } from './TaskExecutionsPage';
import {
  type Task,
  type TaskStatus,
  createTask,
  updateTask,
  executeTask,
  getTask,
  type CreateTaskInput,
  type UpdateTaskInput,
  type AgentRole,
} from '../../lib/api-tasks';
import { listAgents, type Agent } from '../../lib/api';
import { useEscapeKey } from '../settings/hooks';

export type TasksPageProps = {
  onOpenSession: (sessionId: string) => void;
};

export function TasksPage(props: TasksPageProps) {
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
  // Sub-view inside the task detail overlay. When the user clicks
  // "View execution history" we switch to `executions` (still bound
  // to the same `detailTaskId`). Going back returns to `detail`.
  const [detailView, setDetailView] = createSignal<'detail' | 'executions'>(
    'detail',
  );
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
      // Update existing task. PATCH /tasks/:id does NOT accept
      // `schedule` — the server silently strips it, which would
      // give the false impression the schedule was removed from
      // the task view. Schedules have their own endpoints
      // (POST/PATCH/DELETE /api/tasks/:taskId/schedule).
      const updateInput: UpdateTaskInput = {
        title: input.title,
        description: input.description,
        priority: input.priority,
      };
      const result = await updateTask(task.id, updateInput);
      if (result.ok) {
        handleTaskUpdated(result.data);
      } else {
        throw new Error(result.error.message);
      }
    } else {
      // Create new task (with optional schedule attached on creation).
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
    setDetailView('detail');
  };

  const handleDetailTaskUpdated = () => {
    setRefreshTrigger((prev) => prev + 1);
  };

  const handleDetailTaskDeleted = () => {
    setDetailTaskId(null);
    setDetailView('detail');
    setRefreshTrigger((prev) => prev + 1);
  };

  /**
   * Switch the detail overlay from the task view to the executions
   * view. The same `detailTaskId` is reused so we keep the task
   * context. The TaskDetailPanel renders the "View execution history"
   * button that calls this.
   */
  const handleViewExecutions = () => {
    setDetailView('executions');
  };

  /**
   * Return from the executions view back to the task detail panel.
   */
  const handleBackToDetail = () => {
    setDetailView('detail');
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

  // Add Esc key handler for detail panel
  useEscapeKey(handleCloseDetail, () => !!detailTaskId());

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

      {/* Task Detail Panel (view + subtasks) — and the nested
          Executions sub-view for recurring tasks. The same overlay
          is used for both; `detailView` decides which renders. */}
      <Show when={detailTaskId()}>
        <div
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={(e) => {
            if (e.target === e.currentTarget) handleCloseDetail();
          }}
        >
          <Show when={detailView() === 'detail'}>
            <TaskDetailPanel
              taskId={detailTaskId()!}
              agents={agents()}
              onClose={handleCloseDetail}
              onTaskUpdated={handleDetailTaskUpdated}
              onTaskDeleted={handleDetailTaskDeleted}
              onViewExecutions={handleViewExecutions}
            />
          </Show>
          <Show when={detailView() === 'executions'}>
            <div class="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-4xl w-full max-h-[80vh] flex flex-col overflow-hidden">
              <TaskExecutionsPage
                taskId={detailTaskId()!}
                onBack={handleBackToDetail}
                onOpenSession={props.onOpenSession}
              />
            </div>
          </Show>
        </div>
      </Show>
    </Layout>
  );
}
