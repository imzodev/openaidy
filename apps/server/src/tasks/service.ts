import type {
  Task,
  Subtask,
  SubtaskEdge,
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
import { WorkflowTemplateOperations } from './operations/workflow-template-operations';
import {
  WorkflowGraphOperations,
  type SetGraphResult,
} from './operations/workflow-graph-operations';
import type {
  WorkflowGraph,
  WorkflowGraphCheck,
} from '@openaidy/workflow-templates';
import {
  TaskExecution,
  type StartRunOptions,
} from './execution/task-execution';
import type { WorkflowRun } from '@openaidy/db';
import type { WorkflowRunTrigger } from '@openaidy/shared-types';
import type {
  TaskServiceOptions,
  CreateTaskInput,
  UpdateTaskInput,
  CreateSubtaskInput,
  UpdateSubtaskInput,
  TaskWithDetails,
  KanbanBoard,
  ServiceResult,
} from '../types';

export type {
  TaskServiceOptions,
  CreateTaskInput,
  UpdateTaskInput,
  CreateSubtaskInput,
  UpdateSubtaskInput,
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
  private readonly templateOps: WorkflowTemplateOperations;
  private readonly graphOps: WorkflowGraphOperations;
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
    this.graphOps = new WorkflowGraphOperations(
      options.tasksRepo,
      options.subtasksRepo,
      options.agents,
      logger,
    );
    this.subtaskOps = new SubtaskOperations(
      options.tasksRepo,
      options.subtasksRepo,
      options.agents,
      logger,
      this.graphOps,
      (taskId) => this.execution.isRunning(taskId),
    );
    this.templateOps = new WorkflowTemplateOperations(
      options.tasksRepo,
      options.subtasksRepo,
      logger,
      options.agents,
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
      options.getExecutionConfig,
      options.workflowRunsRepo,
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

  async getSubtask(id: string): Promise<Subtask | null> {
    return this.subtaskOps.getSubtask(id);
  }

  async getSubtaskEdge(id: string): Promise<SubtaskEdge | null> {
    return this.subtaskOps.getSubtaskEdge(id);
  }

  async getSubtasks(
    taskId: string,
  ): Promise<(Subtask & { dependsOnSubtaskIds: string[] })[]> {
    return this.subtaskOps.getSubtasks(taskId);
  }

  async updateSubtask(
    id: string,
    input: UpdateSubtaskInput,
  ): Promise<ServiceResult<Subtask>> {
    return this.subtaskOps.updateSubtask(id, input);
  }

  async deleteSubtask(id: string): Promise<ServiceResult<true>> {
    return this.subtaskOps.deleteSubtask(id);
  }

  async listSubtaskEdges(
    taskId: string,
  ): ReturnType<SubtaskOperations['listSubtaskEdges']> {
    return this.subtaskOps.listSubtaskEdges(taskId);
  }

  async createSubtaskEdge(
    taskId: string,
    input: Parameters<SubtaskOperations['createSubtaskEdge']>[1],
  ): ReturnType<SubtaskOperations['createSubtaskEdge']> {
    return this.subtaskOps.createSubtaskEdge(taskId, input);
  }

  async updateSubtaskEdge(
    id: string,
    input: Parameters<SubtaskOperations['updateSubtaskEdge']>[1],
  ): ReturnType<SubtaskOperations['updateSubtaskEdge']> {
    return this.subtaskOps.updateSubtaskEdge(id, input);
  }

  async deleteSubtaskEdge(
    id: string,
  ): ReturnType<SubtaskOperations['deleteSubtaskEdge']> {
    return this.subtaskOps.deleteSubtaskEdge(id);
  }

  async updateSubtaskStatus(
    id: string,
    status: SubtaskStatus,
  ): Promise<ServiceResult<Subtask>> {
    return this.subtaskOps.updateSubtaskStatus(id, status);
  }

  async assignSubtaskAgent(
    id: string,
    agentId: string | null,
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
  // Workflow Templates
  // ========================================

  /**
   * Adds a template's steps to the task. With `clearExisting` the template
   * replaces the current graph: the old steps are only removed once the
   * template's are in place, so a failure leaves the workflow unchanged.
   */
  async applyWorkflowTemplate(
    taskId: string,
    templateId: string,
    inputs: Record<string, string>,
    options: { clearExisting?: boolean } = {},
  ): ReturnType<WorkflowTemplateOperations['applyTemplate']> {
    const locked = await this.refuseWhileRunning(taskId);
    if (locked) return locked;
    if (!options.clearExisting) {
      return this.templateOps.applyTemplate(taskId, templateId, inputs);
    }
    return this.graphOps.replaceGraph(taskId, () =>
      this.templateOps.applyTemplate(taskId, templateId, inputs),
    );
  }

  // ========================================
  // Workflow graph
  // ========================================

  /** Problems that would stop the workflow from running as built. */
  async checkWorkflow(
    taskId: string,
  ): Promise<ServiceResult<WorkflowGraphCheck>> {
    return this.graphOps.checkTask(taskId);
  }

  /** Validates a graph before any workflow exists for it. */
  checkWorkflowGraph(graph: WorkflowGraph): WorkflowGraphCheck {
    return this.graphOps.checkGraph(graph);
  }

  /**
   * Replaces the workflow's whole graph in one validated write (or, with
   * `dryRun`, only validates it). Node `agentId`s may be agent names.
   */
  async setWorkflowGraph(
    taskId: string,
    graph: WorkflowGraph,
    options: { dryRun?: boolean } = {},
  ): Promise<ServiceResult<SetGraphResult>> {
    if (!options.dryRun) {
      const locked = await this.refuseWhileRunning(taskId);
      if (locked) return locked;
    }
    return this.graphOps.setGraph(taskId, graph, options);
  }

  /** Saves where nodes sit on the canvas (allowed during a run). */
  async saveWorkflowLayout(
    taskId: string,
    positions: Record<string, { x: number; y: number }>,
  ): Promise<ServiceResult<{ updated: number }>> {
    return this.graphOps.savePositions(taskId, positions);
  }

  private async refuseWhileRunning(
    taskId: string,
  ): Promise<ServiceResult<never> | null> {
    if (!(await this.execution.isRunning(taskId))) return null;
    return {
      ok: false,
      error: {
        code: 'workflow.locked',
        message:
          'This workflow is running. Stop the run (or wait for it to finish) before changing its steps.',
      },
    };
  }

  /** Refuses to start a workflow whose graph can't run as built. */
  private async refuseInvalidGraph(
    taskId: string,
  ): Promise<ServiceResult<never> | null> {
    const task = await this.ops.getTask(taskId);
    if (!task) {
      return {
        ok: false,
        error: {
          code: 'task.not_found',
          message: `Task "${taskId}" not found`,
        },
      };
    }
    if (!task.planningEnabled) return null;
    const check = await this.graphOps.checkTask(taskId);
    if (!check.ok || check.data.ok) return null;
    return {
      ok: false,
      error: {
        code: 'workflow.invalid_graph',
        message: `Fix these before running the workflow:\n${check.data.errors.map((e) => `- ${e.message}`).join('\n')}`,
        details: { issues: check.data.errors },
      },
    };
  }

  // ========================================
  // Execution
  // ========================================

  async executeTask(
    taskId: string,
    options: { sessionId?: string; input?: string } = {},
  ): Promise<ServiceResult<{ sessionId: string; runId: string }>> {
    const invalid = await this.refuseInvalidGraph(taskId);
    if (invalid) return invalid;
    return this.execution.executeTask(taskId, options);
  }

  async startRun(
    taskId: string,
    options: StartRunOptions = {},
  ): Promise<ServiceResult<{ runId: string; sessionId: string }>> {
    const invalid = await this.refuseInvalidGraph(taskId);
    if (invalid) return invalid;
    return this.execution.startRun(taskId, options);
  }

  async cancelRun(taskId: string): Promise<ServiceResult<WorkflowRun>> {
    return this.execution.cancelRun(taskId);
  }

  async retrySubtask(subtaskId: string): Promise<ServiceResult<Subtask>> {
    return this.execution.retrySubtask(subtaskId);
  }

  async listRuns(taskId: string, limit?: number): Promise<WorkflowRun[]> {
    return this.execution.listRuns(taskId, limit);
  }

  async getRun(runId: string): Promise<WorkflowRun | null> {
    return this.execution.getRun(runId);
  }

  /** Approval gates waiting for a decision, across all workflows. */
  async listPendingApprovals(): Promise<
    Array<Subtask & { taskTitle: string }>
  > {
    return this.execution.listPendingApprovals();
  }

  /** Subscribe to runs finishing or reaching an approval step. */
  onRunEvent(listener: Parameters<TaskExecution['onRunEvent']>[0]): () => void {
    return this.execution.onRunEvent(listener);
  }

  /** Subscribe to run/step changes (task id per change). */
  onWorkflowChange(listener: (taskId: string) => void): () => void {
    return this.execution.onWorkflowChange(listener);
  }

  async recoverInterruptedRuns(): Promise<void> {
    return this.execution.recoverInterruptedRuns();
  }

  /** Resolves once background workflow work has settled (tests). */
  async whenIdle(): Promise<void> {
    return this.execution.whenIdle();
  }

  async executeSubtask(
    subtaskId: string,
  ): Promise<ServiceResult<{ sessionId: string | null }>> {
    return this.execution.executeSubtask(subtaskId);
  }

  async executeSubtasks(
    taskId: string,
    options: { trigger?: WorkflowRunTrigger } = {},
  ): Promise<ServiceResult<{ startedCount: number; runId: string }>> {
    return this.execution.executeSubtasks(taskId, options);
  }

  async triggerSubtaskRetry(
    subtaskId: string,
    reason?: string,
  ): Promise<ServiceResult<{ sessionId: string }>> {
    return this.execution.triggerSubtaskRetry(subtaskId, reason);
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

  async resolveApproval(
    subtaskId: string,
    decision: 'approved' | 'rejected',
    note?: string,
    approvedBy?: string,
  ): Promise<ServiceResult<Subtask>> {
    return this.execution.resolveApproval(
      subtaskId,
      decision,
      note,
      approvedBy,
    );
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
