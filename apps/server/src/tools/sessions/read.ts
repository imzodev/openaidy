import type { BuiltinTool } from '@openaidy/runtime';
import type { SessionsToolDeps } from './index.js';

export function createSessionsReadTool(deps: SessionsToolDeps): BuiltinTool {
  return {
    name: 'sessions_read',
    description:
      'Read the full state of a session: its metadata, messages, and runs with their statuses. ' +
      'Use this to check the progress of a session after dispatching a message with sessions_send. ' +
      'Runs show the execution lifecycle: queued → running → succeeded / failed.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'The session ID to read.',
        },
      },
      required: ['sessionId'],
    },

    async execute(args, _ctx) {
      const sessionId = args['sessionId'];

      if (typeof sessionId !== 'string' || !sessionId.trim()) {
        return {
          ok: false,
          error: 'sessionId is required and must be a non-empty string',
        };
      }

      try {
        const sessionService = deps.getSessionService();
        const session = await sessionService.getSession(sessionId.trim());

        if (!session) {
          return {
            ok: false,
            error: `Session "${sessionId}" not found. Use sessions_list to see available sessions.`,
          };
        }

        const s = session as Record<string, unknown>;

        const messages = await sessionService.listMessages(sessionId.trim());
        const runs = await sessionService.listRuns(sessionId.trim());

        const messageItems = messages.map((m) => {
          const r = m as Record<string, unknown>;
          return {
            role: r['role'],
            content:
              typeof r['content'] === 'string' && r['content'].length > 500
                ? r['content'].slice(0, 500) + '...'
                : r['content'],
            createdAt: r['createdAt'] ?? null,
          };
        });

        const runItems = runs.map((r) => {
          const rec = r as Record<string, unknown>;
          return {
            id: rec['id'],
            agentId: rec['agentId'],
            status: rec['status'],
            finishReason: rec['finishReason'] ?? null,
            errorCode: rec['errorCode'] ?? null,
            errorMessage: rec['errorMessage'] ?? null,
            createdAt: rec['createdAt'] ?? null,
          };
        });

        const result = {
          id: s['id'],
          title: s['title'],
          createdAt: s['createdAt'] ?? null,
          messageCount: messageItems.length,
          messages: messageItems,
          runCount: runItems.length,
          runs: runItems,
        };

        return {
          ok: true,
          content: JSON.stringify(result, null, 2),
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
