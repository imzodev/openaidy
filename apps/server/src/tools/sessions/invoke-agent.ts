import type { BuiltinTool } from '@openaidy/runtime';
import type { SessionsToolDeps } from './index.js';

export function createAgentsInvokeTool(deps: SessionsToolDeps): BuiltinTool {
  return {
    name: 'agents_invoke',
    description:
      'Invoke an agent asynchronously. ' +
      'If no sessionId is provided, a new session is auto-created — ' +
      'you do NOT need to call sessions_create first. ' +
      'If a sessionId is provided, the message is sent to that existing session (useful for multi-turn conversations). ' +
      'Returns the sessionId immediately — the agent runs in the background. ' +
      'Use sessions_read to check progress and retrieve the response. ' +
      'Use agents_list to discover available agent IDs.',
    parameters: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description:
            'The agent ID to invoke. Use agents_list to discover available agents. ' +
            'You may invoke yourself if you want to run in a different session.',
        },
        content: {
          type: 'string',
          description: 'The message/prompt to send to the agent.',
        },
        sessionId: {
          type: 'string',
          description:
            'Optional. If provided, the message is sent to this existing session. ' +
            'If omitted, a new session is created automatically. ' +
            'Use an explicit sessionId for multi-turn conversations with the same agent.',
        },
      },
      required: ['agentId', 'content'],
    },

    async execute(args, _ctx) {
      const agentId = args['agentId'];
      const content = args['content'];
      const sessionId =
        typeof args['sessionId'] === 'string' && args['sessionId'].trim()
          ? args['sessionId'].trim()
          : undefined;

      if (typeof agentId !== 'string' || !agentId.trim()) {
        return {
          ok: false,
          error: 'agentId is required and must be a non-empty string',
        };
      }
      if (typeof content !== 'string' || !content.trim()) {
        return {
          ok: false,
          error: 'content is required and must be a non-empty string',
        };
      }

      const sessionService = deps.getSessionService();
      const result = await sessionService.dispatchAgent({
        agentId: agentId.trim(),
        content: content.trim(),
        ...(sessionId ? { sessionId } : {}),
      });

      if (!result.ok) {
        return { ok: false, error: result.error };
      }

      const { sessionId: resolvedId, done } = result;
      void done.catch((_err: unknown) => {
        // Silently ignored — the run will show as failed via sessions_read
      });

      const created = sessionId ? '' : ' Created new session.';
      return {
        ok: true,
        content: [
          `Dispatched to agent "${agentId.trim()}" in session "${resolvedId}".${created}`,
          '',
          'The agent will process this message in the background. To check progress:',
          `  sessions_read(sessionId: "${resolvedId}")`,
        ].join('\n'),
      };
    },
  };
}
