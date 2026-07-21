import type { BuiltinTool } from '@openaidy/runtime';
import { taskSchedulesListMeta } from '../catalog.js';
import type { TaskScheduleToolDeps } from './types.js';
import type { TaskScheduleDto } from '@openaidy/shared-types';

/**
 * List task schedules.
 *
 * Two modes:
 * - With `taskId` set: returns the schedule for that specific task
 *   (0 or 1 result — schedules are 1:1 with tasks).
 * - Without `taskId`: returns ALL schedules in the system, paginated
 *   by `limit` and `offset`. Used for admin / overview views.
 *
 * This dual mode mirrors how the agent might call it: "show me
 * schedule for task X" or "show me everything that's scheduled".
 */
export function createTaskSchedulesListTool(
  deps: TaskScheduleToolDeps,
): BuiltinTool {
  return {
    name: taskSchedulesListMeta.name,
    description: taskSchedulesListMeta.description,
    parameters: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description:
            'Limit to the schedule for this specific task. If omitted, returns all schedules in the system.',
        },
        limit: {
          type: 'number',
          description:
            'Maximum number of schedules to return (default: 50, max: 100). Only used when taskId is omitted.',
          default: 50,
        },
        offset: {
          type: 'number',
          description:
            'Number of schedules to skip for pagination (default: 0). Only used when taskId is omitted.',
          default: 0,
        },
      },
      required: [],
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
      const limit = Math.min(Math.max(Number(args['limit']) || 50, 1), 100);
      const offset = Math.max(Number(args['offset']) || 0, 0);

      try {
        // Single-task mode.
        if (taskId) {
          if (!taskId.trim()) {
            return { ok: false, error: 'taskId must be a non-empty string.' };
          }
          const result = await service.getScheduleForTask(taskId);
          if (!result.ok) {
            if (result.error.code === 'schedule.not_found') {
              return {
                ok: true,
                content: `No schedule attached to task "${taskId}".`,
              };
            }
            return { ok: false, error: result.error.message };
          }
          return {
            ok: true,
            content: formatSchedule(result.data),
          };
        }

        // System-wide mode: list all schedules with pagination.
        const result = await service.listAllSchedules(limit, offset);
        if (!result.ok) {
          return { ok: false, error: result.error.message };
        }
        const { items, total } = result.data;

        if (items.length === 0) {
          return {
            ok: true,
            content: 'No task schedules found in the system.',
          };
        }

        const lines = items.map(formatSchedule);
        lines.push(
          '',
          `Showing ${items.length} of ${total} schedule${total !== 1 ? 's' : ''} ` +
            `(limit: ${limit}, offset: ${offset}).`,
        );
        return { ok: true, content: lines.join('\n') };
      } catch (err) {
        return {
          ok: false,
          error: `Unexpected error listing task schedules: ${
            err instanceof Error ? err.message : String(err)
          }`,
        };
      }
    },
  };
}

function formatSchedule(s: TaskScheduleDto): string {
  const lines = [
    `ID: ${s.id}`,
    `Task ID: ${s.taskId}`,
    `Schedule: ${s.scheduleHuman}`,
    `Status: ${s.status}`,
    `Replan policy: ${s.replanPolicy}`,
    `Max executions: ${s.maxExecutions} (${s.remainingExecutions} remaining)`,
    `Execution count: ${s.executionCount}`,
    `Next run: ${s.nextRunAt}`,
    s.lastRunAt ? `Last run: ${s.lastRunAt}` : null,
    s.scheduleDate ? `One-shot at: ${s.scheduleDate}` : null,
  ].filter((line): line is string => Boolean(line));
  return lines.join('\n');
}
