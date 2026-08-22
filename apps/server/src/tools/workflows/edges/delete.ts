import type { BuiltinTool } from '@openaidy/runtime';
import type { TaskService } from '../../../tasks/service';
import {
  formatToolError,
  requireService,
  requireString,
} from '../../shared.js';
import { workflowEdgeDeleteMeta } from '../../catalog.js';
import { assertWorkflow } from '../assert-workflow.js';

/**
 * workflow_edge_delete
 *
 * Removes a single edge from a workflow. The two endpoint nodes are
 * preserved (the agent can re-create the edge or wire a different one
 * in its place).
 *
 * Resolves the parent workflow via `subtaskId → taskId` to enforce the
 * workflow-only invariant. Refuses any edge whose source subtask does
 * not belong to a workflow.
 */
export function createWorkflowEdgeDeleteTool(
  getTaskService: () => TaskService | undefined,
): BuiltinTool {
  return {
    name: workflowEdgeDeleteMeta.name,
    description: workflowEdgeDeleteMeta.description,
    parameters: {
      type: 'object',
      properties: {
        edgeId: {
          type: 'string',
          description: 'ID of the workflow edge to delete.',
        },
        confirm: {
          type: 'boolean',
          description:
            'Must be true to confirm deletion. Safety check against ' +
            'accidentally severing a graph dependency.',
        },
      },
      required: ['edgeId', 'confirm'],
    },

    async execute(args, _ctx) {
      const resolved = requireService(getTaskService, 'Task service');
      if (!resolved.ok) return resolved;
      const taskService = resolved.service;

      const edgeIdError = requireString(args['edgeId'], 'edgeId');
      if (edgeIdError) return { ok: false, error: edgeIdError };
      const edgeId = args['edgeId'] as string;

      if (args['confirm'] !== true) {
        return {
          ok: false,
          error: 'confirm must be set to true to delete the workflow edge',
        };
      }

      try {
        const existingEdge = await taskService.getSubtaskEdge(edgeId);
        if (!existingEdge) {
          return { ok: false, error: `Workflow edge "${edgeId}" not found` };
        }
        const sourceSubtask = await taskService.getSubtask(
          existingEdge.subtaskId,
        );
        if (!sourceSubtask) {
          return {
            ok: false,
            error: `Subtask "${existingEdge.subtaskId}" not found`,
          };
        }
        const parent = await taskService.getTask(sourceSubtask.taskId);
        if (!parent) {
          return {
            ok: false,
            error: `Workflow "${sourceSubtask.taskId}" not found`,
          };
        }
        const workflowCheck = assertWorkflow(parent);
        if (!workflowCheck.ok) return workflowCheck;

        const result = await taskService.deleteSubtaskEdge(edgeId);
        if (!result.ok) {
          return { ok: false, error: result.error.message };
        }

        return {
          ok: true,
          content: `Workflow edge "${edgeId}" deleted.`,
        };
      } catch (err) {
        return formatToolError('Unexpected error deleting workflow edge', err);
      }
    },
  };
}
