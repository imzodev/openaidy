import type { BuiltinTool } from '@openaidy/runtime';
import { jobsDeleteMeta } from '../catalog.js';
import type { PulseToolDeps } from './types.js';

export function createPulsesDeleteTool(deps: PulseToolDeps): BuiltinTool {
  return {
    name: jobsDeleteMeta.name,
    description: jobsDeleteMeta.description,
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The ID of the pulse to delete.',
        },
        confirm: {
          type: 'boolean',
          description: 'Must be true to confirm deletion.',
        },
      },
      required: ['id', 'confirm'],
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
      const confirm = args['confirm'] as boolean;

      if (!id?.trim()) {
        return { ok: false, error: 'Pulse ID is required.' };
      }

      if (!confirm) {
        return {
          ok: false,
          error: 'Deletion not confirmed. Pass confirm=true to delete.',
        };
      }

      // Check pulse exists and is actually a pulse
      const existingJob = await jobsRepo.findById(id);
      if (!existingJob) {
        return { ok: false, error: `Pulse "${id}" not found.` };
      }

      const metadata = existingJob.metadata as Record<string, unknown> | null;
      if (metadata?.kind !== 'pulse') {
        return { ok: false, error: `Job "${id}" is not a pulse.` };
      }

      try {
        await jobsRepo.delete(id);
        return {
          ok: true,
          content: `Successfully deleted pulse "${metadata['name'] as string}" (ID: ${id}).`,
        };
      } catch (err) {
        return {
          ok: false,
          error: `Failed to delete pulse: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
}
