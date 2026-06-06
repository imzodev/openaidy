import type { BuiltinTool } from '@openaidy/runtime';
import { taskSchedulesCreateMeta } from '../catalog.js';
import type { TaskScheduleToolDeps } from './types.js';
import type { CreateTaskScheduleInput } from '@openaidy/shared-types';
import { buildScheduleInput } from './utils.js';

/**
 * Attach a schedule to an existing task.
 *
 * Schedules are 1:1 with tasks — calling this on a task that
 * already has a schedule returns an error (the agent should use
 * the update tool instead).
 *
 * The `schedule` shape matches the shared `ScheduleInput` discriminated
 * union. The agent supplies either a preset, a daily time, a cron
 * expression, or a one-shot datetime.
 */
export function createTaskSchedulesCreateTool(
  deps: TaskScheduleToolDeps,
): BuiltinTool {
  return {
    name: taskSchedulesCreateMeta.name,
    description: taskSchedulesCreateMeta.description,
    parameters: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description:
            'The ID of the task to attach this schedule to. The task must exist.',
        },
        schedule: {
          type: 'object',
          description:
            'When and how often the task should run. ' +
            'Use schedule.every for PRESET intervals only (every 15m/30m/1h/6h/12h/1d/1w). ' +
            'For ANY other interval (e.g. every 5min), use schedule.cron. ' +
            'Also supports daily times and one-shot datetimes.',
          properties: {
            every: {
              type: 'string',
              enum: ['15m', '30m', '1h', '6h', '12h', '1d', '1w'],
              description:
                'PRESET intervals ONLY. For custom intervals, use schedule.cron.',
            },
            daily: {
              type: 'object',
              description: 'Run once daily at a specific time.',
              properties: {
                hour: { type: 'number', description: 'Hour 0-23.' },
                minute: { type: 'number', description: 'Minute 0-59.' },
              },
            },
            cron: {
              type: 'object',
              description: 'Run on a cron expression.',
              properties: {
                expression: { type: 'string' },
                tz: { type: 'string' },
              },
            },
            at: {
              type: 'string',
              description: 'Run once at this ISO datetime.',
            },
          },
        },
        replanPolicy: {
          type: 'string',
          enum: ['never', 'on-description-change', 'always'],
          description:
            'When to re-invoke the planning agent on each run. ' +
            "'never' (default) reuses the existing subtasks — cheap. " +
            "'on-description-change' re-plans only when the task description changes. " +
            "'always' re-plans on every run (expensive).",
        },
        maxExecutions: {
          type: 'number',
          description:
            'Maximum number of times the schedule will fire. ' +
            'Defaults to 9999 when omitted. Must be a positive integer. ' +
            'There is no "infinite" option.',
        },
      },
      required: ['taskId', 'schedule'],
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
      const schedule = args['schedule'] as Record<string, unknown> | undefined;
      const replanPolicy = args['replanPolicy'] as
        | 'never'
        | 'on-description-change'
        | 'always'
        | undefined;
      const maxExecutions = args['maxExecutions'] as number | undefined;

      if (!taskId?.trim()) {
        return { ok: false, error: 'taskId is required.' };
      }
      if (!schedule) {
        return { ok: false, error: 'schedule is required.' };
      }

      const scheduleInput = buildScheduleInput(schedule);
      if (!scheduleInput.ok) {
        return { ok: false, error: scheduleInput.error };
      }

      try {
        const input: CreateTaskScheduleInput = {
          schedule: scheduleInput.value,
        };
        if (replanPolicy !== undefined) input.replanPolicy = replanPolicy;
        if (maxExecutions !== undefined) input.maxExecutions = maxExecutions;

        const result = await service.createSchedule(taskId, input);
        if (!result.ok) {
          return { ok: false, error: result.error.message };
        }

        const s = result.data;
        return {
          ok: true,
          content:
            `Successfully created schedule for task "${taskId}".\n\n` +
            `ID: ${s.id}\n` +
            `Schedule: ${s.scheduleHuman}\n` +
            `Replan policy: ${s.replanPolicy}\n` +
            `Max executions: ${s.maxExecutions}\n` +
            `Next run: ${s.nextRunAt}\n` +
            `Status: ${s.status}`,
        };
      } catch (err) {
        return {
          ok: false,
          error: `Failed to create task schedule: ${
            err instanceof Error ? err.message : String(err)
          }`,
        };
      }
    },
  };
}
