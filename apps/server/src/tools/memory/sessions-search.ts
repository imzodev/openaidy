import type { BuiltinTool } from '@openaidy/runtime';
import type { MemoryToolDeps } from './index.js';
import { sessionsSearchMeta } from '../catalog.js';

export function createSessionsSearchTool(deps: MemoryToolDeps): BuiltinTool {
  const log = deps.createLogger('sessions_search');

  return {
    name: sessionsSearchMeta.name,
    description: sessionsSearchMeta.description,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Keyword to search session titles by. Uses FTS5 full-text search — ' +
            'best match first.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return. Default 5.',
        },
      },
      required: ['query'],
    },

    async execute(args) {
      const query = args['query'] as string;
      const limit = args['limit'] as number | undefined;

      if (typeof query !== 'string' || !query.trim()) {
        return {
          ok: false,
          error: 'query is required and must be a non-empty string',
        };
      }

      log.info('sessions_search invoked', { query, limit: limit ?? 5 });

      const sessions = await deps.sessionsRepo.searchByTitle(
        query.trim(),
        limit ?? 5,
      );

      log.info('sessions_search completed', { query, found: sessions.length });

      return {
        ok: true,
        content: JSON.stringify(
          sessions.map((s) => ({
            id: s.id,
            title: s.title,
            status: s.status,
            createdAt: s.createdAt,
          })),
        ),
      };
    },
  };
}
