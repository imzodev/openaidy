import type { BuiltinTool } from '@openaidy/runtime';
import { taskSchedulesResumeMeta } from '../catalog.js';
import type { TaskScheduleToolDeps } from './types.js';

/**
 * Resume a paused task schedule.
 *
 * Delegates to the service's resumeSchedule method, which internally
 * calls updateSchedule with status='active'. The next run happens at
 * the next cron tick after the resume time (we do not "catch up"
 * missed runs).
 */
export function createTaskSchedulesResumeTool(
  deps: TaskScheduleToolDeps,
): BuiltinTool {
  return {
    name: taskSchedulesResumeMeta.name,
    description: taskSchedulesResumeMeta.description,
    parameters: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'The ID of the task whose schedule should be resumed.',
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
        const result = await service.resumeSchedule(taskId);
        if (!result.ok) {
          return { ok: false, error: result.error.message };
        }

        const s = result.data;
        return {
          ok: true,
          content:
            `Schedule resumed for task "${taskId}".\n\n` +
            `ID: ${s.id}\n` +
            `Status: ${s.status}\n` +
            `Next run: ${s.nextRunAt}`,
        };
      } catch (err) {
        return {
          ok: false,
          error: `Failed to resume task schedule: ${
            err instanceof Error ? err.message : String(err)
          }`,
        };
      }
    },
  };
}
