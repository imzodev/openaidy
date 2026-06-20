import type { TaskSchedule, TaskExecutionHistoryRow } from '@openaidy/db';
import type {
  TaskScheduleDto,
  TaskExecutionHistoryDto,
  ScheduleInput,
  ExecutionSubtaskSummary,
} from '@openaidy/shared-types';
import { describeCronExpression } from '../scheduler/cron-utils';

/**
 * Map a task_schedules row to its public DTO.
 * Derives the human-readable schedule description and the original
 * ScheduleInput shape for the UI.
 */
export function taskScheduleToDto(schedule: TaskSchedule): TaskScheduleDto {
  const scheduleInput: ScheduleInput | null = scheduleToInput(schedule);
  const scheduleHuman = schedule.cronExpression
    ? describeCronExpression(schedule.cronExpression)
    : schedule.scheduleDate
      ? `Once at ${schedule.scheduleDate.toISOString()}`
      : 'Unknown schedule';

  const dto: TaskScheduleDto = {
    id: schedule.id,
    taskId: schedule.taskId,
    schedule: scheduleInput ?? { cron: schedule.cronExpression ?? '' },
    cronExpression: schedule.cronExpression,
    preset: (schedule.preset as TaskScheduleDto['preset']) ?? null,
    scheduleDate: schedule.scheduleDate?.toISOString() ?? null,
    nextRunAt: schedule.nextRunAt.toISOString(),
    lastRunAt: schedule.lastRunAt?.toISOString() ?? null,
    status: schedule.status,
    replanPolicy: schedule.replanPolicy,
    maxExecutions: schedule.maxExecutions,
    remainingExecutions: Math.max(
      0,
      schedule.maxExecutions - schedule.executionCount,
    ),
    executionCount: schedule.executionCount,
    scheduleHuman,
    createdAt: schedule.createdAt.toISOString(),
    updatedAt: schedule.updatedAt.toISOString(),
  };
  return dto;
}

/**
 * Best-effort reconstruction of the original ScheduleInput that
 * produced this schedule row. Returns null if the row's shape
 * does not match any known ScheduleInput variant.
 */
function scheduleToInput(schedule: TaskSchedule): ScheduleInput | null {
  if (schedule.preset) {
    return {
      every: schedule.preset as
        | '15m'
        | '30m'
        | '1h'
        | '6h'
        | '12h'
        | '1d'
        | '1w',
    };
  }
  if (schedule.cronExpression && !schedule.scheduleDate) {
    return { cron: schedule.cronExpression };
  }
  if (schedule.scheduleDate) {
    return { at: schedule.scheduleDate.toISOString() };
  }
  return null;
}

/**
 * Map a task_execution_history row to its public DTO.
 */
export function taskExecutionHistoryToDto(
  row: TaskExecutionHistoryRow,
): TaskExecutionHistoryDto {
  const durationMs =
    row.finishedAt && row.startedAt
      ? row.finishedAt.getTime() - row.startedAt.getTime()
      : null;
  let subtaskSummary: ExecutionSubtaskSummary | null = null;
  if (row.subtaskSummary) {
    try {
      subtaskSummary = JSON.parse(
        row.subtaskSummary,
      ) as ExecutionSubtaskSummary;
    } catch {
      // Corrupt JSON — leave as null
    }
  }
  return {
    id: row.id,
    taskId: row.taskId,
    scheduleId: row.scheduleId,
    status: row.status,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    durationMs,
    sessionId: row.sessionId,
    attemptNumber: row.attemptNumber,
    didReplan: row.didReplan,
    taskTitle: row.taskTitle,
    taskDescription: row.taskDescription,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    subtaskSummary,
    createdAt: row.createdAt.toISOString(),
  };
}
