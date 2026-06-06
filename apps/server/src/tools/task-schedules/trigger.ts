import type { BuiltinTool } from '@openaidy/runtime';
import { taskSchedulesTriggerMeta } from '../catalog.js';
import type { TaskScheduleToolDeps } from './types.js';

/**
 * Trigger an immediate run of a task schedule.
 *
 * Unlike Pulses (where `trigger` just enqueues a job for the next
 * scheduler tick), task schedules run an actual agent execution
 * cycle. The trigger is async: the executor creates a session,
 * optionally re-plans, runs subtasks, and the run continues
 * asynchronously. The tool returns the new history row's ID so
 * the caller can poll `task_schedules_list_executions` to track
 * progress.
 */
export function createTaskSchedulesTriggerTool(
  deps: TaskScheduleToolDeps,
): BuiltinTool {
  return {
    name: taskSchedulesTriggerMeta.name,
    description: taskSchedulesTriggerMeta.description,
    parameters: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'The ID of the task whose schedule should fire now.',
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
        const result = await service.triggerNow(taskId);
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
          content:
            `Triggered immediate run of task "${taskId}".\n\n` +
            `History ID: ${result.data.historyId}\n` +
            `Use task_schedules_list_executions with taskId="${taskId}" to track progress.`,
        };
      } catch (err) {
        return {
          ok: false,
          error: `Failed to trigger task schedule: ${
            err instanceof Error ? err.message : String(err)
          }`,
        };
      }
    },
  };
}
