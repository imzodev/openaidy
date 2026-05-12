import type { BuiltinTool } from '@openaidy/runtime';
import type { MemoryToolDeps } from './index.js';
import { memorySearchMeta } from '../catalog.js';

export function createMemorySearchTool(deps: MemoryToolDeps): BuiltinTool {
  return {
    name: memorySearchMeta.name,
    description: memorySearchMeta.description,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Keyword to search memories by. Uses FTS5/BM25 ranking — ' +
            'best match first. Supports exact phrases ("ABC project"), ' +
            'prefix matching (react*), and boolean operators (react AND fastapi).',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return. Default 10.',
        },
      },
      required: ['query'],
    },

    async execute(args, ctx) {
      const query = args['query'] as string;
      const limit = args['limit'] as number | undefined;

      if (typeof query !== 'string' || !query.trim()) {
        return {
          ok: false,
          error: 'query is required and must be a non-empty string',
        };
      }

      const isDefault = ctx.agentId === deps.defaultAgentId;
      const scopedAgentId = isDefault ? undefined : ctx.agentId;

      const results = await deps.memoriesRepo.search(
        query.trim(),
        scopedAgentId,
        limit ?? 10,
      );

      return { ok: true, content: JSON.stringify(results) };
    },
  };
}
