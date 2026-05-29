import type { BuiltinTool } from '@openaidy/runtime';
import type { TaskService } from '../../tasks/service';
import { tasksDeleteMeta } from '../catalog.js';

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
      const taskService = getTaskService();
      if (!taskService) {
        return {
          ok: false,
          error: 'Task service is not available (database might be disabled).',
        };
      }

      const id = args['id'];
      const confirm = args['confirm'];

      if (typeof id !== 'string' || !id.trim()) {
        return {
          ok: false,
          error: 'id is required and must be a non-empty string',
        };
      }

      if (confirm !== true) {
        return {
          ok: false,
          error: 'confirm must be set to true to delete the task',
        };
      }

      try {
        const result = await taskService.deleteTask(id);

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
        return {
          ok: false,
          error: `Unexpected error deleting task: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
}
