import type { BuiltinTool } from '@openaidy/runtime';
import type { TaskService } from '../../tasks/service';
import { tasksCreateMeta } from '../catalog.js';
import { formatToolError, requireService, requireString } from '../shared.js';

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
      const resolved = requireService(getTaskService, 'Task service');
      if (!resolved.ok) return resolved;
      const taskService = resolved.service;

      const description = args['description'];
      const title = args['title'];
      const priority = args['priority'];
      const planningEnabled = args['planningEnabled'];

      const descriptionError = requireString(description, 'description');
      if (descriptionError) {
        return { ok: false, error: descriptionError };
      }

      const titleError =
        title === undefined ? null : requireString(title, 'title');
      if (titleError) {
        return { ok: false, error: titleError };
      }

      try {
        const descriptionText = description as string;
        const titleText =
          typeof title === 'string'
            ? title
            : descriptionText.length > 60
              ? `${descriptionText.slice(0, 60).trimEnd()}…`
              : descriptionText;

        const createInput: Parameters<TaskService['createTask']>[0] = {
          title: titleText,
          description: descriptionText,
          planningEnabled: planningEnabled === true,
        };
        if (typeof priority === 'string') {
          createInput.priority = priority as
            | 'low'
            | 'medium'
            | 'high'
            | 'urgent';
        }

        const result = await taskService.createTask(createInput);

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
        return formatToolError('Unexpected error creating task', err);
      }
    },
  };
}
