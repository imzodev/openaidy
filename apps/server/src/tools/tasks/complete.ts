import type { BuiltinTool } from '@openaidy/runtime';
import type { TasksToolDeps } from './index.js';
import { subtaskCompleteMeta } from '../catalog.js';

export function createSubtaskCompleteTool(deps: TasksToolDeps): BuiltinTool {
  return {
    name: subtaskCompleteMeta.name,
    description: subtaskCompleteMeta.description,
    parameters: {
      type: 'object',
      properties: {
        result: {
          type: 'string',
          description:
            'Optional summary of what was accomplished. If omitted, your last assistant message will be used as the result.',
        },
      },
      required: [],
    },

    async execute(args, ctx) {
      const result =
        typeof args['result'] === 'string' ? args['result'].trim() : undefined;

      try {
        const taskService = deps.getTaskService();
        const sessionId = ctx.sessionId;

        if (!sessionId) {
          return {
            ok: false,
            error:
              'No session ID available. This tool must be called from within a subtask session.',
          };
        }

        // Find subtask linked to this session
        const subtask = await taskService.getSubtaskBySessionId(sessionId);

        if (!subtask.ok) {
          return {
            ok: false,
            error: `No subtask found for this session: ${subtask.error?.message ?? 'Unknown error'}`,
          };
        }

        if (!subtask.data) {
          return {
            ok: false,
            error:
              'This session is not linked to any subtask. You may be in a regular chat session.',
          };
        }

        // Complete the subtask
        const completeResult = await taskService.completeSubtask(
          subtask.data.id,
          result ?? 'Completed',
        );

        if (!completeResult.ok) {
          return {
            ok: false,
            error: `Failed to complete subtask: ${completeResult.error?.message ?? 'Unknown error'}`,
          };
        }

        return {
          ok: true,
          content: `Subtask "${subtask.data.title}" marked as completed.`,
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
