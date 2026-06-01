import type { BuiltinTool } from '@openaidy/runtime';
import { jobsUpdateMeta } from '../catalog.js';
import type { PulseToolDeps } from './types.js';
import type { UpdatePulseInput } from '@openaidy/shared-types';

export function createPulsesUpdateTool(deps: PulseToolDeps): BuiltinTool {
  return {
    name: jobsUpdateMeta.name,
    description: jobsUpdateMeta.description,
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The ID of the pulse to update.',
        },
        name: {
          type: 'string',
          description: 'New name for the pulse.',
        },
        prompt: {
          type: 'string',
          description: 'New prompt/message for the pulse.',
        },
        schedule: {
          type: 'object',
          description: 'New schedule. One of: every, daily, cron, at.',
          properties: {
            every: {
              type: 'string',
              enum: ['15m', '30m', '1h', '6h', '12h', '1d', '1w'],
            },
            daily: {
              type: 'object',
              description:
                'Fire once daily at a specific time (hour: 0-23, minute: 0-59).',
              properties: {
                hour: { type: 'number', description: 'Hour of day (0-23).' },
                minute: {
                  type: 'number',
                  description: 'Minute of hour (0-59).',
                },
              },
            },
            cron: {
              type: 'object',
              properties: {
                expression: { type: 'string' },
                tz: { type: 'string' },
              },
            },
            at: {
              type: 'string',
            },
          },
        },
        status: {
          type: 'string',
          enum: ['active', 'paused'],
          description: 'New status for the pulse.',
        },
        agentId: {
          type: 'string',
          description: 'New agent ID for the pulse.',
        },
      },
      required: ['id'],
    },

    async execute(args, _ctx) {
      const service = deps.getPulseService();

      if (!service) {
        return {
          ok: false,
          error: 'Database is not available.',
        };
      }

      const id = args['id'] as string;
      if (!id?.trim()) {
        return { ok: false, error: 'Pulse ID is required.' };
      }

      // Build UpdatePulseInput from args
      let scheduleInput:
        | import('@openaidy/shared-types').ScheduleInput
        | undefined;
      const schedule = args['schedule'] as Record<string, unknown> | undefined;
      if (schedule) {
        if (schedule['every']) {
          scheduleInput = {
            every: schedule['every'] as
              | '15m'
              | '30m'
              | '1h'
              | '6h'
              | '12h'
              | '1d'
              | '1w',
          };
        } else if (schedule['daily']) {
          const daily = schedule['daily'] as { hour: number; minute: number };
          scheduleInput = { daily: { hour: daily.hour, minute: daily.minute } };
        } else if (schedule['cron']) {
          const cronObj = schedule['cron'] as {
            expression: string;
            tz?: string;
          };
          scheduleInput = {
            cron: cronObj['expression'],
            ...(cronObj['tz'] ? { tz: cronObj['tz'] } : {}),
          };
        } else if (schedule['at']) {
          scheduleInput = { at: schedule['at'] as string };
        } else {
          return { ok: false, error: 'Invalid schedule format.' };
        }
      }

      try {
        const input: UpdatePulseInput = {};
        const name = args['name'] as string | undefined;
        const prompt = args['prompt'] as string | undefined;
        const status = args['status'] as 'active' | 'paused' | undefined;

        if (name !== undefined) input.name = name;
        if (prompt !== undefined) input.prompt = prompt;
        if (scheduleInput !== undefined) input.schedule = scheduleInput;
        if (status !== undefined) input.status = status;

        const pulse = await service.updatePulse(id, input);

        return {
          ok: true,
          content: `Successfully updated pulse "${pulse.name}".\n\nID: ${pulse.id}\nSchedule: ${pulse.scheduleHuman}\nStatus: ${pulse.status}\nNext run: ${pulse.nextRunAt.toISOString()}`,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === 'Pulse not found') {
          return { ok: false, error: `Pulse "${id}" not found.` };
        }
        return {
          ok: false,
          error: `Failed to update pulse: ${msg}`,
        };
      }
    },
  };
}
