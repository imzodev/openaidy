import type { BuiltinTool } from '@openaidy/runtime';
import type { TaskService } from '../../tasks/service';
import { formatToolError, requireService } from '../shared.js';
import { workflowListMeta } from '../catalog.js';

const ALLOWED_STATUS = [
  'backlog',
  'todo',
  'in_progress',
  'review',
  'done',
  'cancelled',
] as const;

/**
 * workflow_list
 *
 * Returns every workflow (Task with planningEnabled=true) the agent has
 * access to. Used for discovery — agents should call this before
 * workflow_get on an id they haven't seen before, and before any
 * mutating call on an id they want to confirm still exists.
 *
 * The response is intentionally a summary (id, title, status, priority,
 * timestamps). For full graph state — nodes and edges — call
 * workflow_get with the returned id.
 */
export function createWorkflowListTool(
  getTaskService: () => TaskService | undefined,
): BuiltinTool {
  return {
    name: workflowListMeta.name,
    description: workflowListMeta.description,
    parameters: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: [...ALLOWED_STATUS],
          description:
            'Optional filter — only return workflows in this Kanban status.',
        },
        limit: {
          type: 'integer',
          description:
            'Maximum number of workflows to return. Defaults to 100. ' +
            'Capped at 500.',
        },
      },
    },

    async execute(args, _ctx) {
      const resolved = requireService(getTaskService, 'Task service');
      if (!resolved.ok) return resolved;
      const taskService = resolved.service;

      const status = args['status'];
      const limit =
        typeof args['limit'] === 'number' && args['limit'] > 0
          ? Math.min(args['limit'], 500)
          : 100;

      if (
        status !== undefined &&
        !ALLOWED_STATUS.includes(status as (typeof ALLOWED_STATUS)[number])
      ) {
        return {
          ok: false,
          error: `status must be one of: ${ALLOWED_STATUS.join(', ')}`,
        };
      }

      try {
        const allTasks = await taskService.listTasks(
          status as (typeof ALLOWED_STATUS)[number] | undefined,
        );

        const workflows = allTasks
          .filter((task) => task.planningEnabled === true)
          .slice(0, limit)
          .map((task) => ({
            id: task.id,
            title: task.title,
            description: task.description,
            status: task.status,
            priority: task.priority,
            createdAt: task.createdAt,
            updatedAt: task.updatedAt,
          }));

        return {
          ok: true,
          content: JSON.stringify(
            { count: workflows.length, workflows },
            null,
            2,
          ),
        };
      } catch (err) {
        return formatToolError('Failed to list workflows', err);
      }
    },
  };
}
