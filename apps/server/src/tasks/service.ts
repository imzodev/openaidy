import type {
  Task,
  Subtask,
  TaskAgent,
  TaskStatus,
  PlanningStatus,
  SubtaskStatus,
  AgentRole,
} from '@openaidy/db';
import { createLogger } from '../lib/logger';
import type { TaskScheduleService } from './schedule-service';
import { TaskOperations } from './operations/task-operations';
import { SubtaskOperations } from './operations/subtask-operations';
import { TaskExecution } from './execution/task-execution';
import type {
  TaskServiceOptions,
  CreateTaskInput,
  UpdateTaskInput,
  CreateSubtaskInput,
  TaskWithDetails,
  KanbanBoard,
  ServiceResult,
} from '../types';

export type {
  TaskServiceOptions,
  CreateTaskInput,
  UpdateTaskInput,
  CreateSubtaskInput,
  TaskWithDetails,
  KanbanBoard,
  ServiceResult,
};

/**
 * TaskService — thin facade that delegates to focused modules:
 *  - TaskOperations: task & agent CRUD, planning
 *  - SubtaskOperations: subtask CRUD & queries
 *  - TaskExecution: execution lifecycle, verification, retry
 */
export class TaskService {
  private readonly ops: TaskOperations;
  private readonly subtaskOps: SubtaskOperations;
  private readonly execution: TaskExecution;

  constructor(
    options: TaskServiceOptions,
    taskSchedulesService?: TaskScheduleService,
  ) {
    const logger = createLogger('TaskService');
    this.ops = new TaskOperations(
      options.tasksRepo,
      options.subtasksRepo,
      options.taskAgentsRepo,
      options.agents,
      options.planningService,
      taskSchedulesService,
      logger,
    );
    this.subtaskOps = new SubtaskOperations(
      options.tasksRepo,
      options.subtasksRepo,
      options.agents,
      logger,
    );
    this.execution = new TaskExecution(
      options.tasksRepo,
      options.subtasksRepo,
      options.taskAgentsRepo,
      options.deliverablesRepo,
      options.agents,
      options.sessionService,
      options.runEvents,
      options.workspaceBaseDir,
      options.taskExecutionHistoryRepo,
    );
  }

  destroy(): void {
    this.execution.destroy();
  }

  /**
   * Inject the TaskScheduleService after construction.
   * Used when taskService is created before the recurring tasks block
   * (which creates the TaskScheduleService) in app.ts.
   */
  setTaskSchedulesService(service: TaskScheduleService | undefined): void {
    this.ops.setTaskSchedulesService(service);
  }

  // ========================================
  // Task Operations
  // ========================================

  async createTask(input: CreateTaskInput): Promise<ServiceResult<Task>> {
    return this.ops.createTask(input);
  }

  async getTask(id: string): Promise<Task | null> {
    return this.ops.getTask(id);
  }

  async getTaskWithDetails(id: string): Promise<TaskWithDetails | null> {
    return this.ops.getTaskWithDetails(id);
  }

  async listTasks(status?: TaskStatus): Promise<Task[]> {
    return this.ops.listTasks(status);
  }

  async listTasksForKanban(): Promise<KanbanBoard> {
    return this.ops.listTasksForKanban();
  }

  async updateTask(
    id: string,
    input: UpdateTaskInput,
  ): Promise<ServiceResult<Task>> {
    return this.ops.updateTask(id, input);
  }

  async updateTaskStatus(
    id: string,
    status: TaskStatus,
  ): Promise<ServiceResult<Task>> {
    return this.ops.updateTaskStatus(id, status);
  }

  async deleteTask(id: string): Promise<ServiceResult<true>> {
    return this.ops.deleteTask(id);
  }

  async updatePlanningStatus(
    taskId: string,
    status: PlanningStatus,
  ): Promise<ServiceResult<Task>> {
    return this.ops.updatePlanningStatus(taskId, status);
  }

  async createSubtasks(
    taskId: string,
    subtasks: Array<{
      title: string;
      description: string;
      assignedAgentId?: string;
    }>,
  ): Promise<ServiceResult<Subtask[]>> {
    return this.ops.createSubtasks(taskId, subtasks);
  }

  // ========================================
  // Agent Assignment
  // ========================================

  async assignAgents(
    taskId: string,
    agents: Array<{ agentId: string; role?: AgentRole }>,
  ): Promise<ServiceResult<TaskAgent[]>> {
    return this.ops.assignAgents(taskId, agents);
  }

  async removeAgent(
    taskId: string,
    agentId: string,
  ): Promise<ServiceResult<true>> {
    return this.ops.removeAgent(taskId, agentId);
  }

  async getTaskAgents(taskId: string): Promise<TaskAgent[]> {
    return this.ops.getTaskAgents(taskId);
  }

  // ========================================
  // Subtask Operations
  // ========================================

  async createSubtask(
    input: CreateSubtaskInput,
  ): Promise<ServiceResult<Subtask>> {
    return this.subtaskOps.createSubtask(input);
  }

  async getSubtasks(
    taskId: string,
  ): Promise<(Subtask & { dependsOnSubtaskIds: string[] })[]> {
    return this.subtaskOps.getSubtasks(taskId);
  }

  async updateSubtask(
    id: string,
    input: { title?: string; description?: string; orderIndex?: number },
  ): Promise<ServiceResult<Subtask>> {
    return this.subtaskOps.updateSubtask(id, input);
  }

  async deleteSubtask(id: string): Promise<ServiceResult<true>> {
    return this.subtaskOps.deleteSubtask(id);
  }

  async updateSubtaskStatus(
    id: string,
    status: SubtaskStatus,
  ): Promise<ServiceResult<Subtask>> {
    return this.subtaskOps.updateSubtaskStatus(id, status);
  }

  async assignSubtaskAgent(
    id: string,
    agentId: string,
  ): Promise<ServiceResult<Subtask>> {
    return this.subtaskOps.assignSubtaskAgent(id, agentId);
  }

  async setSubtaskResult(
    id: string,
    result: string,
  ): Promise<ServiceResult<Subtask>> {
    return this.subtaskOps.setSubtaskResult(id, result);
  }

  async getTaskProgress(taskId: string): Promise<{
    total: number;
    completed: number;
    inProgress: number;
    failed: number;
    pending: number;
  }> {
    return this.subtaskOps.getTaskProgress(taskId);
  }

  async getNextExecutableSubtasks(taskId: string): Promise<Subtask[]> {
    return this.subtaskOps.getNextExecutableSubtasks(taskId);
  }

  async getSubtaskBySessionId(
    sessionId: string,
  ): Promise<ServiceResult<Subtask>> {
    return this.subtaskOps.getSubtaskBySessionId(sessionId);
  }

  async getTaskSession(
    taskId: string,
  ): Promise<ServiceResult<{ sessionId: string | null }>> {
    return this.subtaskOps.getTaskSession(taskId);
  }

  async getSubtaskSession(
    subtaskId: string,
  ): Promise<ServiceResult<{ sessionId: string | null }>> {
    return this.subtaskOps.getSubtaskSession(subtaskId);
  }

  // ========================================
  // Execution
  // ========================================

  async executeTask(
    taskId: string,
    options: { sessionId?: string } = {},
  ): Promise<ServiceResult<{ sessionId: string }>> {
    return this.execution.executeTask(taskId, options);
  }

  async executeSubtask(
    subtaskId: string,
    options: { sessionId?: string } = {},
  ): Promise<ServiceResult<{ sessionId: string }>> {
    return this.execution.executeSubtask(subtaskId, options);
  }

  async executeSubtasks(
    taskId: string,
    options: { sessionId?: string } = {},
  ): Promise<ServiceResult<{ startedCount: number }>> {
    return this.execution.executeSubtasks(taskId, options);
  }

  async triggerSubtaskRetry(
    subtaskId: string,
  ): Promise<ServiceResult<{ sessionId: string }>> {
    return this.execution.triggerSubtaskRetry(subtaskId);
  }

  async completeSubtask(
    subtaskId: string,
    result: string,
  ): Promise<ServiceResult<Subtask>> {
    return this.execution.completeSubtask(subtaskId, result);
  }

  async failSubtask(
    subtaskId: string,
    error: string,
  ): Promise<ServiceResult<Subtask>> {
    return this.execution.failSubtask(subtaskId, error);
  }

  async checkStuckSubtasks(): Promise<void> {
    return this.execution.checkStuckSubtasks();
  }
}

/**
 * Create a task service instance
 */
export function createTaskService(options: TaskServiceOptions): TaskService {
  return new TaskService(options);
}
