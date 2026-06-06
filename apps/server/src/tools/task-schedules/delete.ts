import type { BuiltinTool } from '@openaidy/runtime';
import { taskSchedulesDeleteMeta } from '../catalog.js';
import type { TaskScheduleToolDeps } from './types.js';

/**
 * Permanently remove a task's schedule.
 *
 * Requires `confirm=true` to prevent accidental deletion (matching
 * the pattern of `tasks_delete` and `pulses_delete`). Execution
 * history rows for the schedule are cascade-deleted by the FK, so
 * any history is gone too — there is no soft-delete.
 */
export function createTaskSchedulesDeleteTool(
  deps: TaskScheduleToolDeps,
): BuiltinTool {
  return {
    name: taskSchedulesDeleteMeta.name,
    description: taskSchedulesDeleteMeta.description,
    parameters: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'The ID of the task whose schedule should be removed.',
        },
        confirm: {
          type: 'boolean',
          description:
            'Must be true to confirm deletion. Set to false (or omit) to abort — this is a safety interlock against accidental deletion.',
        },
      },
      required: ['taskId', 'confirm'],
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
      const confirm = args['confirm'] as boolean | undefined;

      if (!taskId?.trim()) {
        return { ok: false, error: 'taskId is required.' };
      }
      if (confirm !== true) {
        return {
          ok: false,
          error:
            'Deletion aborted: confirm=true is required. Pass confirm=true to confirm.',
        };
      }

      try {
        const result = await service.removeSchedule(taskId);
        if (!result.ok) {
          if (result.error.code === 'schedule.not_found') {
            return {
              ok: false,
              error: `No schedule attached to task "${taskId}".`,
            };
          }
          return { ok: false, error: result.error.message };
        }
        return {
          ok: true,
          content: `Schedule for task "${taskId}" was permanently removed (along with its execution history).`,
        };
      } catch (err) {
        return {
          ok: false,
          error: `Failed to delete task schedule: ${
            err instanceof Error ? err.message : String(err)
          }`,
        };
      }
    },
  };
}
