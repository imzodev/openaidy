import type { BuiltinTool } from '@openaidy/runtime';
import type { TaskService } from '../../tasks/service';
import { formatToolError, requireService, requireString } from '../shared.js';
import { workflowCreateMeta } from '../catalog.js';

/**
 * workflow_create
 *
 * Creates a workflow (a Task with planningEnabled forced to true) and
 * optionally seeds it from a built-in template in the same call. The
 * two operations run atomically: if template application fails after the
 * task was created, the task is rolled back so the agent never sees a
 * half-built workflow that does not match its intent.
 */
export function createWorkflowCreateTool(
  getTaskService: () => TaskService | undefined,
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
        templateId: {
          type: 'string',
          description:
            'Optional ID of a built-in workflow template to apply ' +
            'atomically after the workflow is created. Currently supported: ' +
            '"software-development".',
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
          return {
            ok: true,
            content: `Workflow created and seeded from template "${templateId}".\n\nID: ${workflowId}\nTitle: ${createResult.data.title}\nNodes created: ${applyResult.data.nodeCount}\nEdges created: ${applyResult.data.edgeCount}`,
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
