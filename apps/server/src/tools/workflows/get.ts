import type { BuiltinTool } from '@openaidy/runtime';
import type { TaskService } from '../../tasks/service';
import { formatToolError, requireService, requireString } from '../shared.js';
import { workflowGetMeta } from '../catalog.js';
import { assertWorkflow } from './assert-workflow.js';

/**
 * workflow_get
 *
 * Returns the full state of a workflow: its task metadata, all of its
 * subtask nodes (with their dependsOn lists), and every edge connecting them.
 * The shape is intended to be round-trippable: workflow_update / future
 * node/edge tools can read the response, mutate it, and write it back.
 *
 * Use this before any mutation to confirm the workflow exists, see the
 * current graph, and learn the IDs of the nodes you want to edit.
 */
export function createWorkflowGetTool(
  getTaskService: () => TaskService | undefined,
): BuiltinTool {
  return {
    name: workflowGetMeta.name,
    description: workflowGetMeta.description,
    parameters: {
      type: 'object',
      properties: {
        workflowId: {
          type: 'string',
          description: 'ID of the workflow (task) to read.',
        },
        includeNodes: {
          type: 'boolean',
          description:
            'Include the subtask nodes in the response. Defaults to true. ' +
            'Set to false to skip the (potentially large) nodes array.',
        },
        includeEdges: {
          type: 'boolean',
          description:
            'Include the edges (conditional, loop, dependency) in the response. ' +
            'Defaults to true.',
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
      const includeNodes = args['includeNodes'] !== false;
      const includeEdges = args['includeEdges'] !== false;

      try {
        const task = await taskService.getTaskWithDetails(workflowId);
        if (!task) {
          return { ok: false, error: `Workflow "${workflowId}" not found` };
        }
        const workflowCheck = assertWorkflow(task);
        if (!workflowCheck.ok) return workflowCheck;

        const payload: Record<string, unknown> = {
          workflow: {
            id: task.id,
            title: task.title,
            description: task.description,
            status: task.status,
            priority: task.priority,
            planningEnabled: task.planningEnabled,
            createdAt: task.createdAt,
            updatedAt: task.updatedAt,
          },
        };

        if (includeNodes) {
          payload['nodes'] = task.subtasks.map((subtask) => ({
            id: subtask.id,
            title: subtask.title,
            description: subtask.description,
            orderIndex: subtask.orderIndex,
            subtaskKind: subtask.subtaskKind,
            dependsOnSubtaskIds:
              (subtask as { dependsOnSubtaskIds?: string[] })
                .dependsOnSubtaskIds ?? [],
            assignedAgentId: subtask.assignedAgentId,
            status: subtask.status,
            loop: {
              maxIterations: subtask.loopMaxIterations ?? null,
              conditionOperator: subtask.loopConditionOperator ?? null,
              conditionValue: subtask.loopConditionValue ?? null,
              iterationCount: subtask.loopIterationCount,
            },
          }));
        }

        if (includeEdges) {
          const edgesResult = await taskService.listSubtaskEdges(workflowId);
          if (!edgesResult.ok) {
            return { ok: false, error: edgesResult.error.message };
          }
          payload['edges'] = edgesResult.data.map((edge) => ({
            id: edge.id,
            fromNodeId: edge.dependsOnSubtaskId,
            toNodeId: edge.subtaskId,
            edgeKind: edge.edgeKind,
            conditionOperator: edge.conditionOperator,
            conditionValue: edge.conditionValue,
            createdAt: edge.createdAt,
          }));
        }

        return {
          ok: true,
          content: JSON.stringify(payload, null, 2),
        };
      } catch (err) {
        return formatToolError('Failed to read workflow', err);
      }
    },
  };
}
