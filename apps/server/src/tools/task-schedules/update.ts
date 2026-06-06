import type { BuiltinTool } from '@openaidy/runtime';
import { taskSchedulesUpdateMeta } from '../catalog.js';
import type { TaskScheduleToolDeps } from './types.js';
import type { UpdateTaskScheduleInput } from '@openaidy/shared-types';
import { buildScheduleInput } from './utils.js';

/**
 * Update an existing task schedule.
 *
 * All fields except `taskId` are optional. At least one of them
 * must be provided — the service enforces this and returns a 400
 * equivalent if the body is empty.
 *
 * To pause/resume a schedule, prefer the dedicated `pause` and
 * `resume` tools — they encode the intent more clearly. To stop
 * firing forever, use `delete`.
 */
export function createTaskSchedulesUpdateTool(
  deps: TaskScheduleToolDeps,
): BuiltinTool {
  return {
    name: taskSchedulesUpdateMeta.name,
    description: taskSchedulesUpdateMeta.description,
    parameters: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'The ID of the task whose schedule should be updated.',
        },
        schedule: {
          type: 'object',
          description: 'New schedule definition. See create tool for shape.',
          properties: {
            every: {
              type: 'string',
              enum: ['15m', '30m', '1h', '6h', '12h', '1d', '1w'],
            },
            daily: {
              type: 'object',
              properties: {
                hour: { type: 'number' },
                minute: { type: 'number' },
              },
            },
            cron: {
              type: 'object',
              properties: {
                expression: { type: 'string' },
                tz: { type: 'string' },
              },
            },
            at: { type: 'string' },
          },
        },
        replanPolicy: {
          type: 'string',
          enum: ['never', 'on-description-change', 'always'],
          description: 'New replan policy.',
        },
        maxExecutions: {
          type: 'number',
          description: 'New max-executions cap. Must be a positive integer.',
        },
        status: {
          type: 'string',
          enum: ['active', 'paused'],
          description: 'New status. Cannot transition out of "expired".',
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

      const schedule = args['schedule'] as Record<string, unknown> | undefined;
      const replanPolicy = args['replanPolicy'] as
        | 'never'
        | 'on-description-change'
        | 'always'
        | undefined;
      const maxExecutions = args['maxExecutions'] as number | undefined;
      const status = args['status'] as 'active' | 'paused' | undefined;

      if (
        !schedule &&
        !replanPolicy &&
        maxExecutions === undefined &&
        !status
      ) {
        return {
          ok: false,
          error:
            'At least one of schedule, replanPolicy, maxExecutions, or status must be provided.',
        };
      }

      const input: UpdateTaskScheduleInput = {};
      if (schedule) {
        const built = buildScheduleInput(schedule);
        if (!built.ok) {
          return { ok: false, error: built.error };
        }
        input.schedule = built.value;
      }
      if (replanPolicy !== undefined) input.replanPolicy = replanPolicy;
      if (maxExecutions !== undefined) input.maxExecutions = maxExecutions;
      if (status !== undefined) input.status = status;

      try {
        const result = await service.updateSchedule(taskId, input);
        if (!result.ok) {
          return { ok: false, error: result.error.message };
        }
        const s = result.data;
        return {
          ok: true,
          content:
            `Schedule updated.\n\n` +
            `ID: ${s.id}\n` +
            `Schedule: ${s.scheduleHuman}\n` +
            `Status: ${s.status}\n` +
            `Replan policy: ${s.replanPolicy}\n` +
            `Max executions: ${s.maxExecutions}\n` +
            `Next run: ${s.nextRunAt}`,
        };
      } catch (err) {
        return {
          ok: false,
          error: `Failed to update task schedule: ${
            err instanceof Error ? err.message : String(err)
          }`,
        };
      }
    },
  };
}
