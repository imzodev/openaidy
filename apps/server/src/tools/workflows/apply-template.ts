import type { BuiltinTool } from '@openaidy/runtime';
import type { TaskService } from '../../tasks/service';
import { formatToolError, requireService, requireString } from '../shared.js';
import { workflowApplyTemplateMeta } from '../catalog.js';
import { assertWorkflow } from './assert-workflow.js';
import {
  describeTemplateTrigger,
  setUpTemplateTrigger,
  type TemplateTriggerDeps,
} from './template-trigger.js';
import { TEMPLATE_ID_LIST } from './template-list.js';

/**
 * workflow_apply_template
 *
 * Applies one of the built-in workflow templates (e.g.
 * "software-development") to an existing workflow. The template defines
 * a fixed set of nodes and edges with placeholder text — the caller
 * provides the placeholder values via `templateInputs`.
 *
 * With `clearExisting` the template replaces the current graph; the old
 * nodes are only removed once the template's are in place, so a failure
 * leaves the workflow unchanged (see TaskService.applyWorkflowTemplate).
 */
export function createWorkflowApplyTemplateTool(
  getTaskService: () => TaskService | undefined,
  triggerDeps: TemplateTriggerDeps = {},
): BuiltinTool {
  return {
    name: workflowApplyTemplateMeta.name,
    description: workflowApplyTemplateMeta.description,
    parameters: {
      type: 'object',
      properties: {
        workflowId: {
          type: 'string',
          description: 'ID of the target workflow.',
        },
        templateId: {
          type: 'string',
          description: `ID of the template to apply: ${TEMPLATE_ID_LIST}.`,
        },
        templateInputs: {
          type: 'object',
          description:
            'Optional map of placeholder values for the template. ' +
            'Each template declares its own inputs; required inputs must ' +
            'be provided or the call fails.',
        },
        clearExisting: {
          type: 'boolean',
          description:
            'If true, the template replaces all existing nodes and edges. ' +
            'Default false — the template graph is added next to whatever ' +
            'is there.',
        },
        setupTrigger: {
          type: 'boolean',
          description:
            "Also set up the template's suggested trigger (a message " +
            'trigger, webhook or schedule). Default false.',
        },
      },
      required: ['workflowId', 'templateId'],
    },

    async execute(args, _ctx) {
      const resolved = requireService(getTaskService, 'Task service');
      if (!resolved.ok) return resolved;
      const taskService = resolved.service;

      const workflowIdError = requireString(args['workflowId'], 'workflowId');
      if (workflowIdError) return { ok: false, error: workflowIdError };
      const templateIdError = requireString(args['templateId'], 'templateId');
      if (templateIdError) return { ok: false, error: templateIdError };

      const workflowId = args['workflowId'] as string;
      const templateId = args['templateId'] as string;
      const templateInputs = args['templateInputs'];
      const clearExisting = args['clearExisting'] === true;

      if (templateInputs !== undefined && templateInputs !== null) {
        if (
          typeof templateInputs !== 'object' ||
          Array.isArray(templateInputs)
        ) {
          return {
            ok: false,
            error:
              'templateInputs must be a record of string keys to string values',
          };
        }
        for (const [key, value] of Object.entries(
          templateInputs as Record<string, unknown>,
        )) {
          if (typeof value !== 'string') {
            return {
              ok: false,
              error: `templateInputs["${key}"] must be a string`,
            };
          }
        }
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

        const inputs =
          (templateInputs as Record<string, string> | undefined) ?? {};
        const result = await taskService.applyWorkflowTemplate(
          workflowId,
          templateId,
          inputs,
          { clearExisting },
        );
        if (!result.ok) {
          return { ok: false, error: result.error.message };
        }

        const trigger = result.data.trigger;
        const triggerLine = !trigger
          ? ''
          : args['setupTrigger'] === true
            ? `\n${await setUpTemplateTrigger(workflowId, trigger, triggerDeps)}`
            : `\nSuggested start: ${describeTemplateTrigger(trigger)} (pass setupTrigger=true to set it up).`;
        return {
          ok: true,
          content: `Template "${templateId}" applied to workflow "${workflowId}".\n\nNodes created: ${result.data.nodeCount}\nEdges created: ${result.data.edgeCount}${clearExisting ? '\n(Existing nodes/edges were cleared first.)' : ''}${triggerLine}`,
        };
      } catch (err) {
        return formatToolError('Unexpected error applying template', err);
      }
    },
  };
}
