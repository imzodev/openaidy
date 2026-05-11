import type { BuiltinTool } from '@openaidy/runtime';
import type { SessionsToolDeps } from './index.js';
import { sessionsListMeta } from '../catalog.js';

export function createSessionsListTool(deps: SessionsToolDeps): BuiltinTool {
  return {
    name: sessionsListMeta.name,
    description: sessionsListMeta.description,
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },

    async execute(_args, _ctx) {
      try {
        const sessionService = deps.getSessionService();
        const sessions = await sessionService.listSessions();
        const items = sessions.map((s) => {
          const r = s as Record<string, unknown>;
          return {
            id: r['id'],
            title: r['title'],
            createdAt: r['createdAt'] ?? null,
          };
        });

        if (items.length === 0) {
          return { ok: true, content: 'No sessions found.' };
        }

        const lines = items.map(
          (s) =>
            `- id: "${s.id}"  title: "${s.title}"  createdAt: ${String(s.createdAt)}`,
        );
        return {
          ok: true,
          content: `${items.length} session(s):\n${lines.join('\n')}`,
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
