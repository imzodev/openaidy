import type { BuiltinTool } from '@openaidy/runtime';
import type { TaskService } from '../../../tasks/service';
import {
  formatToolError,
  requireService,
  requireString,
} from '../../shared.js';
import { workflowNodeDeleteMeta } from '../../catalog.js';
import { assertWorkflow } from '../assert-workflow.js';

/**
 * workflow_node_delete
 *
 * Removes a single node from a workflow. Incoming and outgoing edges
 * cascade away with it (subtask_edges has `ON DELETE CASCADE` against
 * subtasks.id), so the agent does not need to clean edges up first.
 *
 * Requires confirm=true to match the workflow_delete safety pattern.
 * Refuses nodes whose parent task is not a workflow.
 */
export function createWorkflowNodeDeleteTool(
  getTaskService: () => TaskService | undefined,
): BuiltinTool {
  return {
    name: workflowNodeDeleteMeta.name,
    description: workflowNodeDeleteMeta.description,
    parameters: {
      type: 'object',
      properties: {
        nodeId: {
          type: 'string',
          description: 'ID of the workflow node to delete.',
        },
        confirm: {
          type: 'boolean',
          description:
            'Must be true to confirm deletion. Safety check against ' +
            'accidentally removing a node mid-execution.',
        },
      },
      required: ['nodeId', 'confirm'],
    },

    async execute(args, _ctx) {
      const resolved = requireService(getTaskService, 'Task service');
      if (!resolved.ok) return resolved;
      const taskService = resolved.service;

      const nodeIdError = requireString(args['nodeId'], 'nodeId');
      if (nodeIdError) return { ok: false, error: nodeIdError };
      const nodeId = args['nodeId'] as string;

      if (args['confirm'] !== true) {
        return {
          ok: false,
          error: 'confirm must be set to true to delete the workflow node',
        };
      }

      try {
        const existingNode = await taskService.getSubtask(nodeId);
        if (!existingNode) {
          return { ok: false, error: `Workflow node "${nodeId}" not found` };
        }
        const parent = await taskService.getTask(existingNode.taskId);
        if (!parent) {
          return {
            ok: false,
            error: `Workflow "${existingNode.taskId}" not found`,
          };
        }
        const workflowCheck = assertWorkflow(parent);
        if (!workflowCheck.ok) return workflowCheck;

        const result = await taskService.deleteSubtask(nodeId);
        if (!result.ok) {
          return { ok: false, error: result.error.message };
        }

        return {
          ok: true,
          content: `Workflow node "${nodeId}" deleted (edges cascaded).`,
        };
      } catch (err) {
        return formatToolError('Unexpected error deleting workflow node', err);
      }
    },
  };
}
