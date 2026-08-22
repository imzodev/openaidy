import type { BuiltinTool } from '@openaidy/runtime';
import type { TaskService } from '../../tasks/service';
import { formatToolError, requireService, requireString } from '../shared.js';
import { workflowUpdateMeta } from '../catalog.js';
import { assertWorkflow } from './assert-workflow.js';

const ALLOWED_STATUS = [
  'backlog',
  'todo',
  'in_progress',
  'review',
  'done',
  'cancelled',
] as const;

const ALLOWED_PRIORITY = ['low', 'medium', 'high', 'urgent'] as const;

/**
 * workflow_update
 *
 * Updates the workflow's own metadata (title, description, priority,
 * status). Subtask graph edits go through the node/edge tools. The
 * `planningEnabled` toggle is intentionally NOT exposed here — workflows
 * always have planning; if a caller wants to demote a workflow to a
 * regular task they should use the generic tasks_update.
 */
export function createWorkflowUpdateTool(
  getTaskService: () => TaskService | undefined,
): BuiltinTool {
  return {
    name: workflowUpdateMeta.name,
    description: workflowUpdateMeta.description,
    parameters: {
      type: 'object',
      properties: {
        workflowId: {
          type: 'string',
          description: 'ID of the workflow to update.',
        },
        title: {
          type: 'string',
          description: 'New title for the workflow.',
        },
        description: {
          type: 'string',
          description: 'New description for the workflow.',
        },
        priority: {
          type: 'string',
          enum: [...ALLOWED_PRIORITY],
          description: 'New priority level.',
        },
        status: {
          type: 'string',
          enum: [...ALLOWED_STATUS],
          description: 'New status (moves the workflow on the Kanban board).',
        },
      },
      required: ['workflowId'],
    },

    async execute(args, _ctx) {
      const resolved = requireService(getTaskService, 'Task service');
      if (!resolved.ok) return resolved;
      const taskService = resolved.service;

      const idError = requireString(args['workflowId'], 'workflowId');
      if (idError) return { ok: false, error: idError };
      const workflowId = args['workflowId'] as string;

      const title = args['title'];
      const description = args['description'];
      const priority = args['priority'];
      const status = args['status'];

      if (
        title === undefined &&
        description === undefined &&
        priority === undefined &&
        status === undefined
      ) {
        return {
          ok: false,
          error:
            'No fields to update. Provide at least one of: title, description, priority, status.',
        };
      }

      const titleError =
        title === undefined ? null : requireString(title, 'title');
      if (titleError) return { ok: false, error: titleError };
      const descriptionError =
        description === undefined
          ? null
          : requireString(description, 'description');
      if (descriptionError) return { ok: false, error: descriptionError };

      if (
        priority !== undefined &&
        !ALLOWED_PRIORITY.includes(
          priority as (typeof ALLOWED_PRIORITY)[number],
        )
      ) {
        return {
          ok: false,
          error: `priority must be one of: ${ALLOWED_PRIORITY.join(', ')}`,
        };
      }
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
        const existing = await taskService.getTask(workflowId);
        if (!existing) {
          return { ok: false, error: `Workflow "${workflowId}" not found` };
        }
        const workflowCheck = assertWorkflow(existing);
        if (!workflowCheck.ok) return workflowCheck;

        if (typeof status === 'string') {
          const statusResult = await taskService.updateTaskStatus(
            workflowId,
            status as (typeof ALLOWED_STATUS)[number],
          );
          if (!statusResult.ok) {
            return { ok: false, error: statusResult.error.message };
          }
        }

        const updateInput: {
          title?: string;
          description?: string;
          priority?: (typeof ALLOWED_PRIORITY)[number];
        } = {};
        if (typeof title === 'string' && title.trim()) {
          updateInput.title = title;
        }
        if (typeof description === 'string' && description.trim()) {
          updateInput.description = description;
        }
        if (typeof priority === 'string') {
          updateInput.priority = priority as (typeof ALLOWED_PRIORITY)[number];
        }

        if (Object.keys(updateInput).length > 0) {
          const updateResult = await taskService.updateTask(
            workflowId,
            updateInput,
          );
          if (!updateResult.ok) {
            return { ok: false, error: updateResult.error.message };
          }
        }

        const task = await taskService.getTask(workflowId);
        if (!task) {
          return { ok: false, error: `Workflow "${workflowId}" not found` };
        }

        return {
          ok: true,
          content: `Workflow updated successfully!\n\nID: ${task.id}\nTitle: ${task.title}\nDescription: ${task.description}\nStatus: ${task.status}\nPriority: ${task.priority ?? 'medium'}`,
        };
      } catch (err) {
        return formatToolError('Unexpected error updating workflow', err);
      }
    },
  };
}
