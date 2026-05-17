import type { AgentRegistry } from '../agents';
import type { SessionMessageService } from '../sessions/service';
import type { SubmitMessageStreamingInput } from '../sessions/types';
import type { PlanningService } from '../planning';
import type { RunEventEmitter } from '../dispatch/events';
import type { SessionType } from '@openaidy/shared-types';
import { createLogger } from '../lib/logger';
import { stripThinking } from '../lib/message.js';
import {
  type TasksRepository,
  type SubtasksRepository,
  type TaskAgentsRepository,
  type Task,
  type Subtask,
  type TaskAgent,
  type TaskStatus,
  type TaskPriority,
  type PlanningStatus,
  type SubtaskStatus,
  type AgentRole,
} from '@openaidy/db';

/**
 * TaskService options
 */
export type TaskServiceOptions = {
  tasksRepo: TasksRepository;
  subtasksRepo: SubtasksRepository;
  taskAgentsRepo: TaskAgentsRepository;
  agents?: AgentRegistry;
  sessionService?: SessionMessageService;
  planningService?: PlanningService;
  runEvents?: RunEventEmitter;
};

/**
 * Input for creating a task
 */
export type CreateTaskInput = {
  title: string;
  description: string;
  priority?: TaskPriority;
  planningEnabled?: boolean;
  agents?: Array<{
    agentId: string;
    role?: AgentRole;
  }>;
};

/**
 * Input for updating a task
 */
export type UpdateTaskInput = {
  title?: string;
  description?: string;
  priority?: TaskPriority;
  planningEnabled?: boolean;
  sessionId?: string | null;
};

/**
 * Input for creating a subtask
 */
export type CreateSubtaskInput = {
  taskId: string;
  parentSubtaskId?: string;
  title: string;
  description: string;
  orderIndex?: number;
  assignedAgentId?: string;
};

/**
 * Task with related entities
 */
export type TaskWithDetails = Task & {
  agents: TaskAgent[];
  subtasks: Subtask[];
  progress: {
    total: number;
    completed: number;
    inProgress: number;
    failed: number;
  };
};

/**
 * Tasks grouped by status for Kanban board
 */
export type KanbanBoard = {
  [K in TaskStatus]: Task[];
};

/**
 * Result type for service operations
 */
export type ServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

/**
 * Task service
 *
 * Orchestrates business logic for task management, integrating with
 * the repository layer and agent registry.
 */
export class TaskService {
  private readonly tasksRepo: TasksRepository;
  private readonly subtasksRepo: SubtasksRepository;
  private readonly taskAgentsRepo: TaskAgentsRepository;
  private readonly agents: AgentRegistry | undefined;
  private readonly sessionService: SessionMessageService | undefined;
  private readonly planningService: PlanningService | undefined;
  private readonly runEvents: RunEventEmitter | undefined;
  private readonly logger = createLogger('TaskService');
  private unsubscribeRunEvents: (() => void) | undefined;
  private readonly pendingVerifications = new Map<
    string,
    { subtaskId: string; result: string }
  >();

  constructor(options: TaskServiceOptions) {
    this.tasksRepo = options.tasksRepo;
    this.subtasksRepo = options.subtasksRepo;
    this.taskAgentsRepo = options.taskAgentsRepo;
    this.agents = options.agents;
    this.sessionService = options.sessionService;
    this.planningService = options.planningService;
    this.runEvents = options.runEvents;

    // Subscribe to run events to auto-complete subtasks
    if (this.runEvents) {
      this.unsubscribeRunEvents = this.runEvents.subscribeAll((event) => {
        void this.handleRunEvent(event);
      });
    }
  }

  /**
   * Cleanup resources when service is destroyed
   */
  destroy(): void {
    if (this.unsubscribeRunEvents) {
      this.unsubscribeRunEvents();
      this.unsubscribeRunEvents = void 0;
    }
  }

  /**
   * Handle run events to auto-complete subtasks when their sessions finish
   */
  private async handleRunEvent(
    event: import('../dispatch/events').RunEvent,
  ): Promise<void> {
    // Only care about completed or failed runs
    if (event.type !== 'run.completed' && event.type !== 'run.failed') {
      return;
    }

    // Intercept verification runs before any subtask-finder logic
    const verification = this.pendingVerifications.get(event.sessionId);
    if (verification) {
      this.pendingVerifications.delete(event.sessionId);
      if (event.type === 'run.completed') {
        await this.handleVerificationResult(
          verification.subtaskId,
          verification.result,
          event.sessionId,
        );
      } else {
        this.logger.warn(
          'Verification run failed, auto-completing subtask as fallback',
          { subtaskId: verification.subtaskId },
        );
        await this.completeSubtask(verification.subtaskId, verification.result);
      }
      return;
    }

    this.logger.info('Handling run event', {
      type: event.type,
      sessionId: event.sessionId,
      runId: event.runId,
    });

    try {
      // Check if this session is a task/subtask execution by checking session type
      // Task/subtask sessions have type 'task' or 'subtask'
      // Regular chat sessions have type 'chat', so we skip subtask lookup
      const sessionRecord = await this.sessionService?.getSession(
        event.sessionId,
      );
      const sessionType =
        sessionRecord && 'type' in sessionRecord
          ? (sessionRecord as { type?: SessionType }).type
          : null;

      const isTaskOrSubtaskSession =
        sessionType === 'task' || sessionType === 'subtask';

      if (!isTaskOrSubtaskSession) {
        // Regular chat session - skip subtask lookup
        this.logger.debug('Skipping subtask lookup for regular chat session', {
          sessionId: event.sessionId,
          sessionType: sessionType ?? 'unknown',
        });
        return;
      }

      // Find subtask linked to this session by checking all tasks
      const tasks = await this.tasksRepo.list();
      let linkedSubtask: Subtask | undefined;
      let checkedSubtasks = 0;

      for (const task of tasks) {
        const subtasks = await this.subtasksRepo.listByTask(task.id);
        const found = subtasks.find((s) => s.sessionId === event.sessionId);
        checkedSubtasks += subtasks.length;
        // Log all subtasks with their sessionIds for debugging
        for (const s of subtasks) {
          if (s.sessionId) {
            this.logger.debug('Checked subtask', {
              subtaskId: s.id,
              taskId: task.id,
              sessionId: s.sessionId,
              status: s.status,
            });
          }
        }
        if (found) {
          linkedSubtask = found;
          break;
        }
      }

      if (!linkedSubtask) {
        this.logger.warn('No subtask found linked to session', {
          sessionId: event.sessionId,
          checkedSubtasks,
          totalTasks: tasks.length,
        });
        return;
      }

      this.logger.info('Found linked subtask', {
        subtaskId: linkedSubtask.id,
        taskId: linkedSubtask.taskId,
        currentStatus: linkedSubtask.status,
      });

      // Skip if subtask already reached a terminal state (e.g. from a previous verification)
      if (
        linkedSubtask.status === 'completed' ||
        linkedSubtask.status === 'failed'
      ) {
        this.logger.debug(
          'Subtask already in terminal state, skipping run event handling',
          { subtaskId: linkedSubtask.id, status: linkedSubtask.status },
        );
        return;
      }

      if (event.type === 'run.completed') {
        // Get the last assistant message to analyze
        const sessionMessages = await this.sessionService?.listMessages(
          event.sessionId,
        );
        const lastAssistantMessage = sessionMessages
          ?.slice()
          .reverse()
          .find((m) => m.role === 'assistant');
        const result = stripThinking(
          lastAssistantMessage?.content ?? 'Completed',
        );

        console.log(
          '[TaskService] Subtask run completed, sending to verification',
          {
            subtaskId: linkedSubtask.id,
            subtaskTitle: linkedSubtask.title,
            lastMessagePreview: result.substring(0, 300),
          },
        );

        // Increment retry count
        const updatedSubtask = await this.subtasksRepo.incrementRetryCount(
          linkedSubtask.id,
        );
        const retryCount = updatedSubtask?.retryCount ?? 0;
        const MAX_RETRIES = 5;

        if (retryCount >= MAX_RETRIES) {
          // Max retries exceeded - mark as failed
          this.logger.warn('Max retries exceeded, marking subtask as failed', {
            subtaskId: linkedSubtask.id,
            retryCount,
            maxRetries: MAX_RETRIES,
          });
          await this.failSubtask(
            linkedSubtask.id,
            `Failed after ${MAX_RETRIES} attempts. Last message: ${result.substring(0, 200)}`,
          );
        } else {
          // No pending intent - ask the default agent to verify completion
          const verified = await this.submitVerificationToTaskSession(
            linkedSubtask,
            result,
          );
          if (!verified) {
            // No task session available - fall back to auto-complete
            this.logger.info(
              'No task session for verification, auto-completing subtask',
              { subtaskId: linkedSubtask.id, sessionId: event.sessionId },
            );
            await this.completeSubtask(linkedSubtask.id, result);
          }
        }
      } else if (event.type === 'run.failed') {
        this.logger.info('Auto-failing subtask after session run failed', {
          subtaskId: linkedSubtask.id,
          sessionId: event.sessionId,
        });
        const errorMessage =
          (event.data.errorMessage as string | undefined) ?? 'Run failed';
        await this.failSubtask(linkedSubtask.id, errorMessage);
      }
    } catch (err) {
      this.logger.error('Failed to handle run event for subtask', {
        error: err instanceof Error ? err.message : String(err),
        sessionId: event.sessionId,
        runId: event.runId,
      });
    }
  }

  // ========================================
  // Task Operations
  // ========================================

  /**
   * Create a task with optional agent assignments
   */
  async createTask(input: CreateTaskInput): Promise<ServiceResult<Task>> {
    // Validate agents exist if provided
    if (input.agents && this.agents) {
      for (const { agentId } of input.agents) {
        if (!this.agents.getAgent(agentId)) {
          return {
            ok: false,
            error: {
              code: 'agent.not_found',
              message: `Agent "${agentId}" not found`,
            },
          };
        }
      }
    }

    const task = await this.tasksRepo.create({
      title: input.title,
      description: input.description,
      ...(input.priority !== undefined && { priority: input.priority }),
      ...(input.planningEnabled !== undefined && {
        planningEnabled: input.planningEnabled,
      }),
    });

    // Assign agents if provided
    if (input.agents && input.agents.length > 0) {
      const agentsWithRoles = input.agents.map((a) => ({
        agentId: a.agentId,
        ...(a.role !== undefined && { role: a.role }),
      }));
      await this.taskAgentsRepo.assignMultiple(task.id, agentsWithRoles);
    }

    // Trigger planning if enabled (async - don't await)
    if (task.planningEnabled && this.planningService) {
      this.planningService
        .planTask(task.id)
        .then((result) => {
          if (!result.ok) {
            this.logger.warn('Task planning failed', {
              taskId: task.id,
              error: result.error,
            });
          } else {
            this.logger.info('Task planning completed', {
              taskId: task.id,
              subtasksCreated: result.subtasks.length,
            });
          }
        })
        .catch((err) => {
          this.logger.error('Unexpected error during task planning', {
            taskId: task.id,
            error: err instanceof Error ? err.message : String(err),
          });
        });
    }

    return { ok: true, data: task };
  }

  /**
   * Get a task by ID
   */
  async getTask(id: string): Promise<Task | null> {
    return this.tasksRepo.findById(id);
  }

  /**
   * Get a task with agents, subtasks, and progress info
   */
  async getTaskWithDetails(id: string): Promise<TaskWithDetails | null> {
    const task = await this.tasksRepo.findById(id);
    if (!task) {
      return null;
    }

    const [agents, subtasks, statusCounts] = await Promise.all([
      this.taskAgentsRepo.listByTask(id),
      this.subtasksRepo.listByTask(id),
      this.subtasksRepo.getCountsByStatus(id),
    ]);

    return {
      ...task,
      agents,
      subtasks,
      progress: {
        total: Object.values(statusCounts).reduce((a, b) => a + b, 0),
        completed: statusCounts.completed,
        inProgress: statusCounts.in_progress,
        failed: statusCounts.failed,
      },
    };
  }

  /**
   * List all tasks, optionally filtered by status
   */
  async listTasks(status?: TaskStatus): Promise<Task[]> {
    return this.tasksRepo.list(status);
  }

  /**
   * List tasks grouped by status for Kanban board
   */
  async listTasksForKanban(): Promise<KanbanBoard> {
    const tasks = await this.tasksRepo.list();

    const board: KanbanBoard = {
      backlog: [],
      todo: [],
      in_progress: [],
      review: [],
      done: [],
      cancelled: [],
    };

    for (const task of tasks) {
      board[task.status].push(task);
    }

    return board;
  }

  /**
   * Update a task
   */
  async updateTask(
    id: string,
    input: UpdateTaskInput,
  ): Promise<ServiceResult<Task>> {
    const existingTask = await this.tasksRepo.findById(id);
    if (!existingTask) {
      return {
        ok: false,
        error: {
          code: 'task.not_found',
          message: `Task "${id}" not found`,
        },
      };
    }

    const updated = await this.tasksRepo.update(id, input);
    return { ok: true, data: updated! };
  }

  /**
   * Update a task's status
   */
  async updateTaskStatus(
    id: string,
    status: TaskStatus,
  ): Promise<ServiceResult<Task>> {
    const existingTask = await this.tasksRepo.findById(id);
    if (!existingTask) {
      return {
        ok: false,
        error: {
          code: 'task.not_found',
          message: `Task "${id}" not found`,
        },
      };
    }

    const updated = await this.tasksRepo.updateStatus(id, status);
    return { ok: true, data: updated! };
  }

  /**
   * Delete a task (cascades to subtasks and agent assignments)
   */
  async deleteTask(id: string): Promise<ServiceResult<true>> {
    const existingTask = await this.tasksRepo.findById(id);
    if (!existingTask) {
      return {
        ok: false,
        error: {
          code: 'task.not_found',
          message: `Task "${id}" not found`,
        },
      };
    }

    await this.tasksRepo.delete(id);
    return { ok: true, data: true };
  }

  // ========================================
  // Agent Assignment
  // ========================================

  /**
   * Assign agents to a task
   */
  async assignAgents(
    taskId: string,
    agents: Array<{ agentId: string; role?: AgentRole }>,
  ): Promise<ServiceResult<TaskAgent[]>> {
    const existingTask = await this.tasksRepo.findById(taskId);
    if (!existingTask) {
      return {
        ok: false,
        error: {
          code: 'task.not_found',
          message: `Task "${taskId}" not found`,
        },
      };
    }

    // Validate agents exist
    if (this.agents) {
      for (const { agentId } of agents) {
        if (!this.agents.getAgent(agentId)) {
          return {
            ok: false,
            error: {
              code: 'agent.not_found',
              message: `Agent "${agentId}" not found`,
            },
          };
        }
      }
    }

    const assignments = await this.taskAgentsRepo.assignMultiple(
      taskId,
      agents,
    );
    return { ok: true, data: assignments };
  }

  /**
   * Remove an agent from a task
   */
  async removeAgent(
    taskId: string,
    agentId: string,
  ): Promise<ServiceResult<true>> {
    await this.taskAgentsRepo.remove(taskId, agentId);
    return { ok: true, data: true };
  }

  /**
   * Get agents assigned to a task
   */
  async getTaskAgents(taskId: string): Promise<TaskAgent[]> {
    return this.taskAgentsRepo.listByTask(taskId);
  }

  // ========================================
  // Subtask Operations
  // ========================================

  /**
   * Create a subtask
   */
  async createSubtask(
    input: CreateSubtaskInput,
  ): Promise<ServiceResult<Subtask>> {
    const existingTask = await this.tasksRepo.findById(input.taskId);
    if (!existingTask) {
      return {
        ok: false,
        error: {
          code: 'task.not_found',
          message: `Task "${input.taskId}" not found`,
        },
      };
    }

    // Validate agent exists if provided
    if (input.assignedAgentId && this.agents) {
      if (!this.agents.getAgent(input.assignedAgentId)) {
        return {
          ok: false,
          error: {
            code: 'agent.not_found',
            message: `Agent "${input.assignedAgentId}" not found`,
          },
        };
      }
    }

    const subtask = await this.subtasksRepo.create(input);
    return { ok: true, data: subtask };
  }

  /**
   * Get all subtasks for a task
   */
  async getSubtasks(taskId: string): Promise<Subtask[]> {
    return this.subtasksRepo.listByTask(taskId);
  }

  /**
   * Update a subtask
   */
  async updateSubtask(
    id: string,
    input: { title?: string; description?: string; orderIndex?: number },
  ): Promise<ServiceResult<Subtask>> {
    const existing = await this.subtasksRepo.findById(id);
    if (!existing) {
      return {
        ok: false,
        error: {
          code: 'subtask.not_found',
          message: `Subtask "${id}" not found`,
        },
      };
    }

    const updated = await this.subtasksRepo.update(id, input);
    return { ok: true, data: updated! };
  }

  /**
   * Delete a subtask
   */
  async deleteSubtask(id: string): Promise<ServiceResult<true>> {
    const existing = await this.subtasksRepo.findById(id);
    if (!existing) {
      return {
        ok: false,
        error: {
          code: 'subtask.not_found',
          message: `Subtask "${id}" not found`,
        },
      };
    }

    await this.subtasksRepo.delete(id);
    return { ok: true, data: true };
  }

  /**
   * Update a subtask's status
   */
  async updateSubtaskStatus(
    id: string,
    status: SubtaskStatus,
  ): Promise<ServiceResult<Subtask>> {
    const updated = await this.subtasksRepo.updateStatus(id, status);
    if (!updated) {
      return {
        ok: false,
        error: {
          code: 'subtask.not_found',
          message: `Subtask "${id}" not found`,
        },
      };
    }
    return { ok: true, data: updated };
  }

  /**
   * Assign an agent to a subtask
   */
  async assignSubtaskAgent(
    id: string,
    agentId: string,
  ): Promise<ServiceResult<Subtask>> {
    // Validate agent exists
    if (this.agents && !this.agents.getAgent(agentId)) {
      return {
        ok: false,
        error: {
          code: 'agent.not_found',
          message: `Agent "${agentId}" not found`,
        },
      };
    }

    const updated = await this.subtasksRepo.assignAgent(id, agentId);
    if (!updated) {
      return {
        ok: false,
        error: {
          code: 'subtask.not_found',
          message: `Subtask "${id}" not found`,
        },
      };
    }
    return { ok: true, data: updated };
  }

  /**
   * Set a subtask's result
   */
  async setSubtaskResult(
    id: string,
    result: string,
  ): Promise<ServiceResult<Subtask>> {
    const updated = await this.subtasksRepo.setResult(id, result);
    if (!updated) {
      return {
        ok: false,
        error: {
          code: 'subtask.not_found',
          message: `Subtask "${id}" not found`,
        },
      };
    }
    return { ok: true, data: updated };
  }

  /**
   * Get progress info for a task
   */
  async getTaskProgress(taskId: string): Promise<{
    total: number;
    completed: number;
    inProgress: number;
    failed: number;
    pending: number;
  }> {
    const counts = await this.subtasksRepo.getCountsByStatus(taskId);
    return {
      total: Object.values(counts).reduce((a, b) => a + b, 0),
      completed: counts.completed,
      inProgress: counts.in_progress,
      failed: counts.failed,
      pending: counts.pending + counts.assigned,
    };
  }

  // ========================================
  // Planning Operations
  // ========================================

  /**
   * Update a task's planning status
   */
  async updatePlanningStatus(
    taskId: string,
    status: PlanningStatus,
  ): Promise<ServiceResult<Task>> {
    const existingTask = await this.tasksRepo.findById(taskId);
    if (!existingTask) {
      return {
        ok: false,
        error: {
          code: 'task.not_found',
          message: `Task "${taskId}" not found`,
        },
      };
    }

    const updated = await this.tasksRepo.updatePlanningStatus(taskId, status);
    return { ok: true, data: updated! };
  }

  /**
   * Create multiple subtasks (for planning agent)
   */
  async createSubtasks(
    taskId: string,
    subtasks: Array<{
      title: string;
      description: string;
      assignedAgentId?: string;
    }>,
  ): Promise<ServiceResult<Subtask[]>> {
    const existingTask = await this.tasksRepo.findById(taskId);
    if (!existingTask) {
      return {
        ok: false,
        error: {
          code: 'task.not_found',
          message: `Task "${taskId}" not found`,
        },
      };
    }

    const created: Subtask[] = [];
    for (const [i, subtaskInput] of subtasks.entries()) {
      const createInput: {
        taskId: string;
        title: string;
        description: string;
        orderIndex: number;
        assignedAgentId?: string;
      } = {
        taskId,
        title: subtaskInput.title,
        description: subtaskInput.description,
        orderIndex: i,
      };
      if (subtaskInput.assignedAgentId !== undefined) {
        createInput.assignedAgentId = subtaskInput.assignedAgentId;
      }
      const createdSubtask = await this.subtasksRepo.create(createInput);
      created.push(createdSubtask);
    }

    return { ok: true, data: created };
  }

  // ========================================
  // Session Integration
  // ========================================

  /**
   * Execute a task by creating a session
   */
  async executeTask(
    taskId: string,
  ): Promise<ServiceResult<{ sessionId: string }>> {
    if (!this.sessionService) {
      this.logger.warn(
        'Task execution failed: session service is not configured',
        {
          taskId,
        },
      );
      return {
        ok: false,
        error: {
          code: 'session.not_configured',
          message: 'Session service is not configured',
        },
      };
    }

    const task = await this.tasksRepo.findById(taskId);
    if (!task) {
      this.logger.warn('Task execution failed: task not found', { taskId });
      return {
        ok: false,
        error: {
          code: 'task.not_found',
          message: `Task "${taskId}" not found`,
        },
      };
    }

    // Create session for task execution
    const session = await this.sessionService.createSession(
      `Task: ${task.title}`,
      'task',
    );

    // Link session to task
    await this.tasksRepo.update(taskId, { sessionId: session.id });

    // Update status to in_progress
    await this.tasksRepo.updateStatus(taskId, 'in_progress');
    this.logger.info('Task moved to in_progress', {
      taskId,
      status: 'in_progress',
    });

    // Check if task has subtasks
    const subtasks = await this.subtasksRepo.listByTask(taskId);

    if (subtasks.length > 0) {
      // Task has subtasks - execute them instead of the task directly
      this.logger.info('Task has subtasks, executing subtasks', {
        taskId,
        subtaskCount: subtasks.length,
      });
      const subtaskResult = await this.executeSubtasks(taskId);
      if (!subtaskResult.ok) {
        return { ok: false, error: subtaskResult.error };
      }
      return { ok: true, data: { sessionId: session.id } };
    }

    // No subtasks - execute task directly
    const executionResult = await this.sessionService.submitMessageStreaming({
      sessionId: session.id,
      content: task.description,
      role: 'user',
      onStreamEvent: () => {},
    });

    if (!executionResult.ok) {
      this.logger.warn(
        'Task execution failed while submitting initial message',
        {
          taskId,
          sessionId: session.id,
          errorCode: executionResult.error.code,
        },
      );
      return { ok: false, error: executionResult.error };
    }

    // No subtasks - move directly to review
    await this.tasksRepo.updateStatus(taskId, 'review');
    this.logger.info('Task moved to review', {
      taskId,
      status: 'review',
      reason: 'no_subtasks',
    });

    return { ok: true, data: { sessionId: session.id } };
  }

  /**
   * Execute a subtask by creating a session
   */
  async executeSubtask(
    subtaskId: string,
  ): Promise<ServiceResult<{ sessionId: string }>> {
    if (!this.sessionService) {
      return {
        ok: false,
        error: {
          code: 'session.not_configured',
          message: 'Session service is not configured',
        },
      };
    }

    const subtask = await this.subtasksRepo.findById(subtaskId);
    if (!subtask) {
      return {
        ok: false,
        error: {
          code: 'subtask.not_found',
          message: `Subtask "${subtaskId}" not found`,
        },
      };
    }

    // Guard: don't execute if already in progress or completed
    if (subtask.status === 'in_progress' || subtask.status === 'completed') {
      this.logger.info('Subtask already executed, skipping', {
        subtaskId,
        status: subtask.status,
      });
      return {
        ok: false,
        error: {
          code: 'subtask.already_executed',
          message: `Subtask "${subtaskId}" is already ${subtask.status}`,
        },
      };
    }

    // Check dependencies
    if (subtask.parentSubtaskId) {
      const parent = await this.subtasksRepo.findById(subtask.parentSubtaskId);
      if (parent?.status !== 'completed') {
        return {
          ok: false,
          error: {
            code: 'subtask.dependency_not_met',
            message: 'Parent subtask not completed',
          },
        };
      }
    }

    // Create session for subtask execution
    const session = await this.sessionService.createSession(
      `Subtask: ${subtask.title}`,
      'subtask',
    );
    this.logger.info('Created session for subtask', {
      subtaskId,
      sessionId: session.id,
    });

    // Link session to subtask
    await this.subtasksRepo.update(subtaskId, { sessionId: session.id });
    this.logger.info('Linked session to subtask', {
      subtaskId,
      sessionId: session.id,
    });

    // Update status to in_progress
    await this.subtasksRepo.updateStatus(subtaskId, 'in_progress');

    // Build message with context from completed dependencies
    const allSubtasks = await this.subtasksRepo.listByTask(subtask.taskId);
    const completedDeps = allSubtasks.filter(
      (s) => s.status === 'completed' && s.result,
    );

    let messageContent = subtask.description;
    if (completedDeps.length > 0) {
      const contextParts = completedDeps.map(
        (dep) => `## Result from "${dep.title}":\n${dep.result}`,
      );
      messageContent = `${subtask.description}\n\n---\n\n**Context from completed work:**\n\n${contextParts.join('\n\n')}`;
      this.logger.info('Including context from completed dependencies', {
        subtaskId,
        depCount: completedDeps.length,
        deps: completedDeps.map((d) => d.title),
      });
    }

    // Submit initial message with subtask description
    // Use the subtask's assigned agent if available
    const agentId = (subtask as { assignedAgentId?: string }).assignedAgentId;
    this.logger.info('Submitting message to session', {
      subtaskId,
      sessionId: session.id,
      agentId,
      hasContext: completedDeps.length > 0,
    });

    const messageInput: SubmitMessageStreamingInput = {
      sessionId: session.id,
      content: messageContent,
      role: 'user',
      onStreamEvent: () => {},
    };
    if (agentId !== undefined) {
      messageInput.agentId = agentId;
    }
    await this.sessionService.submitMessageStreaming(messageInput);

    return { ok: true, data: { sessionId: session.id } };
  }

  /**
   * Trigger a retry for a stuck subtask by sending a prompt to continue
   * This is used when auto-detection finds a subtask that needs to continue
   */
  async triggerSubtaskRetry(
    subtaskId: string,
  ): Promise<ServiceResult<{ sessionId: string }>> {
    if (!this.sessionService) {
      return {
        ok: false,
        error: {
          code: 'service.not_configured',
          message: 'Session service is not configured',
        },
      };
    }

    const subtask = await this.subtasksRepo.findById(subtaskId);
    if (!subtask) {
      return {
        ok: false,
        error: {
          code: 'subtask.not_found',
          message: `Subtask "${subtaskId}" not found`,
        },
      };
    }

    // Must have a linked session to retry
    const sessionId = subtask.sessionId;
    if (!sessionId) {
      return {
        ok: false,
        error: {
          code: 'subtask.no_session',
          message: `Subtask "${subtaskId}" has no linked session`,
        },
      };
    }

    // Send a prompt to continue/complete the subtask
    const agentId = (subtask as { assignedAgentId?: string }).assignedAgentId;
    this.logger.info('Triggering retry for stuck subtask', {
      subtaskId,
      sessionId,
      agentId,
    });

    const messageInput: SubmitMessageStreamingInput = {
      sessionId,
      content:
        'Please continue and complete this subtask. Focus on delivering the actual output requested. Do not ask what to do — execute the task directly.',
      role: 'user',
      onStreamEvent: () => {},
    };
    if (agentId !== undefined) {
      messageInput.agentId = agentId;
    }

    await this.sessionService.submitMessageStreaming(messageInput);

    return { ok: true, data: { sessionId } };
  }

  /**
   * Get the session linked to a task
   */
  async getTaskSession(
    taskId: string,
  ): Promise<ServiceResult<{ sessionId: string | null }>> {
    const task = await this.tasksRepo.findById(taskId);
    if (!task) {
      return {
        ok: false,
        error: {
          code: 'task.not_found',
          message: `Task "${taskId}" not found`,
        },
      };
    }

    return { ok: true, data: { sessionId: task.sessionId } };
  }

  /**
   * Get the session linked to a subtask
   */
  async getSubtaskSession(
    subtaskId: string,
  ): Promise<ServiceResult<{ sessionId: string | null }>> {
    const subtask = await this.subtasksRepo.findById(subtaskId);
    if (!subtask) {
      return {
        ok: false,
        error: {
          code: 'subtask.not_found',
          message: `Subtask "${subtaskId}" not found`,
        },
      };
    }

    return { ok: true, data: { sessionId: subtask.sessionId } };
  }

  /**
   * Find a subtask by its linked session ID
   */
  async getSubtaskBySessionId(
    sessionId: string,
  ): Promise<ServiceResult<Subtask>> {
    // Search through all tasks to find subtask linked to this session
    const tasks = await this.tasksRepo.list();

    for (const task of tasks) {
      const subtasks = await this.subtasksRepo.listByTask(task.id);
      const found = subtasks.find((s) => s.sessionId === sessionId);
      if (found) {
        return { ok: true, data: found };
      }
    }

    return {
      ok: false,
      error: {
        code: 'subtask.not_found',
        message: `No subtask found linked to session "${sessionId}"`,
      },
    };
  }

  // ========================================
  // Subtask Execution
  // ========================================

  /**
   * Execute all pending subtasks for a task
   */
  async executeSubtasks(
    taskId: string,
  ): Promise<ServiceResult<{ startedCount: number }>> {
    const task = await this.tasksRepo.findById(taskId);
    if (!task) {
      return {
        ok: false,
        error: {
          code: 'task.not_found',
          message: `Task "${taskId}" not found`,
        },
      };
    }

    const subtasks = await this.subtasksRepo.listByTask(taskId);
    const pending = subtasks.filter((s) => s.status === 'pending');

    // Find subtasks with no pending dependencies
    const executable = pending.filter((subtask) => {
      if (!subtask.parentSubtaskId) return true;
      const parent = subtasks.find((s) => s.id === subtask.parentSubtaskId);
      return parent?.status === 'completed';
    });

    // Start execution for each executable subtask
    let startedCount = 0;
    for (const subtask of executable) {
      const result = await this.executeSubtask(subtask.id);
      if (result.ok) {
        startedCount++;
      }
    }

    return { ok: true, data: { startedCount } };
  }

  /**
   * Complete a subtask with result
   */
  async completeSubtask(
    subtaskId: string,
    result: string,
  ): Promise<ServiceResult<Subtask>> {
    const subtask = await this.subtasksRepo.findById(subtaskId);
    if (!subtask) {
      return {
        ok: false,
        error: {
          code: 'subtask.not_found',
          message: `Subtask "${subtaskId}" not found`,
        },
      };
    }

    const updated = await this.subtasksRepo.update(subtaskId, {
      status: 'completed',
      result,
    });

    this.logger.info('Subtask completed, checking for dependent subtasks', {
      subtaskId,
      taskId: subtask.taskId,
    });

    // Check if parent task should be updated
    await this.checkTaskCompletion(subtask.taskId);

    // Try to execute any pending subtasks that may now have their dependencies met
    const executeResult = await this.executeSubtasks(subtask.taskId);
    if (executeResult.ok && executeResult.data.startedCount > 0) {
      this.logger.info('Started dependent subtasks after completion', {
        subtaskId,
        taskId: subtask.taskId,
        startedCount: executeResult.data.startedCount,
      });
    }

    return { ok: true, data: updated! };
  }

  /**
   * Fail a subtask with error
   */
  async failSubtask(
    subtaskId: string,
    error: string,
  ): Promise<ServiceResult<Subtask>> {
    const subtask = await this.subtasksRepo.findById(subtaskId);
    if (!subtask) {
      return {
        ok: false,
        error: {
          code: 'subtask.not_found',
          message: `Subtask "${subtaskId}" not found`,
        },
      };
    }

    const updated = await this.subtasksRepo.update(subtaskId, {
      status: 'failed',
      result: error,
    });

    return { ok: true, data: updated! };
  }

  /**
   * Get next executable subtasks
   */
  async getNextExecutableSubtasks(taskId: string): Promise<Subtask[]> {
    const subtasks = await this.subtasksRepo.listByTask(taskId);

    return subtasks.filter((subtask) => {
      if (subtask.status !== 'pending') return false;
      if (!subtask.parentSubtaskId) return true;

      const parent = subtasks.find((s) => s.id === subtask.parentSubtaskId);
      return parent?.status === 'completed';
    });
  }

  /**
   * Check if all subtasks are complete and update task
   */
  private async checkTaskCompletion(taskId: string): Promise<void> {
    const subtasks = await this.subtasksRepo.listByTask(taskId);
    const allComplete =
      subtasks.length > 0 && subtasks.every((s) => s.status === 'completed');

    if (allComplete) {
      await this.tasksRepo.updateStatus(taskId, 'review');
      this.logger.info('Task moved to review', {
        taskId,
        status: 'review',
        reason: 'all_subtasks_completed',
      });
    }
  }

  /**
   * Submit a verification request to the task session's default agent to
   * determine if the subtask was genuinely completed.
   * Returns true if verification was submitted, false if no task session exists.
   */
  private async submitVerificationToTaskSession(
    subtask: Subtask,
    subtaskResult: string,
  ): Promise<boolean> {
    if (!this.sessionService) return false;

    const task = await this.tasksRepo.findById(subtask.taskId);
    if (!task?.sessionId) {
      this.logger.warn('No task session found for subtask verification', {
        subtaskId: subtask.id,
        taskId: subtask.taskId,
      });
      return false;
    }

    const taskAgents = await this.taskAgentsRepo.listByTask(subtask.taskId);
    const agentId = taskAgents[0]?.agentId;

    const verificationPrompt = [
      `Evaluate whether this subtask was successfully completed.`,
      ``,
      `**Subtask**: ${subtask.title}`,
      `**Objective**: ${subtask.description}`,
      ``,
      `**Agent's last response**:`,
      subtaskResult,
      ``,
      `Did the agent successfully complete the subtask objective? Reply with exactly COMPLETED if the work is done, or INCOMPLETE if the agent failed to finish, encountered an unresolved error, or the response does not show that actual work was performed.`,
    ].join('\n');

    console.log('[TaskService] Verification prompt', verificationPrompt);

    const messageInput: SubmitMessageStreamingInput = {
      sessionId: task.sessionId,
      content: verificationPrompt,
      role: 'user',
      onStreamEvent: () => {},
    };
    if (agentId) {
      messageInput.agentId = agentId;
    }

    this.pendingVerifications.set(task.sessionId, {
      subtaskId: subtask.id,
      result: subtaskResult,
    });

    this.logger.info('Submitting subtask verification to task session', {
      subtaskId: subtask.id,
      taskId: subtask.taskId,
      taskSessionId: task.sessionId,
    });

    await this.sessionService.submitMessageStreaming(messageInput);
    return true;
  }

  /**
   * Handle the result of a verification run from the task session.
   * Completes the subtask if the agent confirms it is done, otherwise retries.
   */
  private async handleVerificationResult(
    subtaskId: string,
    originalResult: string,
    verificationSessionId: string,
  ): Promise<void> {
    const messages = await this.sessionService?.listMessages(
      verificationSessionId,
    );
    const lastMsg = messages
      ?.slice()
      .reverse()
      .find((m) => (m as { role: string }).role === 'assistant');
    const rawContent = (lastMsg as { content?: string })?.content ?? '';
    const content = stripThinking(rawContent);

    const regex = /\bCOMPLETED\b/i;

    const isComplete = regex.test(content);

    if (isComplete) {
      const index = content.search(regex);

      const context = content.slice(
        Math.max(0, index - 40),
        Math.min(content.length, index + 40),
      );
      console.log('=== VERIFICATION RESULT ===');
      console.log('Found at:', index);
      console.log('Context:', context);
      console.log('=== END VERIFICATION RESULT ===');
    }

    console.log('[TaskService] Verification result received', {
      subtaskId,
      isComplete,
      verdict: content.substring(0, 300),
    });

    this.logger.info('Subtask verification result received', {
      subtaskId,
      isComplete,
      verificationSummary: content,
    });

    if (isComplete) {
      await this.completeSubtask(subtaskId, originalResult);
    } else {
      this.logger.info('Verification says incomplete, triggering retry', {
        subtaskId,
      });
      await this.triggerSubtaskRetry(subtaskId);
    }
  }

  /**
   * Check for stuck subtasks (in_progress for too long) and auto-retry them
   * Should be called periodically by a background job
   */
  async checkStuckSubtasks(): Promise<void> {
    const STUCK_TIMEOUT_MINUTES = 3;
    const MAX_RETRIES = 5;

    // Find all in_progress subtasks
    const allSubtasks = await this.subtasksRepo.listAll();
    const inProgressSubtasks = allSubtasks.filter(
      (s) => s.status === 'in_progress',
    );

    if (inProgressSubtasks.length === 0) {
      return;
    }

    this.logger.info('Checking for stuck subtasks', {
      count: inProgressSubtasks.length,
    });

    const now = new Date();

    for (const subtask of inProgressSubtasks) {
      // Check if subtask has been in_progress for too long
      const updatedAt = subtask.updatedAt ? new Date(subtask.updatedAt) : null;
      if (!updatedAt) {
        continue;
      }

      const minutesSinceUpdate =
        (now.getTime() - updatedAt.getTime()) / (1000 * 60);

      if (minutesSinceUpdate < STUCK_TIMEOUT_MINUTES) {
        continue; // Not stuck yet
      }

      // Check retry count
      const retryCount = (subtask as { retryCount?: number }).retryCount ?? 0;

      if (retryCount >= MAX_RETRIES) {
        this.logger.warn('Subtask exceeded max retries, marking as failed', {
          subtaskId: subtask.id,
          retryCount,
        });
        await this.subtasksRepo.updateStatus(subtask.id, 'failed');
        continue;
      }

      // Auto-retry: increment retry count and trigger retry
      this.logger.info('Auto-retrying stuck subtask', {
        subtaskId: subtask.id,
        retryCount,
        minutesStuck: Math.round(minutesSinceUpdate),
      });

      await this.subtasksRepo.incrementRetryCount(subtask.id);

      // Trigger retry via existing session
      const result = await this.triggerSubtaskRetry(subtask.id);

      if (!result.ok) {
        this.logger.error('Auto-retry failed for stuck subtask', {
          subtaskId: subtask.id,
          error: result.error,
        });
      }
    }
  }
}

/**
 * Create a task service instance
 */
export function createTaskService(options: TaskServiceOptions): TaskService {
  return new TaskService(options);
}
