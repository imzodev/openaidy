import type { BuiltinTool } from '@openaidy/runtime';
import type { TaskService } from '../../../tasks/service';
import {
  formatToolError,
  requireService,
  requireString,
} from '../../shared.js';
import { workflowNodeUpdateMeta } from '../../catalog.js';
import { assertWorkflow } from '../assert-workflow.js';
import {
  LOOP_CONDITION_OPERATOR_VALUES,
  loopShapeToConfig,
  validateLoopShape,
} from '../loop-config.js';

const ALLOWED_KIND = ['agent', 'approval_gate'] as const;

/**
 * workflow_node_update
 *
 * Patches an existing workflow node. Pass only the fields you want to
 * change — omitted fields keep their current value. Pass `loop: null`
 * explicitly to clear an existing loop configuration; omitting the key
 * preserves it.
 *
 * The underlying `SubtaskOperations.updateSubtask` automatically resets
 * a node from `completed`/`failed` back to `pending` if its title or
 * description changed, so a re-run picks up the new instructions. This
 * tool inherits that behaviour; no special-casing here.
 */
export function createWorkflowNodeUpdateTool(
  getTaskService: () => TaskService | undefined,
): BuiltinTool {
  return {
    name: workflowNodeUpdateMeta.name,
    description: workflowNodeUpdateMeta.description,
    parameters: {
      type: 'object',
      properties: {
        nodeId: {
          type: 'string',
          description: 'ID of the workflow node to update.',
        },
        title: {
          type: 'string',
          description: 'New title for the node.',
        },
        description: {
          type: 'string',
          description: 'New description for the node.',
        },
        subtaskKind: {
          type: 'string',
          enum: [...ALLOWED_KIND],
          description: 'New kind for the node.',
        },
        loop: {
          type: 'object',
          description:
            'New loop configuration. Use null explicitly to clear an ' +
            'existing loop; omit the key to preserve it.',
          properties: {
            maxIterations: {
              type: 'integer',
            },
            conditionOperator: {
              type: 'string',
              enum: [...LOOP_CONDITION_OPERATOR_VALUES],
            },
            conditionValue: {
              type: 'string',
            },
          },
          required: ['maxIterations', 'conditionOperator', 'conditionValue'],
        },
        orderIndex: {
          type: 'integer',
          description: 'New ordering hint for graph layout.',
        },
      },
      required: ['nodeId'],
    },

    async execute(args, _ctx) {
      const resolved = requireService(getTaskService, 'Task service');
      if (!resolved.ok) return resolved;
      const taskService = resolved.service;

      const nodeIdError = requireString(args['nodeId'], 'nodeId');
      if (nodeIdError) return { ok: false, error: nodeIdError };
      const nodeId = args['nodeId'] as string;

      const title = args['title'];
      const description = args['description'];
      const subtaskKind = args['subtaskKind'];
      const loop = args['loop'];
      const orderIndex = args['orderIndex'];

      const titleError =
        title === undefined ? null : requireString(title, 'title');
      if (titleError) return { ok: false, error: titleError };
      const descriptionError =
        description === undefined
          ? null
          : requireString(description, 'description');
      if (descriptionError) return { ok: false, error: descriptionError };

      if (
        title === undefined &&
        description === undefined &&
        subtaskKind === undefined &&
        loop === undefined &&
        orderIndex === undefined
      ) {
        return {
          ok: false,
          error:
            'No fields to update. Provide at least one of: title, description, subtaskKind, loop, orderIndex.',
        };
      }

      if (
        subtaskKind !== undefined &&
        !ALLOWED_KIND.includes(subtaskKind as (typeof ALLOWED_KIND)[number])
      ) {
        return {
          ok: false,
          error: `subtaskKind must be one of: ${ALLOWED_KIND.join(', ')}`,
        };
      }
      const loopError = validateLoopShape(loop, {
        allowUndefined: true,
        allowNull: true,
      });
      if (loopError) return { ok: false, error: loopError };

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

        const updateInput: Parameters<TaskService['updateSubtask']>[1] = {};
        if (typeof title === 'string' && title.trim()) {
          updateInput.title = title;
        }
        if (typeof description === 'string' && description.trim()) {
          updateInput.description = description;
        }
        if (typeof subtaskKind === 'string') {
          updateInput.subtaskKind = subtaskKind as 'agent' | 'approval_gate';
        }
        if (loop === null) {
          updateInput.loop = null;
        } else if (typeof loop === 'object' && loop !== null) {
          updateInput.loop = loopShapeToConfig(loop);
        }
        if (typeof orderIndex === 'number') {
          updateInput.orderIndex = orderIndex;
        }

        const result = await taskService.updateSubtask(nodeId, updateInput);
        if (!result.ok) {
          return { ok: false, error: result.error.message };
        }

        return {
          ok: true,
          content: `Workflow node updated.\n\nID: ${result.data.id}\nTitle: ${result.data.title}\nStatus: ${result.data.status}`,
        };
      } catch (err) {
        return formatToolError('Unexpected error updating workflow node', err);
      }
    },
  };
}
