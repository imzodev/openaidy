import type { TasksRepository, SubtasksRepository } from '@openaidy/db';
import type {
  ApplyTemplateResult,
  GraphEdgeInput,
  GraphNodeInput,
  ResolvedTemplateTrigger,
  TemplateTrigger,
} from '@openaidy/shared-types';
import type { AgentRegistry } from '../../agents';
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
    private readonly agents?: AgentRegistry,
  ) {}

  async applyTemplate(
    taskId: string,
    templateId: string,
    inputs: Record<string, string>,
  ): Promise<ServiceResult<ApplyTemplateResult>> {
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
      const agentId = this.resolveAgent(node.agent, substitute);
      return {
        key: node.key,
        title: node.title
          ? substitute(node.title)
          : deriveTitleFromDescription(description),
        description,
        subtaskKind: node.kind,
        ...(node.loop !== undefined && { loop: node.loop }),
        ...(agentId && { assignedAgentId: agentId }),
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

    const trigger = template.trigger
      ? resolveTrigger(template.trigger, substitute)
      : undefined;
    return {
      ok: true,
      data: {
        nodeCount: nodes.length,
        edgeCount: edges.length,
        ...(trigger ? { trigger } : {}),
      },
    };
  }

  /**
   * The step's agent: a literal id or a filled-in `{{agent}}` input. An
   * empty or unknown one leaves the step to the default agent rather than
   * failing the whole template.
   */
  private resolveAgent(
    agent: string | undefined,
    substitute: (text: string) => string,
  ): string | undefined {
    const id = agent ? substitute(agent).trim() : '';
    if (!id || id.includes('{{')) return undefined;
    if (this.agents && !this.agents.getAgent(id)) {
      this.logger.warn('Template step agent not found; using the default', {
        agentId: id,
      });
      return undefined;
    }
    return id;
  }
}

function resolveTrigger(
  trigger: TemplateTrigger,
  substitute: (text: string) => string,
): ResolvedTemplateTrigger | undefined {
  if (trigger.kind !== 'channel_message') return trigger;
  const channelId = substitute(trigger.channel).trim();
  if (!channelId || channelId.includes('{{')) return undefined;
  const value = trigger.match.value
    ? substitute(trigger.match.value).trim()
    : undefined;
  const ackText = trigger.ackText ? substitute(trigger.ackText) : undefined;
  return {
    kind: 'channel_message',
    channelId,
    match: { type: trigger.match.type, ...(value ? { value } : {}) },
    replyWithResult: trigger.replyWithResult,
    ...(ackText ? { ackText } : {}),
  };
}
