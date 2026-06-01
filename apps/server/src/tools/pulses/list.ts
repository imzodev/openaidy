import type { BuiltinTool } from '@openaidy/runtime';
import { jobsListMeta } from '../catalog.js';
import type { PulseToolDeps } from './types.js';
import { jobToPulse } from '../../pulses/utils.js';

export function createPulsesListTool(deps: PulseToolDeps): BuiltinTool {
  return {
    name: jobsListMeta.name,
    description: jobsListMeta.description,
    parameters: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['active', 'paused', 'completed', 'failed'],
          description:
            'Filter pulses by status. If not provided, returns all pulses.',
        },
        limit: {
          type: 'number',
          description:
            'Maximum number of pulses to return (default: 50, max: 100).',
          default: 50,
        },
        offset: {
          type: 'number',
          description: 'Number of pulses to skip for pagination (default: 0).',
          default: 0,
        },
      },
      required: [],
    },

    async execute(args, _ctx) {
      const jobsRepo = deps.getJobsRepo();
      if (!jobsRepo) {
        return {
          ok: false,
          error: 'Database is not available.',
        };
      }

      const status = args['status'] as
        | 'active'
        | 'paused'
        | 'completed'
        | 'failed'
        | undefined;
      const limit = Math.min(Math.max(Number(args['limit']) || 50, 1), 100);
      const offset = Math.max(Number(args['offset']) || 0, 0);

      try {
        const allJobs = await jobsRepo.list({ limit: 1000 });

        // Filter to only pulses (metadata.kind === 'pulse')
        let pulses = allJobs.filter((job) => {
          const metadata = job.metadata as Record<string, unknown> | null;
          return metadata?.kind === 'pulse';
        });

        // Apply status filter
        if (status) {
          pulses = pulses.filter((job) => job.status === status);
        }

        const total = pulses.length;

        // Apply pagination
        const paginatedPulses = pulses.slice(offset, offset + limit);

        if (paginatedPulses.length === 0) {
          return {
            ok: true,
            content:
              total === 0
                ? 'No pulses found.'
                : `Found ${total} pulse(s), but none match the current page/filter.`,
          };
        }

        const pulseLines = paginatedPulses.map((job) => {
          const pulse = jobToPulse(job);
          return [
            `ID: ${pulse.id}`,
            `Name: ${pulse.name}`,
            `Status: ${pulse.status}`,
            `Schedule: ${pulse.scheduleHuman}`,
            `Next run: ${pulse.nextRunAt.toISOString()}`,
            pulse.lastRunAt
              ? `Last run: ${pulse.lastRunAt.toISOString()}`
              : null,
            pulse.agentId ? `Agent: ${pulse.agentId}` : null,
          ]
            .filter(Boolean)
            .join('\n');
        });

        const header = status ? `Pulses with status "${status}"` : 'All pulses';

        return {
          ok: true,
          content: `${header} (${total} total, showing ${paginatedPulses.length}):\n\n${pulseLines.join('\n\n---\n\n')}`,
        };
      } catch (err) {
        return {
          ok: false,
          error: `Unexpected error listing pulses: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
}
