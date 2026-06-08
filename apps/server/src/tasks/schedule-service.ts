import type {
  CreateTaskScheduleInput,
  UpdateTaskScheduleInput,
  TaskScheduleDto,
  TaskExecutionHistoryDto,
  TaskExecutionHistoryStatus,
} from '@openaidy/shared-types';
import { parseScheduleInput } from '../pulses/utils';
import { taskScheduleToDto, taskExecutionHistoryToDto } from './schedule-dto';
import { createLogger } from '../lib/logger';
import type { ServiceResult, TaskScheduleServiceDeps } from '../types';

export class TaskScheduleService {
  private readonly logger = createLogger('TaskScheduleService');

  constructor(private readonly deps: TaskScheduleServiceDeps) {}

  // ========================================
  // Read
  // ========================================

  async getScheduleForTask(
    taskId: string,
  ): Promise<ServiceResult<TaskScheduleDto>> {
    const schedule = await this.deps.taskSchedulesRepo.findByTaskId(taskId);
    if (!schedule) {
      return {
        ok: false,
        error: {
          code: 'schedule.not_found',
          message: `No schedule for task ${taskId}`,
        },
      };
    }
    return { ok: true, data: taskScheduleToDto(schedule) };
  }

  async getScheduleById(id: string): Promise<ServiceResult<TaskScheduleDto>> {
    const schedule = await this.deps.taskSchedulesRepo.findById(id);
    if (!schedule) {
      return {
        ok: false,
        error: {
          code: 'schedule.not_found',
          message: `Schedule ${id} not found`,
        },
      };
    }
    return { ok: true, data: taskScheduleToDto(schedule) };
  }

  /**
   * List all schedules system-wide, paginated.
   * Used by the task_schedules_list tool when no taskId is provided.
   */
  async listAllSchedules(
    limit: number,
    offset: number,
  ): Promise<
    ServiceResult<{
      items: TaskScheduleDto[];
      total: number;
      limit: number;
      offset: number;
    }>
  > {
    const { items, total } = await this.deps.taskSchedulesRepo.listAll(
      limit,
      offset,
    );
    return {
      ok: true,
      data: {
        items: items.map(taskScheduleToDto),
        total,
        limit,
        offset,
      },
    };
  }

  // ========================================
  // Create
  // ========================================

  async createSchedule(
    taskId: string,
    input: CreateTaskScheduleInput,
  ): Promise<ServiceResult<TaskScheduleDto>> {
    const task = await this.deps.tasksRepo.findById(taskId);
    if (!task) {
      return {
        ok: false,
        error: { code: 'task.not_found', message: `Task ${taskId} not found` },
      };
    }

    // Refuse if a schedule already exists
    const existing = await this.deps.taskSchedulesRepo.findByTaskId(taskId);
    if (existing) {
      return {
        ok: false,
        error: {
          code: 'schedule.already_exists',
          message: 'Task already has a schedule. Use updateSchedule to modify.',
        },
      };
    }

    const parsed = parseScheduleInput(input.schedule);
    if (parsed.type !== 'cron' && parsed.type !== 'one-shot') {
      return {
        ok: false,
        error: { code: 'schedule.invalid', message: 'Invalid schedule type' },
      };
    }

    const schedule = await this.deps.taskSchedulesRepo.create({
      taskId,
      cronExpression: parsed.cronExpression ?? null,
      preset: 'every' in input.schedule ? input.schedule.every : null,
      scheduleDate: parsed.schedule ?? null,
      nextRunAt: parsed.nextRunAt,
      replanPolicy: input.replanPolicy ?? 'never',
      maxExecutions: input.maxExecutions ?? 9999,
    });

    this.logger.info('Schedule created', { taskId, scheduleId: schedule.id });
    return { ok: true, data: taskScheduleToDto(schedule) };
  }

  // ========================================
  // Update
  // ========================================

  async updateSchedule(
    taskId: string,
    input: UpdateTaskScheduleInput,
  ): Promise<ServiceResult<TaskScheduleDto>> {
    const existing = await this.deps.taskSchedulesRepo.findByTaskId(taskId);
    if (!existing) {
      return {
        ok: false,
        error: {
          code: 'schedule.not_found',
          message: `No schedule for task ${taskId}`,
        },
      };
    }

    const updates: {
      nextRunAt?: Date;
      lastRunAt?: Date | null;
      status?: 'active' | 'paused' | 'expired';
      replanPolicy?: 'never' | 'on-description-change' | 'always';
      maxExecutions?: number;
      descriptionHash?: string | null;
      executionCount?: number;
      cronExpression?: string | null;
      preset?: string | null;
      scheduleDate?: Date | null;
    } = {};

    if (input.schedule !== undefined) {
      const parsed = parseScheduleInput(input.schedule);
      updates.cronExpression = parsed.cronExpression ?? null;
      updates.preset = 'every' in input.schedule ? input.schedule.every : null;
      updates.scheduleDate = parsed.schedule ?? null;
      updates.nextRunAt = parsed.nextRunAt;
    }

    if (input.status !== undefined) {
      // Cannot transition out of 'expired' (terminal)
      if (
        existing.status === 'expired' &&
        (input.status as string) !== 'expired'
      ) {
        return {
          ok: false,
          error: {
            code: 'schedule.expired',
            message: 'Cannot resume an expired schedule. Create a new one.',
          },
        };
      }
      updates.status = input.status;
    }

    if (input.maxExecutions !== undefined) {
      // Validate: must be a positive integer. The DB CHECK constraint also
      // enforces this, but we surface a clean error before hitting it.
      if (!Number.isInteger(input.maxExecutions) || input.maxExecutions <= 0) {
        return {
          ok: false,
          error: {
            code: 'schedule.invalid_max_executions',
            message: 'maxExecutions must be a positive integer',
          },
        };
      }
      updates.maxExecutions = input.maxExecutions;
    }

    const updated = await this.deps.taskSchedulesRepo.update(
      existing.id,
      updates,
    );
    if (!updated) {
      return {
        ok: false,
        error: {
          code: 'schedule.update_failed',
          message: `Failed to update schedule for task ${taskId}`,
        },
      };
    }
    this.logger.info('Schedule updated', { taskId, scheduleId: existing.id });
    return { ok: true, data: taskScheduleToDto(updated) };
  }

  // ========================================
  // Remove
  // ========================================

  async removeSchedule(taskId: string): Promise<ServiceResult<true>> {
    const existing = await this.deps.taskSchedulesRepo.findByTaskId(taskId);
    if (!existing) {
      return {
        ok: false,
        error: {
          code: 'schedule.not_found',
          message: `No schedule for task ${taskId}`,
        },
      };
    }
    await this.deps.taskSchedulesRepo.delete(existing.id);
    this.logger.info('Schedule removed', { taskId, scheduleId: existing.id });
    return { ok: true, data: true };
  }

  // ========================================
  // Pause / Resume
  // ========================================

  async pauseSchedule(taskId: string): Promise<ServiceResult<TaskScheduleDto>> {
    return this.updateSchedule(taskId, { status: 'paused' });
  }

  async resumeSchedule(
    taskId: string,
  ): Promise<ServiceResult<TaskScheduleDto>> {
    return this.updateSchedule(taskId, { status: 'active' });
  }

  // ========================================
  // Trigger
  // ========================================

  async triggerNow(taskId: string): Promise<
    ServiceResult<{
      historyId: string;
    }>
  > {
    const schedule = await this.deps.taskSchedulesRepo.findByTaskId(taskId);
    if (!schedule) {
      return {
        ok: false,
        error: {
          code: 'schedule.not_found',
          message: `No schedule for task ${taskId}`,
        },
      };
    }
    const result = await this.deps.taskScheduleExecutor.triggerNow(schedule.id);
    if (!result.ok) {
      return {
        ok: false,
        error: {
          code: 'execution.failed',
          message: result.error ?? 'Unknown error',
        },
      };
    }
    return { ok: true, data: { historyId: result.historyId } };
  }

  // ========================================
  // History
  // ========================================

  async listExecutions(
    taskId: string,
    filters: {
      status?: TaskExecutionHistoryStatus;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<
    ServiceResult<{
      items: TaskExecutionHistoryDto[];
      total: number;
      limit: number;
      offset: number;
    }>
  > {
    const limit = filters.limit ?? 20;
    const offset = filters.offset ?? 0;

    // Fetch all rows for this task, then filter and paginate in-memory.
    // TODO (Phase 7): add status filter to repository query for efficiency.
    const allRows = await this.deps.taskExecutionHistoryRepo.listByTask(taskId);

    let filteredRows = allRows;
    if (filters.status !== undefined) {
      filteredRows = allRows.filter((row) => row.status === filters.status);
    }

    const total = filteredRows.length;
    const paginatedRows = filteredRows.slice(offset, offset + limit);

    return {
      ok: true,
      data: {
        items: paginatedRows.map(taskExecutionHistoryToDto),
        total,
        limit,
        offset,
      },
    };
  }

  // ========================================
  // Helpers
  // ========================================

  // The description hash is owned and updated by the executor (in reschedule).
  // This service layer doesn't need to do anything on description changes —
  // the executor compares the current hash against schedule.descriptionHash
  // on the next claim and decides whether to replan.
}
