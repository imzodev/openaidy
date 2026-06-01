import type { BuiltinTool } from '@openaidy/runtime';
import { jobsCreateMeta } from '../catalog.js';
import type { PulseToolDeps } from './types.js';
import type { CreatePulseInput } from '@openaidy/shared-types';

export function createPulsesCreateTool(deps: PulseToolDeps): BuiltinTool {
  return {
    name: jobsCreateMeta.name,
    description: jobsCreateMeta.description,
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'A human-readable name for the pulse.',
        },
        prompt: {
          type: 'string',
          description: 'The prompt/message to send when the pulse fires.',
        },
        schedule: {
          type: 'object',
          description:
            'When and how often to fire. One of: every, daily, cron, at.',
          properties: {
            every: {
              type: 'string',
              enum: ['15m', '30m', '1h', '6h', '12h', '1d', '1w'],
              description: 'Fire at regular intervals.',
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
              description: 'Fire using a cron expression.',
              properties: {
                expression: { type: 'string' },
                tz: { type: 'string' },
              },
            },
            at: {
              type: 'string',
              description: 'Fire once at a specific ISO datetime.',
            },
          },
        },
        agentId: {
          type: 'string',
          description:
            'Agent ID to use for this pulse (optional, uses default agent if not set).',
        },
        sessionId: {
          type: 'string',
          description: 'Session ID to pin the pulse to (optional).',
        },
      },
      required: ['name', 'prompt', 'schedule'],
    },

    async execute(args, _ctx) {
      const service = deps.getPulseService();

      if (!service) {
        return {
          ok: false,
          error: 'Database is not available.',
        };
      }

      const name = args['name'] as string;
      const prompt = args['prompt'] as string;
      const schedule = args['schedule'] as Record<string, unknown>;
      const agentId = args['agentId'] as string | undefined;
      const sessionId = args['sessionId'] as string | undefined;

      if (!name?.trim()) {
        return { ok: false, error: 'Pulse name is required.' };
      }
      if (!prompt?.trim()) {
        return { ok: false, error: 'Pulse prompt is required.' };
      }

      // Build ScheduleInput discriminated union from tool args
      let scheduleInput: import('@openaidy/shared-types').ScheduleInput;
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

      try {
        const input: CreatePulseInput = {
          name: name.trim(),
          prompt,
          schedule: scheduleInput,
        };
        if (agentId !== undefined) input.agentId = agentId;
        if (sessionId !== undefined) input.sessionId = sessionId;

        const pulse = await service.createPulse(input);

        return {
          ok: true,
          content: `Successfully created pulse "${pulse.name}" (ID: ${pulse.id}).\n\nSchedule: ${pulse.scheduleHuman}\nNext run: ${pulse.nextRunAt.toISOString()}\nStatus: ${pulse.status}`,
        };
      } catch (err) {
        return {
          ok: false,
          error: `Failed to create pulse: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
}
