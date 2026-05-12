import type { BuiltinTool } from '@openaidy/runtime';
import type { MemoryToolDeps } from './index.js';
import { memoryDeleteMeta } from '../catalog.js';

export function createMemoryDeleteTool(deps: MemoryToolDeps): BuiltinTool {
  return {
    name: memoryDeleteMeta.name,
    description: memoryDeleteMeta.description,
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description:
            'The ID of the memory to delete. Get the ID from memory_search or memory_save.',
        },
      },
      required: ['id'],
    },

    async execute(args, ctx) {
      const id = args['id'] as string;

      if (typeof id !== 'string' || !id.trim()) {
        return {
          ok: false,
          error: 'id is required and must be a non-empty string',
        };
      }

      const isDefault = ctx.agentId === deps.defaultAgentId;
      const scopedAgentId = isDefault ? undefined : ctx.agentId;

      const deleted = await deps.memoriesRepo.delete(id.trim(), scopedAgentId);

      if (deleted) {
        return { ok: true, content: 'Memory deleted.' };
      }
      return { ok: false, error: 'Memory not found or access denied.' };
    },
  };
}
