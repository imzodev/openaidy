import type { BuiltinTool } from '@openaidy/runtime';
import type { SessionsToolDeps } from './index.js';
import { sessionsCreateMeta } from '../catalog.js';

export function createSessionsCreateTool(deps: SessionsToolDeps): BuiltinTool {
  return {
    name: sessionsCreateMeta.name,
    description: sessionsCreateMeta.description,
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description:
            'Human-readable title for the session (e.g. "Research on quantum computing").',
        },
      },
      required: ['title'],
    },

    async execute(args, _ctx) {
      const title = args['title'];

      if (typeof title !== 'string' || !title.trim()) {
        return {
          ok: false,
          error: 'title is required and must be a non-empty string',
        };
      }

      try {
        const sessionService = deps.getSessionService();
        const session = await sessionService.createSession(title.trim());
        return {
          ok: true,
          content: JSON.stringify(
            {
              id: session.id,
              title: session.title,
              createdAt:
                'createdAt' in session
                  ? (session as Record<string, unknown>).createdAt
                  : null,
            },
            null,
            2,
          ),
        };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}
