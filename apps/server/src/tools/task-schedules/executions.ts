import type { BuiltinTool } from '@openaidy/runtime';
import { taskSchedulesListExecutionsMeta } from '../catalog.js';
import type { TaskScheduleToolDeps } from './types.js';
import type { TaskExecutionHistoryStatus } from '@openaidy/shared-types';

/**
 * List execution history for a task's schedule.
 *
 * Returns one row per run, newest first. Use the optional `status`
 * filter to focus on failed runs, currently-executing runs, etc.
 *
 * The history table is per-task (1:many), so `taskId` is required.
 */
export function createTaskSchedulesListExecutionsTool(
  deps: TaskScheduleToolDeps,
): BuiltinTool {
  return {
    name: taskSchedulesListExecutionsMeta.name,
    description: taskSchedulesListExecutionsMeta.description,
    parameters: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'The ID of the task whose execution history to list.',
        },
        status: {
          type: 'string',
          enum: [
            'planned',
            'planning',
            'executing',
            'verifying',
            'completed',
            'failed',
          ],
          description:
            'Filter by run status. If omitted, returns all runs for the task.',
        },
        limit: {
          type: 'number',
          description:
            'Maximum number of runs to return (default: 20, max: 100).',
          default: 20,
        },
        offset: {
          type: 'number',
          description: 'Number of runs to skip for pagination (default: 0).',
          default: 0,
        },
      },
      required: ['taskId'],
    },

    async execute(args, _ctx) {
      const service = deps.getTaskScheduleService();
      if (!service) {
        return {
          ok: false,
          error:
            'Task schedule service is not available (database might be disabled).',
        };
      }

      const taskId = args['taskId'] as string | undefined;
      if (!taskId?.trim()) {
        return { ok: false, error: 'taskId is required.' };
      }

      const status = args['status'] as TaskExecutionHistoryStatus | undefined;
      const limit = Math.min(Math.max(Number(args['limit']) || 20, 1), 100);
      const offset = Math.max(Number(args['offset']) || 0, 0);

      try {
        const result = await service.listExecutions(taskId, {
          ...(status !== undefined ? { status } : {}),
          limit,
          offset,
        });
        if (!result.ok) {
          return { ok: false, error: result.error.message };
        }

        const { items: executions, total } = result.data;
        if (executions.length === 0) {
          return {
            ok: true,
            content:
              total === 0
                ? `No execution history for task "${taskId}" yet.`
                : `Found ${total} run(s) but none match the current page/filter.`,
          };
        }

        const runLines = executions.map((e) => {
          const dur =
            e.durationMs !== null
              ? `${(e.durationMs / 1000).toFixed(1)}s`
              : 'in progress';
          const errLine =
            e.status === 'failed' && e.errorCode
              ? `\nError: [${e.errorCode}] ${e.errorMessage ?? ''}`
              : '';
          return [
            `ID: ${e.id}`,
            `Status: ${e.status}`,
            `Started: ${e.startedAt}`,
            `Duration: ${dur}`,
            `Replanned: ${e.didReplan ? 'yes' : 'no'}`,
            `Session: ${e.sessionId ?? 'none'}${errLine}`,
          ].join('\n');
        });

        const header = status
          ? `Executions of task "${taskId}" with status "${status}"`
          : `Executions of task "${taskId}"`;

        return {
          ok: true,
          content:
            `${header} (${total} total, showing ${executions.length}):\n\n` +
            runLines.join('\n\n---\n\n'),
        };
      } catch (err) {
        return {
          ok: false,
          error: `Unexpected error listing executions: ${
            err instanceof Error ? err.message : String(err)
          }`,
        };
      }
    },
  };
}
