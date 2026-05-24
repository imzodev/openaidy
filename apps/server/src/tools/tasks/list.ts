import type { BuiltinTool } from '@openaidy/runtime';
import type { TaskService } from '../../tasks/service';
import { tasksListMeta } from '../catalog.js';

export function createTasksListTool(
  getTaskService: () => TaskService | undefined,
): BuiltinTool {
  return {
    name: tasksListMeta.name,
    description: tasksListMeta.description,
    parameters: {
      type: 'object',
      properties: {
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
            'Filter tasks by status. If not provided, returns all tasks.',
        },
      },
      required: [],
    },

    async execute(args, _ctx) {
      const taskService = getTaskService();
      if (!taskService) {
        return {
          ok: false,
          error: 'Task service is not available (database might be disabled).',
        };
      }

      const status = args['status'] as
        | 'backlog'
        | 'todo'
        | 'in_progress'
        | 'review'
        | 'done'
        | 'cancelled'
        | undefined;

      try {
        const tasks = await taskService.listTasks(status);

        if (tasks.length === 0) {
          return {
            ok: true,
            content: status
              ? `No tasks found with status "${status}".`
              : 'No tasks found.',
          };
        }

        const taskLines = tasks.map((task) => {
          const planningInfo = task.planningEnabled
            ? ` [Planning: ${task.planningStatus ?? 'pending'}]`
            : '';
          return `ID: ${task.id}\nTitle: ${task.title}\nStatus: ${task.status}\nPriority: ${task.priority ?? 'medium'}${planningInfo}`;
        });

        const header = status ? `Tasks with status "${status}"` : 'All tasks';

        return {
          ok: true,
          content: `${header} (${tasks.length}):\n\n${taskLines.join('\n\n')}`,
        };
      } catch (err) {
        return {
          ok: false,
          error: `Unexpected error listing tasks: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
}
