import type { BuiltinTool } from '@openaidy/runtime';
import type { SessionsToolDeps } from './index.js';

export function createSessionsCreateTool(deps: SessionsToolDeps): BuiltinTool {
  return {
    name: 'sessions_create',
    description:
      'Create a new session. A session is a conversation container that holds messages and runs. ' +
      'Use this to create a session that you (or another agent via sessions_send) can send messages to. ' +
      'Returns the session id, title, and creation timestamp.',
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
