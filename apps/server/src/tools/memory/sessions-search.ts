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
            'Keyword to search sessions by. Searches BOTH session titles AND message content. ' +
            'Uses FTS5 full-text search — best match first.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return. Default 5.',
        },
      },
      required: ['query'],
    },

    async execute(args, ctx) {
      const query = args['query'] as string;
      const limit = args['limit'] as number | undefined;
      const currentSessionId = ctx.sessionId;

      if (typeof query !== 'string' || !query.trim()) {
        return {
          ok: false,
          error: 'query is required and must be a non-empty string',
        };
      }

      log.info('sessions_search invoked', {
        query,
        limit: limit ?? 5,
        currentSessionId,
      });

      // Search by title first (faster, more specific)
      // Exclude current session so we don't find the session we're already in
      const byTitle = await deps.sessionsRepo.searchByTitle(
        query.trim(),
        limit ?? 5,
        currentSessionId,
      );

      // If title search found results, return those
      // Otherwise, fall back to message content search (Option A)
      // Option B (TODO): Use LLM-generated summaries for richer matching
      // Option C (TODO): Use embeddings-based vector similarity
      let sessions = byTitle;
      if (sessions.length === 0) {
        log.info(
          'sessions_search: no title matches, searching message content (Option A)',
        );
        sessions = await deps.sessionsRepo.searchByContent(
          query.trim(),
          limit ?? 5,
          currentSessionId,
        );
      }

      log.info('sessions_search completed', {
        query,
        found: sessions.length,
        byTitle: byTitle.length,
      });

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
