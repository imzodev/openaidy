import type { BuiltinTool } from '@openaidy/runtime';
import type { TaskService } from '../../tasks/service';
import { tasksDeleteMeta } from '../catalog.js';
import { formatToolError, requireService, requireString } from '../shared.js';

export function createTasksDeleteTool(
  getTaskService: () => TaskService | undefined,
): BuiltinTool {
  return {
    name: tasksDeleteMeta.name,
    description: tasksDeleteMeta.description,
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The ID of the task to delete.',
        },
        confirm: {
          type: 'boolean',
          description:
            'Must be set to true to confirm the deletion. This is a safety measure to prevent accidental deletions.',
        },
      },
      required: ['id', 'confirm'],
    },

    async execute(args, _ctx) {
      const resolved = requireService(getTaskService, 'Task service');
      if (!resolved.ok) return resolved;
      const taskService = resolved.service;

      const id = args['id'];
      const confirm = args['confirm'];

      const idError = requireString(id, 'id');
      if (idError) {
        return { ok: false, error: idError };
      }

      if (confirm !== true) {
        return {
          ok: false,
          error: 'confirm must be set to true to delete the task',
        };
      }

      try {
        const result = await taskService.deleteTask(id as string);

        if (result.ok) {
          return {
            ok: true,
            content: `Task "${id}" deleted successfully.`,
          };
        } else {
          return {
            ok: false,
            error: result.error.message,
          };
        }
      } catch (err) {
        return formatToolError('Unexpected error deleting task', err);
      }
    },
  };
}
