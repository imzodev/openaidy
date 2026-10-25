import type { BuiltinTool } from '@openaidy/runtime';
import type { TaskService } from '../../tasks/service';
import { formatToolError, requireService, requireString } from '../shared.js';
import { workflowCreateMeta } from '../catalog.js';
import { parseGraphSpec } from '../../tasks/graph-spec';
import {
  describeTemplateTrigger,
  setUpTemplateTrigger,
  type TemplateTriggerDeps,
} from './template-trigger.js';
import { TEMPLATE_ID_LIST } from './template-list.js';
import {
  GRAPH_EDGES_PARAM,
  GRAPH_NODES_PARAM,
  formatCreatedNodes,
} from './graph-params.js';

/**
 * workflow_create
 *
 * Creates a workflow (a Task with planningEnabled forced to true) and
 * optionally builds its graph in the same call — from declarative
 * `nodes`/`edges` (validated before anything is created) or from a
 * built-in template. If building the graph fails after the task was
 * created, the task is rolled back so the agent never sees a half-built
 * workflow that does not match its intent.
 */
export function createWorkflowCreateTool(
  getTaskService: () => TaskService | undefined,
  triggerDeps: TemplateTriggerDeps = {},
): BuiltinTool {
  return {
    name: workflowCreateMeta.name,
    description: workflowCreateMeta.description,
    parameters: {
      type: 'object',
      properties: {
        description: {
          type: 'string',
          description:
            'Detailed description of what the workflow achieves. ' +
            'Used as the task description and, if no title is given, ' +
            'as the source of the derived title.',
        },
        title: {
          type: 'string',
          description:
            'Short title for the workflow. If omitted, derived from the ' +
            'description (first 60 chars).',
        },
        priority: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'urgent'],
          description: 'Priority level of the workflow. Defaults to medium.',
        },
        nodes: GRAPH_NODES_PARAM,
        edges: GRAPH_EDGES_PARAM,
        templateId: {
          type: 'string',
          description:
            'Optional ID of a built-in workflow template to apply ' +
            '(instead of nodes/edges) ' +
            'atomically after the workflow is created (see ' +
            `workflow_template_list for their inputs): ${TEMPLATE_ID_LIST}.`,
        },
        setupTrigger: {
          type: 'boolean',
          description:
            "With templateId: also set up the template's suggested trigger " +
            '(message trigger, webhook or schedule). Default false.',
        },
        templateInputs: {
          type: 'object',
          description:
            'Optional map of placeholder values for the template. Keys are ' +
            'input names (template-specific); values are the strings to ' +
            'substitute into template text. Required inputs without a ' +
            'value abort the call.',
        },
      },
      required: ['description'],
    },

    async execute(args, _ctx) {
      const resolved = requireService(getTaskService, 'Task service');
      if (!resolved.ok) return resolved;
      const taskService = resolved.service;

      const description = args['description'];
      const title = args['title'];
      const priority = args['priority'];
      const templateId = args['templateId'];
      const templateInputs = args['templateInputs'];

      const descriptionError = requireString(description, 'description');
      if (descriptionError) return { ok: false, error: descriptionError };

      const titleError =
        title === undefined || title === null
          ? null
          : requireString(title, 'title');
      if (titleError) return { ok: false, error: titleError };

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

      const hasGraph = args['nodes'] !== undefined && args['nodes'] !== null;
      if (hasGraph && typeof templateId === 'string' && templateId) {
        return {
          ok: false,
          error: 'Pass either nodes/edges or templateId, not both.',
        };
      }
      const spec = hasGraph
        ? parseGraphSpec(args['nodes'], args['edges'])
        : null;
      if (spec && !spec.ok) {
        return { ok: false, error: `The graph is malformed:\n${spec.error}` };
      }
      if (spec?.ok) {
        // Validate before creating anything, so a bad graph leaves no
        // empty workflow behind for the agent to clean up.
        const check = taskService.checkWorkflowGraph(spec.graph);
        if (!check.ok) {
          return {
            ok: false,
            error: `The workflow graph has problems, so nothing was created:\n${check.errors.map((e) => `- ${e.message}`).join('\n')}`,
          };
        }
      }

      const descriptionText = description as string;
      const resolvedTitle =
        (title as string | undefined) ??
        (descriptionText.length > 60
          ? `${descriptionText.slice(0, 60).trimEnd()}…`
          : descriptionText);

      try {
        const createInput: Parameters<TaskService['createTask']>[0] = {
          title: resolvedTitle,
          description: descriptionText,
          planningEnabled: true,
          // Workflows are hand-authored graphs (template or manual nodes),
          // not AI-planned checklists. Without this, TaskOperations.createTask
          // fires the auto-planner after we return; the planner then races
          // against any workflow_apply_template call (deleteByTask on success
          // wipes the template's subtasks) and against workflow_execute (whose
          // pending subtasks may not exist yet). The comment on CreateTaskInput
          // in apps/server/src/types.ts calls out the workflow editor as the
          // canonical skipAutoPlan consumer — we are that case.
          skipAutoPlan: true,
        };
        if (typeof priority === 'string') {
          createInput.priority = priority as
            | 'low'
            | 'medium'
            | 'high'
            | 'urgent';
        }

        const createResult = await taskService.createTask(createInput);

        if (!createResult.ok) {
          return { ok: false, error: createResult.error.message };
        }

        const workflowId = createResult.data.id;

        if (spec?.ok) {
          const graphResult = await taskService.setWorkflowGraph(
            workflowId,
            spec.graph,
          );
          if (!graphResult.ok) {
            await taskService.deleteTask(workflowId);
            return {
              ok: false,
              error: `${graphResult.error.message}\n\nNothing was created.`,
            };
          }
          return {
            ok: true,
            content: `Workflow created.\n\nID: ${workflowId}\nTitle: ${createResult.data.title}\n${formatCreatedNodes(graphResult.data)}`,
          };
        }

        if (typeof templateId === 'string' && templateId) {
          const inputs =
            (templateInputs as Record<string, string> | undefined) ?? {};
          const applyResult = await taskService.applyWorkflowTemplate(
            workflowId,
            templateId,
            inputs,
          );
          if (!applyResult.ok) {
            // Atomicity: the workflow now exists but the template could not
            // be applied. Roll the task back so the agent is not left with
            // a half-built workflow that contradicts its intent.
            await taskService.deleteTask(workflowId);
            return {
              ok: false,
              error: `Workflow was created but template "${templateId}" failed to apply: ${applyResult.error.message}. Rolled back the workflow.`,
            };
          }
          const trigger = applyResult.data.trigger;
          const triggerLine = !trigger
            ? ''
            : args['setupTrigger'] === true
              ? `\n${await setUpTemplateTrigger(workflowId, trigger, triggerDeps)}`
              : `\nSuggested start: ${describeTemplateTrigger(trigger)} (pass setupTrigger=true to set it up).`;
          return {
            ok: true,
            content: `Workflow created and seeded from template "${templateId}".\n\nID: ${workflowId}\nTitle: ${createResult.data.title}\nNodes created: ${applyResult.data.nodeCount}\nEdges created: ${applyResult.data.edgeCount}${triggerLine}`,
          };
        }

        return {
          ok: true,
          content: `Workflow created successfully!\n\nID: ${workflowId}\nTitle: ${createResult.data.title}\nStatus: ${createResult.data.status}\nPriority: ${createResult.data.priority ?? 'medium'}`,
        };
      } catch (err) {
        return formatToolError('Unexpected error creating workflow', err);
      }
    },
  };
}
