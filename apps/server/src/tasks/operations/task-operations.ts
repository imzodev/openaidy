import type {
  TasksRepository,
  SubtasksRepository,
  TaskAgentsRepository,
  Task,
  TaskAgent,
  TaskStatus,
} from '@openaidy/db';
import type { AgentRegistry } from '../../agents';
import type { PlanningService } from '../../planning';
import { createLogger } from '../../lib/logger';
import type {
  CreateTaskInput,
  UpdateTaskInput,
  TaskWithDetails,
  KanbanBoard,
  ServiceResult,
} from '../../types';
import type { TaskScheduleService } from '../schedule-service';

export class TaskOperations {
  constructor(
    private readonly tasksRepo: TasksRepository,
    private readonly subtasksRepo: SubtasksRepository,
    private readonly taskAgentsRepo: TaskAgentsRepository,
    private readonly agents: AgentRegistry | undefined,
    private readonly planningService: PlanningService | undefined,
    private taskSchedulesService: TaskScheduleService | undefined,
    private readonly logger: ReturnType<typeof createLogger>,
  ) {}

  /**
   * Inject or update the TaskScheduleService after construction.
   * Used when TaskService is created before the recurring tasks block
   * (which creates the TaskScheduleService) in app.ts.
   */
  setTaskSchedulesService(service: TaskScheduleService | undefined): void {
    this.taskSchedulesService = service;
  }

  async createTask(input: CreateTaskInput): Promise<ServiceResult<Task>> {
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

    if (input.agents && input.agents.length > 0) {
      const agentsWithRoles = input.agents.map((a) => ({
        agentId: a.agentId,
        ...(a.role !== undefined && { role: a.role }),
      }));
      await this.taskAgentsRepo.assignMultiple(task.id, agentsWithRoles);
    }

    // Phase 3: if a schedule was provided, create the schedule row.
    if (input.schedule && this.taskSchedulesService) {
      const scheduleResult = await this.taskSchedulesService.createSchedule(
        task.id,
        input.schedule,
      );
      if (!scheduleResult.ok) {
        this.logger.warn('Failed to create schedule for task', {
          taskId: task.id,
          error: scheduleResult.error,
        });
      }
    }

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

  async getTask(id: string): Promise<Task | null> {
    return this.tasksRepo.findById(id);
  }

  async getTaskWithDetails(id: string): Promise<TaskWithDetails | null> {
    const task = await this.tasksRepo.findById(id);
    if (!task) return null;

    const [agents, subtasks, statusCounts] = await Promise.all([
      this.taskAgentsRepo.listByTask(id),
      this.subtasksRepo.listByTask(id),
      this.subtasksRepo.getCountsByStatus(id),
    ]);

    let schedule: TaskWithDetails['schedule'];
    if (this.taskSchedulesService) {
      const scheduleResult =
        await this.taskSchedulesService.getScheduleForTask(id);
      if (scheduleResult.ok) {
        schedule = scheduleResult.data;
      }
    }

    const result: TaskWithDetails = {
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
    if (schedule !== undefined) {
      result.schedule = schedule;
    }
    return result;
  }

  async listTasks(status?: TaskStatus): Promise<Task[]> {
    return this.tasksRepo.list(status);
  }

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

  async updateTask(
    id: string,
    input: UpdateTaskInput,
  ): Promise<ServiceResult<Task>> {
    const existing = await this.tasksRepo.findById(id);
    if (!existing) {
      return {
        ok: false,
        error: { code: 'task.not_found', message: `Task "${id}" not found` },
      };
    }
    const updated = await this.tasksRepo.update(id, input);
    return { ok: true, data: updated! };
  }

  async updateTaskStatus(
    id: string,
    status: TaskStatus,
  ): Promise<ServiceResult<Task>> {
    const existing = await this.tasksRepo.findById(id);
    if (!existing) {
      return {
        ok: false,
        error: { code: 'task.not_found', message: `Task "${id}" not found` },
      };
    }
    const updated = await this.tasksRepo.updateStatus(id, status);
    return { ok: true, data: updated! };
  }

  async deleteTask(id: string): Promise<ServiceResult<true>> {
    const existing = await this.tasksRepo.findById(id);
    if (!existing) {
      return {
        ok: false,
        error: { code: 'task.not_found', message: `Task "${id}" not found` },
      };
    }
    await this.tasksRepo.delete(id);
    return { ok: true, data: true };
  }

  async assignAgents(
    taskId: string,
    agents: Array<{ agentId: string; role?: import('@openaidy/db').AgentRole }>,
  ): Promise<ServiceResult<TaskAgent[]>> {
    const existing = await this.tasksRepo.findById(taskId);
    if (!existing) {
      return {
        ok: false,
        error: {
          code: 'task.not_found',
          message: `Task "${taskId}" not found`,
        },
      };
    }
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

  async removeAgent(
    taskId: string,
    agentId: string,
  ): Promise<ServiceResult<true>> {
    await this.taskAgentsRepo.remove(taskId, agentId);
    return { ok: true, data: true };
  }

  async getTaskAgents(taskId: string): Promise<TaskAgent[]> {
    return this.taskAgentsRepo.listByTask(taskId);
  }

  async updatePlanningStatus(
    taskId: string,
    status: import('@openaidy/db').PlanningStatus,
  ): Promise<ServiceResult<Task>> {
    const existing = await this.tasksRepo.findById(taskId);
    if (!existing) {
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

  async createSubtasks(
    taskId: string,
    subtasks: Array<{
      title: string;
      description: string;
      assignedAgentId?: string;
    }>,
  ): Promise<ServiceResult<import('@openaidy/db').Subtask[]>> {
    const existing = await this.tasksRepo.findById(taskId);
    if (!existing) {
      return {
        ok: false,
        error: {
          code: 'task.not_found',
          message: `Task "${taskId}" not found`,
        },
      };
    }
    const created: import('@openaidy/db').Subtask[] = [];
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
      created.push(await this.subtasksRepo.create(createInput));
    }
    return { ok: true, data: created };
  }
}
