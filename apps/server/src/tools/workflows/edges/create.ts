import type { BuiltinTool } from '@openaidy/runtime';
import type { TaskService } from '../../../tasks/service';
import {
  formatToolError,
  requireService,
  requireString,
} from '../../shared.js';
import { workflowEdgeCreateMeta } from '../../catalog.js';
import { assertWorkflow } from '../assert-workflow.js';

const ALLOWED_EDGE_KIND = ['dependency', 'conditional'] as const;

const CONDITION_OPERATORS = ['equals', 'contains', 'matches_regex'] as const;

/**
 * workflow_edge_create
 *
 * Adds a directed dependency edge between two nodes of the same
 * workflow. `fromNodeId` must already be a node of `workflowId`; the
 * `toNodeId` is the dependent node (cannot start until fromNodeId
 * completes).
 *
 * Cycle detection and self-edge rejection live in
 * `SubtaskOperations.createSubtaskEdge` (wouldCreateCycle +
 * subtaskId !== dependsOnSubtaskId) so this tool is a thin wrapper that
 * adds the workflow-only assertion on top.
 *
 * Conditional edges carry an operator + value evaluated against the
 * upstream dependency's result (see ConditionOperator). The service
 * rejects a conditional edge without a condition and a dependency edge
 * with one — this tool just validates the shape and forwards.
 */
export function createWorkflowEdgeCreateTool(
  getTaskService: () => TaskService | undefined,
): BuiltinTool {
  return {
    name: workflowEdgeCreateMeta.name,
    description: workflowEdgeCreateMeta.description,
    parameters: {
      type: 'object',
      properties: {
        workflowId: {
          type: 'string',
          description: 'ID of the workflow that owns both nodes.',
        },
        fromNodeId: {
          type: 'string',
          description:
            'ID of the upstream node (the dependency). ' +
            'Must already be a node of the workflow.',
        },
        toNodeId: {
          type: 'string',
          description:
            'ID of the dependent node (cannot run until fromNodeId completes). ' +
            'Must already be a node of the workflow.',
        },
        edgeKind: {
          type: 'string',
          enum: [...ALLOWED_EDGE_KIND],
          description:
            "Edge kind. 'dependency' (default) is satisfied when " +
            "fromNodeId completes; 'conditional' additionally evaluates " +
            "the condition against fromNodeId's result.",
        },
        conditionOperator: {
          type: 'string',
          enum: [...CONDITION_OPERATORS],
          description:
            'How to compare fromNodeId result against conditionValue. ' +
            'Required when edgeKind=conditional; ignored otherwise.',
        },
        conditionValue: {
          type: 'string',
          description:
            'Value to compare against fromNodeId result. Required when ' +
            'edgeKind=conditional; ignored otherwise.',
        },
      },
      required: ['workflowId', 'fromNodeId', 'toNodeId'],
    },

    async execute(args, _ctx) {
      const resolved = requireService(getTaskService, 'Task service');
      if (!resolved.ok) return resolved;
      const taskService = resolved.service;

      const workflowIdError = requireString(args['workflowId'], 'workflowId');
      if (workflowIdError) return { ok: false, error: workflowIdError };
      const fromError = requireString(args['fromNodeId'], 'fromNodeId');
      if (fromError) return { ok: false, error: fromError };
      const toError = requireString(args['toNodeId'], 'toNodeId');
      if (toError) return { ok: false, error: toError };

      const workflowId = args['workflowId'] as string;
      const fromNodeId = args['fromNodeId'] as string;
      const toNodeId = args['toNodeId'] as string;
      const edgeKind = args['edgeKind'];
      const conditionOperator = args['conditionOperator'];
      const conditionValue = args['conditionValue'];

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
      const effectiveKind = edgeKind ?? 'dependency';

      let condition: { operator: string; value: string } | null | undefined;
      if (effectiveKind === 'conditional') {
        if (typeof conditionOperator !== 'string') {
          return {
            ok: false,
            error: 'conditionOperator is required when edgeKind is conditional',
          };
        }
        if (
          !CONDITION_OPERATORS.includes(
            conditionOperator as (typeof CONDITION_OPERATORS)[number],
          )
        ) {
          return {
            ok: false,
            error: `conditionOperator must be one of: ${CONDITION_OPERATORS.join(', ')}`,
          };
        }
        if (typeof conditionValue !== 'string') {
          return {
            ok: false,
            error: 'conditionValue is required when edgeKind is conditional',
          };
        }
        condition = { operator: conditionOperator, value: conditionValue };
      } else if (
        conditionOperator !== undefined ||
        conditionValue !== undefined
      ) {
        return {
          ok: false,
          error:
            'conditionOperator/conditionValue can only be set when edgeKind is conditional',
        };
      }

      try {
        const existing = await taskService.getTask(workflowId);
        if (!existing) {
          return {
            ok: false,
            error: `Workflow "${workflowId}" not found`,
          };
        }
        const workflowCheck = assertWorkflow(existing);
        if (!workflowCheck.ok) return workflowCheck;

        const edgeInput: Parameters<TaskService['createSubtaskEdge']>[1] = {
          subtaskId: toNodeId,
          dependsOnSubtaskId: fromNodeId,
        };
        if (typeof edgeKind === 'string') {
          edgeInput.edgeKind = edgeKind as 'dependency' | 'conditional';
        }
        if (condition !== undefined) {
          edgeInput.condition = condition as {
            operator: string;
            value: string;
          } | null;
        }

        const result = await taskService.createSubtaskEdge(
          workflowId,
          edgeInput,
        );
        if (!result.ok) {
          return { ok: false, error: result.error.message };
        }

        return {
          ok: true,
          content: `Workflow edge created.\n\nID: ${result.data.id}\nFrom: ${fromNodeId}\nTo: ${toNodeId}\nKind: ${result.data.edgeKind}${result.data.conditionOperator ? `\nCondition: ${result.data.conditionOperator} ${result.data.conditionValue ?? ''}`.trimEnd() : ''}`,
        };
      } catch (err) {
        return formatToolError('Unexpected error creating workflow edge', err);
      }
    },
  };
}
