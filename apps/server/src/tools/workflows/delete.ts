import type { BuiltinTool } from '@openaidy/runtime';
import type { TaskService } from '../../tasks/service';
import { formatToolError, requireService, requireString } from '../shared.js';
import { workflowDeleteMeta } from '../catalog.js';
import { assertWorkflow } from './assert-workflow.js';

/**
 * workflow_delete
 *
 * Deletes a workflow and — via FK ON DELETE CASCADE — every subtask and
 * edge that belongs to it. Requires confirm=true (matches task_delete) so
 * an LLM cannot blow away a graph by accident. Refuses non-workflow tasks
 * so the agent has to use the more specific tool for the action it wants.
 */
export function createWorkflowDeleteTool(
  getTaskService: () => TaskService | undefined,
): BuiltinTool {
  return {
    name: workflowDeleteMeta.name,
    description: workflowDeleteMeta.description,
    parameters: {
      type: 'object',
      properties: {
        workflowId: {
          type: 'string',
          description: 'ID of the workflow to delete.',
        },
        confirm: {
          type: 'boolean',
          description:
            'Must be set to true to confirm the deletion. Safety check ' +
            'against accidental destruction of a subtask graph.',
        },
      },
      required: ['workflowId', 'confirm'],
    },

    async execute(args, _ctx) {
      const resolved = requireService(getTaskService, 'Task service');
      if (!resolved.ok) return resolved;
      const taskService = resolved.service;

      const idError = requireString(args['workflowId'], 'workflowId');
      if (idError) return { ok: false, error: idError };
      const workflowId = args['workflowId'] as string;

      if (args['confirm'] !== true) {
        return {
          ok: false,
          error: 'confirm must be set to true to delete the workflow',
        };
      }

      try {
        const existing = await taskService.getTask(workflowId);
        if (!existing) {
          return { ok: false, error: `Workflow "${workflowId}" not found` };
        }
        const workflowCheck = assertWorkflow(existing);
        if (!workflowCheck.ok) return workflowCheck;

        const result = await taskService.deleteTask(workflowId);
        if (!result.ok) {
          return { ok: false, error: result.error.message };
        }

        return {
          ok: true,
          content: `Workflow "${workflowId}" deleted successfully (subtasks and edges cascaded).`,
        };
      } catch (err) {
        return formatToolError('Unexpected error deleting workflow', err);
      }
    },
  };
}
