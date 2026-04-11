import type { AgentRegistry } from '../agents';
import type { SessionMessageService } from '../sessions/service';
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

  constructor(options: TaskServiceOptions) {
    this.tasksRepo = options.tasksRepo;
    this.subtasksRepo = options.subtasksRepo;
    this.taskAgentsRepo = options.taskAgentsRepo;
    this.agents = options.agents;
    this.sessionService = options.sessionService;
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
    );

    // Link session to task
    await this.tasksRepo.update(taskId, { sessionId: session.id });

    // Submit initial message with task description
    await this.sessionService.submitMessage({
      sessionId: session.id,
      content: task.description,
      role: 'user',
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
    );

    // Link session to subtask
    await this.subtasksRepo.update(subtaskId, { sessionId: session.id });

    // Update status to in_progress
    await this.subtasksRepo.updateStatus(subtaskId, 'in_progress');

    // Submit initial message with subtask description
    await this.sessionService.submitMessage({
      sessionId: session.id,
      content: subtask.description,
      role: 'user',
    });

    return { ok: true, data: { sessionId: session.id } };
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

    // Check if parent task should be updated
    await this.checkTaskCompletion(subtask.taskId);

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
      await this.tasksRepo.updateStatus(taskId, 'done');
    }
  }
}

/**
 * Create a task service instance
 */
export function createTaskService(options: TaskServiceOptions): TaskService {
  return new TaskService(options);
}
