import type { BuiltinTool } from '@openaidy/runtime';
import type { TaskService } from '../../tasks/service';
import { tasksCreateMeta } from '../catalog.js';

export function createTasksCreateTool(
  getTaskService: () => TaskService | undefined,
): BuiltinTool {
  return {
    name: tasksCreateMeta.name,
    description: tasksCreateMeta.description,
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description:
            'Short title of the task. If not provided, it will be derived from the description.',
        },
        description: {
          type: 'string',
          description: 'Detailed description of what the task involves.',
        },
        priority: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'urgent'],
          description: 'Priority level of the task. Defaults to medium.',
        },
        planningEnabled: {
          type: 'boolean',
          description:
            'Whether to enable automatic AI planning/decomposition of the task into subtasks.',
        },
      },
      required: ['description'],
    },

    async execute(args, _ctx) {
      const taskService = getTaskService();
      if (!taskService) {
        return {
          ok: false,
          error: 'Task service is not available (database might be disabled).',
        };
      }

      const description = args['description'];
      const title = args['title'];
      const priority = args['priority'];
      const planningEnabled = args['planningEnabled'];

      if (typeof description !== 'string' || !description.trim()) {
        return {
          ok: false,
          error: 'description is required and must be a non-empty string',
        };
      }

      if (title !== undefined && (typeof title !== 'string' || !title.trim())) {
        return {
          ok: false,
          error: 'title must be a non-empty string if provided',
        };
      }

      try {
        const result = await taskService.createTask({
          title:
            title ??
            (description.length > 60
              ? `${description.slice(0, 60).trimEnd()}…`
              : description),
          description,
          priority: priority as 'low' | 'medium' | 'high' | 'urgent',
          planningEnabled: planningEnabled === true,
        });

        if (result.ok) {
          return {
            ok: true,
            content: `Task created successfully!\n\nID: ${result.data.id}\nTitle: ${result.data.title}\nDescription: ${result.data.description}\nStatus: ${result.data.status}\nPriority: ${result.data.priority ?? 'medium'}`,
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
          error: `Unexpected error creating task: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
}
