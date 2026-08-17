import type { TasksRepository, SubtasksRepository } from '@openaidy/db';
import type { GraphEdgeInput, GraphNodeInput } from '@openaidy/shared-types';
import {
  getWorkflowTemplate,
  substitutePlaceholders,
} from '@openaidy/workflow-templates';
import type { createLogger } from '../../lib/logger';
import type { ServiceResult } from '../../types';
import { deriveTitleFromDescription } from '../derive-title';
import { buildSubtaskGraph } from '../subtask-graph-builder';

export class WorkflowTemplateOperations {
  constructor(
    private readonly tasksRepo: TasksRepository,
    private readonly subtasksRepo: SubtasksRepository,
    private readonly logger: ReturnType<typeof createLogger>,
  ) {}

  async applyTemplate(
    taskId: string,
    templateId: string,
    inputs: Record<string, string>,
  ): Promise<ServiceResult<{ nodeCount: number; edgeCount: number }>> {
    const task = await this.tasksRepo.findById(taskId);
    if (!task) {
      return {
        ok: false,
        error: {
          code: 'task.not_found',
          message: `Task "${taskId}" not found`,
        },
      };
    }

    const template = getWorkflowTemplate(templateId);
    if (!template) {
      return {
        ok: false,
        error: {
          code: 'template.not_found',
          message: `Workflow template "${templateId}" not found`,
        },
      };
    }

    const resolvedInputs: Record<string, string> = {};
    for (const input of template.inputs) {
      // A blank/whitespace-only value (e.g. an untouched form field that
      // never got its default written into it) is treated the same as an
      // absent one, so a required input with a default is never rejected
      // just because the caller sent `''` instead of omitting the key.
      const provided = inputs[input.key]?.trim();
      const value = provided ? inputs[input.key] : input.default;
      if (input.required && !value) {
        return {
          ok: false,
          error: {
            code: 'template.missing_input',
            message: `Input "${input.key}" (${input.label}) is required`,
          },
        };
      }
      resolvedInputs[input.key] = value ?? '';
    }

    const substitute = (text: string): string =>
      substitutePlaceholders(text, resolvedInputs);

    const nodes: GraphNodeInput[] = template.nodes.map((node) => {
      const description = substitute(node.description);
      return {
        key: node.key,
        title: node.title
          ? substitute(node.title)
          : deriveTitleFromDescription(description),
        description,
        subtaskKind: node.kind,
        ...(node.loop !== undefined && { loop: node.loop }),
      };
    });

    const edges: GraphEdgeInput[] = template.edges.map((edge) => ({
      subtaskKey: edge.to,
      dependsOnKey: edge.from,
      edgeKind: edge.edgeKind,
      ...(edge.conditionOperator && {
        conditionOperator: edge.conditionOperator,
      }),
      ...(edge.conditionValue && {
        conditionValue: substitute(edge.conditionValue),
      }),
    }));

    await buildSubtaskGraph(
      this.subtasksRepo,
      taskId,
      nodes,
      edges,
      this.logger,
    );

    return {
      ok: true,
      data: { nodeCount: nodes.length, edgeCount: edges.length },
    };
  }
}
