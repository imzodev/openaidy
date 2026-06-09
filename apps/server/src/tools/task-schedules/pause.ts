import type { BuiltinTool } from '@openaidy/runtime';
import { taskSchedulesPauseMeta } from '../catalog.js';
import type { TaskScheduleToolDeps } from './types.js';

/**
 * Pause a task schedule.
 *
 * Delegates to the service's pauseSchedule method, which internally
 * calls updateSchedule with status='paused'. The schedule row,
 * its nextRunAt, and execution history are preserved.
 */
export function createTaskSchedulesPauseTool(
  deps: TaskScheduleToolDeps,
): BuiltinTool {
  return {
    name: taskSchedulesPauseMeta.name,
    description: taskSchedulesPauseMeta.description,
    parameters: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'The ID of the task whose schedule should be paused.',
        },
      },
      required: ['taskId'],
    },

    async execute(args, _ctx) {
      const service = deps.getTaskScheduleService();
      if (!service) {
        return {
          ok: false,
          error:
            'Task schedule service is not available (database might be disabled).',
        };
      }

      const taskId = args['taskId'] as string | undefined;
      if (!taskId?.trim()) {
        return { ok: false, error: 'taskId is required.' };
      }

      try {
        const result = await service.pauseSchedule(taskId);
        if (!result.ok) {
          return { ok: false, error: result.error.message };
        }

        const s = result.data;
        return {
          ok: true,
          content:
            `Schedule paused for task "${taskId}".\n\n` +
            `ID: ${s.id}\n` +
            `Status: ${s.status}\n` +
            `Use task_schedules_resume to re-activate.`,
        };
      } catch (err) {
        return {
          ok: false,
          error: `Failed to pause task schedule: ${
            err instanceof Error ? err.message : String(err)
          }`,
        };
      }
    },
  };
}
