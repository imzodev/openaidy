import type { BuiltinTool } from '@openaidy/runtime';
import type { SessionsToolDeps } from './index.js';

export function createSessionsSendTool(deps: SessionsToolDeps): BuiltinTool {
  return {
    name: 'sessions_send',
    description:
      'Send a message to a session, optionally specifying which agent should respond. ' +
      'This dispatches asynchronously — it returns immediately. ' +
      'Use sessions_read to check progress and retrieve the response later. ' +
      'The target agent runs its own tool-call loop independently. ' +
      'You can send to a session you created with sessions_create, or to any existing session. ' +
      'To orchestrate another agent: sessions_create a new session, then sessions_send to it with that agentId.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'The session ID to send the message to.',
        },
        content: {
          type: 'string',
          description: 'The message content to send.',
        },
        agentId: {
          type: 'string',
          description:
            'The agent ID that should respond to this message. ' +
            'If omitted, the default agent is used. ' +
            'Use agents_list to discover available agent IDs. ' +
            'You may specify your own agent ID to invoke yourself in a different session.',
        },
      },
      required: ['sessionId', 'content'],
    },

    async execute(args, _ctx) {
      const sessionId = args['sessionId'];
      const content = args['content'];
      const agentId =
        typeof args['agentId'] === 'string' && args['agentId'].trim()
          ? args['agentId'].trim()
          : undefined;

      if (typeof sessionId !== 'string' || !sessionId.trim()) {
        return {
          ok: false,
          error: 'sessionId is required and must be a non-empty string',
        };
      }
      if (typeof content !== 'string' || !content.trim()) {
        return {
          ok: false,
          error: 'content is required and must be a non-empty string',
        };
      }

      try {
        const sessionService = deps.getSessionService();

        const exists = await sessionService.getSession(sessionId.trim());
        if (!exists) {
          return {
            ok: false,
            error: `Session "${sessionId}" not found. Use sessions_create to create one, or sessions_list to see available sessions.`,
          };
        }

        // Fire-and-forget: dispatch asynchronously, don't await
        const dispatchPromise = agentId
          ? sessionService.submitMessageStreaming({
              sessionId: sessionId.trim(),
              role: 'user',
              content: content.trim(),
              agentId,
              onStreamEvent: () => {},
            })
          : sessionService.submitMessageStreaming({
              sessionId: sessionId.trim(),
              role: 'user',
              content: content.trim(),
              onStreamEvent: () => {},
            });
        void dispatchPromise.catch((_err: unknown) => {
          // Silently ignored — the run will show as failed via sessions_read
        });

        const agentInfo = agentId ? ` with agent "${agentId}"` : '';
        return {
          ok: true,
          content: [
            `Dispatched message to session "${sessionId}"${agentInfo}.`,
            '',
            'The agent will process this message in the background. To check progress:',
            `  sessions_read(sessionId: "${sessionId}")`,
            '',
            'The response will appear as a new message in the session. Check run statuses to see if the agent has finished (succeeded) or encountered an error (failed).',
          ].join('\n'),
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
