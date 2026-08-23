import type { BuiltinTool } from '@openaidy/runtime';
import type { TaskService } from '../../../tasks/service';
import {
  formatToolError,
  requireService,
  requireString,
} from '../../shared.js';
import { workflowNodeCreateMeta } from '../../catalog.js';
import { assertWorkflow } from '../assert-workflow.js';
import {
  LOOP_CONDITION_OPERATOR_VALUES,
  loopShapeToConfig,
  validateLoopShape,
} from '../loop-config.js';

const ALLOWED_KIND = ['agent', 'approval_gate'] as const;

/**
 * workflow_node_create
 *
 * Adds a subtask to a workflow. The task referenced by `workflowId` must
 * have `planningEnabled: true` — non-workflow tasks are rejected via the
 * shared assertWorkflow guard so the mutation surface stays workflow-only.
 *
 * Edges (dependencies between nodes) are intentionally NOT created here;
 * the agent uses workflow_edge_create for that. Splitting node creation
 * from edge creation makes the graph mutation legible: every edge is an
 * explicit operation, never an implicit side-effect of node creation.
 */
export function createWorkflowNodeCreateTool(
  getTaskService: () => TaskService | undefined,
): BuiltinTool {
  return {
    name: workflowNodeCreateMeta.name,
    description: workflowNodeCreateMeta.description,
    parameters: {
      type: 'object',
      properties: {
        workflowId: {
          type: 'string',
          description: 'ID of the workflow to add the node to.',
        },
        title: {
          type: 'string',
          description: 'Short title of the node.',
        },
        description: {
          type: 'string',
          description: 'Detailed description of what the node does.',
        },
        subtaskKind: {
          type: 'string',
          enum: [...ALLOWED_KIND],
          description:
            "Node kind. 'agent' (default) runs a normal LLM session; " +
            "'approval_gate' pauses execution until a human resolves it.",
        },
        loop: {
          type: 'object',
          description:
            'Optional loop configuration. The node re-runs itself until ' +
            'its result satisfies the condition, or maxIterations is hit.',
          properties: {
            maxIterations: {
              type: 'integer',
              description:
                'Maximum number of times the node may re-run (>= 1).',
            },
            conditionOperator: {
              type: 'string',
              enum: [...LOOP_CONDITION_OPERATOR_VALUES],
              description: 'How to evaluate the condition against the result.',
            },
            conditionValue: {
              type: 'string',
              description: 'Value to compare against the node result.',
            },
          },
          required: ['maxIterations', 'conditionOperator', 'conditionValue'],
        },
        assignedAgentId: {
          type: 'string',
          description:
            'Optional agent to assign the node to. If provided, must ' +
            'reference an existing enabled agent — otherwise the call fails.',
        },
        orderIndex: {
          type: 'integer',
          description:
            'Optional ordering hint for graph layout. Defaults to 0; the ' +
            'graph editor re-sorts on every change so this is purely cosmetic.',
        },
      },
      required: ['workflowId', 'title', 'description'],
    },

    async execute(args, _ctx) {
      const resolved = requireService(getTaskService, 'Task service');
      if (!resolved.ok) return resolved;
      const taskService = resolved.service;

      const workflowIdError = requireString(args['workflowId'], 'workflowId');
      if (workflowIdError) return { ok: false, error: workflowIdError };
      const titleError = requireString(args['title'], 'title');
      if (titleError) return { ok: false, error: titleError };
      const descriptionError = requireString(
        args['description'],
        'description',
      );
      if (descriptionError) return { ok: false, error: descriptionError };

      const workflowId = args['workflowId'] as string;
      const title = args['title'] as string;
      const description = args['description'] as string;
      const subtaskKind = args['subtaskKind'];
      const loop = args['loop'];
      const assignedAgentId = args['assignedAgentId'];
      const orderIndex = args['orderIndex'];

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
        allowNull: false,
      });
      if (loopError) return { ok: false, error: loopError };

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

        const createInput: Parameters<TaskService['createSubtask']>[0] = {
          taskId: workflowId,
          title,
          description,
        };
        if (typeof subtaskKind === 'string') {
          createInput.subtaskKind = subtaskKind as 'agent' | 'approval_gate';
        }
        if (typeof loop === 'object' && loop !== null) {
          createInput.loop = loopShapeToConfig(loop);
        }
        if (typeof assignedAgentId === 'string' && assignedAgentId) {
          createInput.assignedAgentId = assignedAgentId;
        }
        if (typeof orderIndex === 'number') {
          createInput.orderIndex = orderIndex;
        }

        const result = await taskService.createSubtask(createInput);
        if (!result.ok) {
          return { ok: false, error: result.error.message };
        }

        return {
          ok: true,
          content: `Workflow node created.\n\nID: ${result.data.id}\nTitle: ${result.data.title}\nKind: ${result.data.subtaskKind}\nStatus: ${result.data.status}`,
        };
      } catch (err) {
        return formatToolError('Unexpected error creating workflow node', err);
      }
    },
  };
}
