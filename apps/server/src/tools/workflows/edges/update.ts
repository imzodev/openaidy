import type { BuiltinTool } from '@openaidy/runtime';
import type { TaskService } from '../../../tasks/service';
import {
  formatToolError,
  requireService,
  requireString,
} from '../../shared.js';
import { workflowEdgeUpdateMeta } from '../../catalog.js';
import { assertWorkflow } from '../assert-workflow.js';

const ALLOWED_EDGE_KIND = ['dependency', 'conditional'] as const;

const CONDITION_OPERATORS = ['equals', 'contains', 'matches_regex'] as const;

/**
 * workflow_edge_update
 *
 * Patches an existing workflow edge. Pass only the fields you want to
 * change — omitted fields keep their current value. Pass `condition: null`
 * to drop an existing condition (turning a conditional edge back into a
 * plain dependency).
 *
 * Resolves the parent workflow via `subtaskId → taskId` so the agent
 * only needs to pass the edge id; the tool does not need (and does not
 * accept) the workflow id.
 */
export function createWorkflowEdgeUpdateTool(
  getTaskService: () => TaskService | undefined,
): BuiltinTool {
  return {
    name: workflowEdgeUpdateMeta.name,
    description: workflowEdgeUpdateMeta.description,
    parameters: {
      type: 'object',
      properties: {
        edgeId: {
          type: 'string',
          description: 'ID of the workflow edge to update.',
        },
        edgeKind: {
          type: 'string',
          enum: [...ALLOWED_EDGE_KIND],
          description: 'New edge kind.',
        },
        condition: {
          type: 'object',
          description:
            'New condition. Use {operator, value} to set/replace, null to ' +
            'clear, or omit to preserve the existing condition.',
          properties: {
            operator: {
              type: 'string',
              enum: [...CONDITION_OPERATORS],
            },
            value: {
              type: 'string',
            },
          },
          required: ['operator', 'value'],
        },
      },
      required: ['edgeId'],
    },

    async execute(args, _ctx) {
      const resolved = requireService(getTaskService, 'Task service');
      if (!resolved.ok) return resolved;
      const taskService = resolved.service;

      const edgeIdError = requireString(args['edgeId'], 'edgeId');
      if (edgeIdError) return { ok: false, error: edgeIdError };
      const edgeId = args['edgeId'] as string;

      const edgeKind = args['edgeKind'];
      const condition = args['condition'];

      if (edgeKind === undefined && condition === undefined) {
        return {
          ok: false,
          error:
            'No fields to update. Provide at least one of: edgeKind, condition.',
        };
      }

      if (
        edgeKind !== undefined &&
        !ALLOWED_EDGE_KIND.includes(
          edgeKind as (typeof ALLOWED_EDGE_KIND)[number],
        )
      ) {
        return {
          ok: false,
          error: `edgeKind must be one of: ${ALLOWED_EDGE_KIND.join(', ')}`,
        };
      }
      if (condition !== undefined && condition !== null) {
        if (typeof condition !== 'object') {
          return { ok: false, error: 'condition must be an object or null' };
        }
        const c = condition as Record<string, unknown>;
        if (
          !CONDITION_OPERATORS.includes(
            c['operator'] as (typeof CONDITION_OPERATORS)[number],
          )
        ) {
          return {
            ok: false,
            error: `condition.operator must be one of: ${CONDITION_OPERATORS.join(', ')}`,
          };
        }
        if (typeof c['value'] !== 'string') {
          return {
            ok: false,
            error: 'condition.value is required and must be a string',
          };
        }
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

        const updateInput: Parameters<TaskService['updateSubtaskEdge']>[1] = {};
        if (typeof edgeKind === 'string') {
          updateInput.edgeKind = edgeKind as 'dependency' | 'conditional';
        }
        if (condition === null) {
          updateInput.condition = null;
        } else if (typeof condition === 'object' && condition !== null) {
          const c = condition as Record<string, unknown>;
          updateInput.condition = {
            operator: c['operator'] as string,
            value: c['value'] as string,
          };
        }

        const result = await taskService.updateSubtaskEdge(edgeId, updateInput);
        if (!result.ok) {
          return { ok: false, error: result.error.message };
        }

        return {
          ok: true,
          content: `Workflow edge updated.\n\nID: ${result.data.id}\nKind: ${result.data.edgeKind}${result.data.conditionOperator ? `\nCondition: ${result.data.conditionOperator} ${result.data.conditionValue ?? ''}`.trimEnd() : ''}`,
        };
      } catch (err) {
        return formatToolError('Unexpected error updating workflow edge', err);
      }
    },
  };
}
