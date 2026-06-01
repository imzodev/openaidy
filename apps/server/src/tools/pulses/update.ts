import type { BuiltinTool } from '@openaidy/runtime';
import { jobsUpdateMeta } from '../catalog.js';
import type { PulseToolDeps } from './types.js';
import { parseScheduleInput, jobToPulse } from '../../pulses/utils.js';

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
      const jobsRepo = deps.getJobsRepo();

      if (!jobsRepo) {
        return {
          ok: false,
          error: 'Database is not available.',
        };
      }

      const id = args['id'] as string;
      const name = args['name'] as string | undefined;
      const prompt = args['prompt'] as string | undefined;
      const schedule = args['schedule'] as Record<string, unknown> | undefined;
      const status = args['status'] as 'active' | 'paused' | undefined;
      const _agentId = args['agentId'] as string | undefined;

      if (!id?.trim()) {
        return { ok: false, error: 'Pulse ID is required.' };
      }

      // Check pulse exists and is actually a pulse
      const existingJob = await jobsRepo.findById(id);
      if (!existingJob) {
        return { ok: false, error: `Pulse "${id}" not found.` };
      }

      const existingMetadata = existingJob.metadata as Record<
        string,
        unknown
      > | null;
      if (existingMetadata?.kind !== 'pulse') {
        return { ok: false, error: `Job "${id}" is not a pulse.` };
      }

      // Build updates
      const updates: {
        status?: 'active' | 'paused' | 'completed' | 'failed';
        metadata?: Record<string, unknown>;
        nextRunAt?: Date;
        cronExpression?: string;
        schedule?: Date;
      } = {};

      if (status) {
        updates.status = status;
      }

      if (name !== undefined || prompt !== undefined) {
        const newMetadata = { ...existingMetadata };
        if (name !== undefined) {
          newMetadata['name'] = name;
        }
        if (prompt !== undefined) {
          newMetadata['prompt'] = prompt;
        }
        updates.metadata = newMetadata;
      }

      // Handle schedule update
      if (schedule) {
        try {
          let parsedSchedule;
          if (schedule['every']) {
            parsedSchedule = parseScheduleInput({
              every: schedule['every'] as
                | '15m'
                | '30m'
                | '1h'
                | '6h'
                | '12h'
                | '1d'
                | '1w',
            });
          } else if (schedule['daily']) {
            const daily = schedule['daily'] as { hour: number; minute: number };
            parsedSchedule = parseScheduleInput({
              daily: { hour: daily.hour, minute: daily.minute },
            });
          } else if (schedule['cron']) {
            const cronObj = schedule['cron'] as {
              expression: string;
              tz?: string;
            };
            parsedSchedule = parseScheduleInput({
              cron: cronObj['expression'],
              ...(cronObj['tz'] ? { tz: cronObj['tz'] } : {}),
            });
          } else if (schedule['at']) {
            parsedSchedule = parseScheduleInput({
              at: schedule['at'] as string,
            });
          } else {
            return { ok: false, error: 'Invalid schedule format.' };
          }
          if (parsedSchedule.cronExpression !== undefined) {
            updates.cronExpression = parsedSchedule.cronExpression;
          }
          if (parsedSchedule.schedule !== undefined) {
            updates.schedule = parsedSchedule.schedule;
          }
          updates.nextRunAt = parsedSchedule.nextRunAt;
        } catch (err) {
          return {
            ok: false,
            error: `Invalid schedule: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      }

      try {
        const updatedJob = await jobsRepo.update(id, updates);
        const pulse = jobToPulse(updatedJob);

        return {
          ok: true,
          content: `Successfully updated pulse "${pulse.name}".\n\nID: ${pulse.id}\nSchedule: ${pulse.scheduleHuman}\nStatus: ${pulse.status}\nNext run: ${pulse.nextRunAt.toISOString()}`,
        };
      } catch (err) {
        return {
          ok: false,
          error: `Failed to update pulse: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
}
