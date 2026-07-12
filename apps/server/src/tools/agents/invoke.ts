import type { BuiltinTool } from '@openaidy/runtime';
import type { AgentToolsDeps } from './index.js';
import { agentsInvokeMeta, agentsInvokeAwaitMeta } from '../catalog.js';

export function createAgentsInvokeTool(deps: AgentToolsDeps): BuiltinTool {
  return {
    name: agentsInvokeMeta.name,
    description: agentsInvokeMeta.description,
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

      if (!deps.getSessionService) {
        return {
          ok: false,
          error: 'Session service is not available. Cannot invoke agent.',
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

/**
 * Sleep helper for polling delays. Resolves early if `signal` aborts, so a
 * user "Stop" wakes the wait immediately instead of riding out the interval.
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

export function createAgentsInvokeAndWaitTool(
  deps: AgentToolsDeps,
): BuiltinTool {
  return {
    name: agentsInvokeAwaitMeta.name,
    description: agentsInvokeAwaitMeta.description,
    parameters: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description:
            'The agent ID to invoke. Use agents_list to discover available agents.',
        },
        content: {
          type: 'string',
          description: 'The message/prompt to send to the agent.',
        },
        sessionId: {
          type: 'string',
          description:
            'Optional. If provided, the message is sent to this existing session. ' +
            'If omitted, a new session is created automatically.',
        },
      },
      required: ['agentId', 'content'],
    },

    async execute(args, ctx) {
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

      if (!deps.getSessionService) {
        return {
          ok: false,
          error: 'Session service is not available. Cannot invoke agent.',
        };
      }

      const signal = ctx?.signal;
      const sessionService = deps.getSessionService();

      // Step 1: Dispatch the agent
      const dispatchResult = await sessionService.dispatchAgent({
        agentId: agentId.trim(),
        content: content.trim(),
        ...(sessionId ? { sessionId } : {}),
      });

      if (!dispatchResult.ok) {
        return { ok: false, error: dispatchResult.error };
      }

      const { sessionId: resolvedId } = dispatchResult;
      const created = sessionId ? '' : ' Created new session.';

      // Step 2: Poll for completion using listRuns (optimized)
      const MAX_WAIT_MS = 30000; // 30 seconds max
      const INITIAL_INTERVAL = 2000; // 2 seconds initial
      const MAX_INTERVAL = 6000; // 6 seconds max (backoff limit)

      let totalWaited = 0;
      let currentInterval = INITIAL_INTERVAL;

      try {
        while (totalWaited < MAX_WAIT_MS) {
          // User hit Stop — bail out of the local wait. The dispatched
          // sub-agent keeps running in its own session (its lifecycle is owned
          // by the sub-session, not this tool call) and stays inspectable via
          // sessions_read.
          if (signal?.aborted) {
            return {
              ok: false,
              error: 'Cancelled by user while waiting for agent response',
            };
          }

          // Check runs status using listRuns (lightweight, no full messages)
          const runs = await sessionService.listRuns(resolvedId);
          const lastRun = runs[runs.length - 1] as
            | { status: string; id: string; errorMessage?: string }
            | undefined;

          if (lastRun) {
            if (lastRun.status === 'succeeded') {
              // Agent completed successfully - now get full response
              const messages = await sessionService.listMessages(resolvedId);
              const assistantMessage = messages
                .slice()
                .reverse()
                .find((m) => (m as { role: string }).role === 'assistant');

              const assistantContent = assistantMessage
                ? (assistantMessage as { content: string }).content
                : '';

              return {
                ok: true,
                content: [
                  `Agent "${agentId.trim()}" completed successfully in session "${resolvedId}".${created}`,
                  '',
                  'Response:',
                  assistantContent || '(no response content)',
                ].join('\n'),
              };
            }

            if (lastRun.status === 'failed') {
              return {
                ok: false,
                error: `Agent "${agentId.trim()}" failed: ${lastRun.errorMessage || 'Unknown error'}`,
              };
            }

            // Status is 'running' or 'queued' - continue polling
          }

          // Wait with backoff (wakes immediately if the user cancels)
          await sleep(currentInterval, signal);
          totalWaited += currentInterval;

          // Exponential backoff: 2s -> 3s -> 4.5s -> 6s (capped)
          currentInterval = Math.min(
            currentInterval * 1.5,
            MAX_INTERVAL,
            MAX_WAIT_MS - totalWaited, // Don't exceed remaining time
          );
        }

        // Timeout reached
        return {
          ok: false,
          error:
            `Timeout waiting for agent "${agentId.trim()}" after ${MAX_WAIT_MS / 1000}s. ` +
            `Session "${resolvedId}" is still processing. ` +
            `Check later with: sessions_read(sessionId: "${resolvedId}")`,
        };
      } catch (err) {
        return {
          ok: false,
          error: `Error while waiting for agent: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
}
