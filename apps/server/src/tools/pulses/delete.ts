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
      const service = deps.getPulseService();

      if (!service) {
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

      try {
        await service.deletePulse(id);
        return {
          ok: true,
          content: `Successfully deleted pulse "${id}".`,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === 'Pulse not found') {
          return { ok: false, error: `Pulse "${id}" not found.` };
        }
        return {
          ok: false,
          error: `Failed to delete pulse: ${msg}`,
        };
      }
    },
  };
}
