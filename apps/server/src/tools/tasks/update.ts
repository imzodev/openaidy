import type { BuiltinTool } from '@openaidy/runtime';
import type { TaskService } from '../../tasks/service';
import type { PlanningService } from '../../planning';
import { tasksUpdateMeta } from '../catalog.js';

export function createTasksUpdateTool(
  getTaskService: () => TaskService | undefined,
  getPlanningService?: () => PlanningService | undefined,
): BuiltinTool {
  return {
    name: tasksUpdateMeta.name,
    description: tasksUpdateMeta.description,
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The ID of the task to update.',
        },
        title: {
          type: 'string',
          description: 'New title for the task.',
        },
        description: {
          type: 'string',
          description: 'New description for the task.',
        },
        priority: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'urgent'],
          description: 'New priority level for the task.',
        },
        status: {
          type: 'string',
          enum: [
            'backlog',
            'todo',
            'in_progress',
            'review',
            'done',
            'cancelled',
          ],
          description:
            'New status for the task (moves it on the Kanban board).',
        },
        planningEnabled: {
          type: 'boolean',
          description:
            'Whether to enable automatic AI planning/decomposition of the task into subtasks.',
        },
      },
      required: ['id'],
    },

    async execute(args, _ctx) {
      const taskService = getTaskService();
      if (!taskService) {
        return {
          ok: false,
          error: 'Task service is not available (database might be disabled).',
        };
      }

      const planningService = getPlanningService?.();

      const id = args['id'];
      const title = args['title'];
      const description = args['description'];
      const priority = args['priority'];
      const status = args['status'];
      const planningEnabled = args['planningEnabled'];

      if (typeof id !== 'string' || !id.trim()) {
        return {
          ok: false,
          error: 'id is required and must be a non-empty string',
        };
      }

      try {
        if (typeof status === 'string') {
          const statusResult = await taskService.updateTaskStatus(
            id,
            status as
              | 'backlog'
              | 'todo'
              | 'in_progress'
              | 'review'
              | 'done'
              | 'cancelled',
          );
          if (!statusResult.ok) {
            return { ok: false, error: statusResult.error.message };
          }
        }

        const updateInput: {
          title?: string;
          description?: string;
          priority?: 'low' | 'medium' | 'high' | 'urgent';
          planningEnabled?: boolean;
        } = {};
        let shouldReplan = false;

        if (typeof title === 'string' && title.trim()) {
          updateInput.title = title;
          shouldReplan = true;
        }
        if (typeof description === 'string' && description.trim()) {
          updateInput.description = description;
          shouldReplan = true;
        }
        if (typeof priority === 'string') {
          updateInput.priority = priority as
            | 'low'
            | 'medium'
            | 'high'
            | 'urgent';
        }
        if (typeof planningEnabled === 'boolean') {
          updateInput.planningEnabled = planningEnabled;
        }

        if (Object.keys(updateInput).length > 0) {
          const updateResult = await taskService.updateTask(id, updateInput);
          if (!updateResult.ok) {
            return { ok: false, error: updateResult.error.message };
          }
        }

        if (planningService && shouldReplan) {
          const subtasks = await taskService.getSubtasks(id);
          if (subtasks.length > 0) {
            await planningService.planTask(id);
          }
        }

        const task = await taskService.getTask(id);
        if (!task) {
          return { ok: false, error: `Task "${id}" not found` };
        }

        return {
          ok: true,
          content: `Task updated successfully!\n\nID: ${task.id}\nTitle: ${task.title}\nDescription: ${task.description}\nStatus: ${task.status}\nPriority: ${task.priority ?? 'medium'}`,
        };
      } catch (err) {
        return {
          ok: false,
          error: `Unexpected error updating task: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
}
