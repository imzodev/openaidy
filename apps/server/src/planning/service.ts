/**
 * Planning Service
 *
 * Service for decomposing tasks into subtasks using an AI planning agent.
 */

import type { ProviderServices } from '../providers';
import type {
  TasksRepository,
  SubtasksRepository,
  TaskAgentsRepository,
  DeliverablesRepository,
} from '@openaidy/db';
import type { AgentRegistry } from '../agents';
import { parseModelString } from '../agents/schema';
import { createLogger } from '../lib/logger';
import { buildSubtaskGraph } from '../tasks/subtask-graph-builder';
import {
  PLANNING_AGENT_CONFIG,
  type PlanningOptions,
  type PlannedSubtask,
} from './config';
import {
  buildPlanningPrompt,
  buildComplexityPrompt,
  buildAgentContextPrompt,
} from './prompts';
import type { Task } from '@openaidy/db';

const logger = createLogger('PlanningService');

/**
 * Planning service options
 */
export type PlanningServiceOptions = {
  providers: ProviderServices;
  tasksRepo: TasksRepository;
  subtasksRepo: SubtasksRepository;
  taskAgentsRepo?: TaskAgentsRepository;
  deliverablesRepo?: DeliverablesRepository;
  agents?: AgentRegistry;
  getDefaultAgentId?: () => string | undefined;
};

/**
 * Planning result
 */
export type PlanningResult =
  | { ok: true; subtasks: PlannedSubtask[] }
  | { ok: false; error: { code: string; message: string } };

/**
 * Planning Service
 *
 * Handles task decomposition into subtasks using AI.
 */
export class PlanningService {
  private readonly providers: ProviderServices;
  private readonly tasksRepo: TasksRepository;
  private readonly subtasksRepo: SubtasksRepository;
  private readonly taskAgentsRepo: TaskAgentsRepository | undefined;
  private readonly deliverablesRepo: DeliverablesRepository | undefined;
  private readonly agents: AgentRegistry | undefined;
  private readonly getDefaultAgentId: (() => string | undefined) | undefined;

  constructor(options: PlanningServiceOptions) {
    this.providers = options.providers;
    this.tasksRepo = options.tasksRepo;
    this.subtasksRepo = options.subtasksRepo;
    this.taskAgentsRepo = options.taskAgentsRepo;
    this.deliverablesRepo = options.deliverablesRepo;
    this.agents = options.agents;
    this.getDefaultAgentId = options.getDefaultAgentId;
  }

  /**
   * Resolve the provider and model to use for planning.
   * Priority: default agent's model > default provider config.
   */
  private resolveModelConfig():
    | { providerId: string; modelId: string }
    | undefined {
    // 1. Try the default agent's model
    const defaultAgentId = this.getDefaultAgentId?.();
    const defaultAgent = defaultAgentId
      ? this.agents?.getAgent(defaultAgentId)
      : undefined;
    if (defaultAgent?.model) {
      const parsed = parseModelString(defaultAgent.model);
      if (parsed) return parsed;
    }

    // 2. Fallback to the globally configured default provider
    const defaultConfig = this.providers.registry.getDefault();
    if (defaultConfig) {
      return {
        providerId: defaultConfig.providerId,
        modelId: defaultConfig.modelId,
      };
    }

    return undefined;
  }

  /**
   * Plan a task by decomposing it into subtasks
   */
  async planTask(
    taskId: string,
    options?: PlanningOptions,
  ): Promise<PlanningResult> {
    // Get task
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

    if (!task.planningEnabled) {
      return {
        ok: false,
        error: {
          code: 'planning.not_enabled',
          message: 'Planning is not enabled for this task',
        },
      };
    }

    // Update planning status to in_progress
    await this.tasksRepo.updatePlanningStatus(taskId, 'in_progress');

    try {
      // Resolve model config from default agent or provider
      const modelConfig = this.resolveModelConfig();
      if (!modelConfig) {
        throw new Error(
          'No model configured: set a model on the default agent or configure a default provider',
        );
      }

      // Assess complexity to constrain the number of subtasks
      const maxSubtasks = await this.assessComplexity(task, modelConfig);

      // Build agent context for the planning prompt
      let agentContext: string | undefined;
      if (this.agents) {
        const agents = this.agents.listAllAgents();
        if (agents.length > 0) {
          const openAidyHome = process.env.OPENAIDY_HOME || '';
          agentContext = buildAgentContextPrompt(agents, openAidyHome);
        }
      }

      // Build prompt with complexity-adjusted max and agent context
      const prompt = buildPlanningPrompt(task, maxSubtasks, agentContext);

      // Invoke planning agent
      const result = await this.providers.invocation.invoke(
        {
          model: modelConfig.modelId,
          messages: [
            { role: 'system', content: PLANNING_AGENT_CONFIG.systemPrompt },
            { role: 'user', content: prompt },
          ],
        },
        { providerId: modelConfig.providerId },
      );

      if (!result.ok) {
        throw new Error(result.error.message);
      }

      // Parse response
      const planningResult = this.parsePlanningResponse(
        result.value.content,
        options,
      );

      // Create subtasks in database
      // First delete existing subtasks if re-planning
      await this.subtasksRepo.deleteByTask(taskId);
      await this.createSubtasks(taskId, planningResult.subtasks);

      // After creating subtasks with assigned agents, also assign those agents to the parent task
      if (this.taskAgentsRepo && planningResult.subtasks.length > 0) {
        const agentAssignments = new Map<string, string>();
        for (const subtask of planningResult.subtasks) {
          if (subtask.assignedAgentId) {
            // Use 'primary' role for the first assignment of each agent, 'secondary' for subsequent
            const role = agentAssignments.has(subtask.assignedAgentId)
              ? 'secondary'
              : 'primary';
            agentAssignments.set(subtask.assignedAgentId, role);
          }
        }

        if (agentAssignments.size > 0) {
          console.log(
            '[PlanningService] Assigning agents to task:',
            Array.from(agentAssignments.entries()),
          );
          // Remove existing agents first to avoid UNIQUE constraint conflicts on re-plan
          await this.taskAgentsRepo.removeAllFromTask(taskId);
          const assignments = Array.from(agentAssignments.entries()).map(
            ([agentId, role]) => ({
              agentId,
              role: role as 'primary' | 'secondary',
            }),
          );
          await this.taskAgentsRepo.assignMultiple(taskId, assignments);
        }
      }

      // Create deliverable for the task from AI response, or use default if not provided
      if (this.deliverablesRepo) {
        const deliverableType = planningResult.deliverable?.type || 'document';
        const deliverableDescription =
          planningResult.deliverable?.description ||
          `Deliverable for task: ${task.title}`;
        await this.deliverablesRepo.create({
          taskId,
          type: deliverableType as
            | 'document'
            | 'image'
            | 'code'
            | 'report'
            | 'data'
            | 'link'
            | 'other',
          description: deliverableDescription,
        });
      }

      // Update planning status to completed
      await this.tasksRepo.updatePlanningStatus(taskId, 'completed');

      return { ok: true, subtasks: planningResult.subtasks };
    } catch (error) {
      // Update planning status to failed
      await this.tasksRepo.updatePlanningStatus(taskId, 'failed');

      return {
        ok: false,
        error: {
          code: 'planning.failed',
          message: error instanceof Error ? error.message : 'Planning failed',
        },
      };
    }
  }

  /**
   * Assess task complexity with a lightweight AI call.
   * Returns the recommended max number of subtasks (2, 4, or 8).
   * Falls back to the config default if the call fails.
   */
  private async assessComplexity(
    task: Task,
    modelConfig: { providerId: string; modelId: string },
  ): Promise<number> {
    try {
      const result = await this.providers.invocation.invoke(
        {
          model: modelConfig.modelId,
          maxTokens: 100,
          messages: [
            {
              role: 'system',
              content:
                'You assess task complexity. Respond with ONLY valid JSON.',
            },
            { role: 'user', content: buildComplexityPrompt(task) },
          ],
        },
        { providerId: modelConfig.providerId },
      );

      if (!result.ok) return PLANNING_AGENT_CONFIG.defaults.maxSubtasks;

      const jsonMatch = result.value.content.match(
        /\{[\s\S]*?"maxSubtasks"\s*:\s*(\d+)[\s\S]*?\}/,
      );
      if (jsonMatch?.[1]) {
        const max = parseInt(jsonMatch[1], 10);
        if (!isNaN(max) && max >= 1 && max <= 10) return max;
      }
    } catch {
      // fall through to default
    }
    return PLANNING_AGENT_CONFIG.defaults.maxSubtasks;
  }

  /**
   * Parse the planning response from AI
   */
  parsePlanningResponse(
    content: string,
    options?: PlanningOptions,
  ): {
    subtasks: PlannedSubtask[];
    deliverable: { type: string; description: string } | null;
  } {
    // The planning prompt asks the model to "return the subtasks as a JSON
    // array", while the system prompt shows an object wrapper that may also
    // carry a `deliverable`. Accept both shapes so the parser is robust to
    // whichever form the model produces.
    let parsed: unknown;

    // Try to extract JSON from a markdown code block first. The block may
    // contain either a top-level array or an object wrapper.
    const codeBlockMatch = content.match(
      /```(?:json)?\s*([[{][\s\S]*[\]}])\s*```/,
    );
    if (codeBlockMatch && codeBlockMatch[1]) {
      try {
        parsed = JSON.parse(codeBlockMatch[1]);
      } catch {
        throw new Error('Failed to parse planning response as JSON');
      }
    } else {
      try {
        parsed = JSON.parse(content);
      } catch {
        // Try to extract a JSON array or object from the response using regex.
        const jsonMatch = content.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            parsed = JSON.parse(jsonMatch[0]);
          } catch {
            throw new Error('Failed to parse planning response as JSON');
          }
        } else {
          throw new Error('Failed to parse planning response as JSON');
        }
      }
    }

    // Normalize to { subtasks, deliverable }. A top-level array is treated as
    // the list of subtasks with no deliverable; an object is expected to carry
    // a `subtasks` array and an optional `deliverable`.
    let rawSubtasks: unknown;
    let rawDeliverable: { type?: string; description?: string } | undefined;
    if (Array.isArray(parsed)) {
      rawSubtasks = parsed;
    } else if (parsed && typeof parsed === 'object') {
      rawSubtasks = (parsed as { subtasks?: unknown }).subtasks;
      rawDeliverable = (
        parsed as {
          deliverable?: { type?: string; description?: string };
        }
      ).deliverable;
    }

    // Validate subtasks array
    if (!Array.isArray(rawSubtasks)) {
      throw new Error('Planning response must be an array');
    }

    // Validate and limit subtasks
    const maxSubtasks =
      options?.maxSubtasks ?? PLANNING_AGENT_CONFIG.defaults.maxSubtasks;

    const subtasks = (rawSubtasks as PlannedSubtask[])
      .slice(0, maxSubtasks)
      .map((s, index) => {
        const result: PlannedSubtask = {
          title: s.title || `Subtask ${index + 1}`,
          description: s.description || '',
          dependencies: Array.isArray(s.dependencies) ? s.dependencies : [],
        };

        if (s.assignedAgentId) {
          result.assignedAgentId = s.assignedAgentId;
        }
        if (s.assignmentReason) {
          result.assignmentReason = s.assignmentReason;
        }

        return result;
      });

    const deliverable =
      rawDeliverable && rawDeliverable.type && rawDeliverable.description
        ? {
            type: rawDeliverable.type,
            description: rawDeliverable.description,
          }
        : null;

    return { subtasks, deliverable };
  }

  /**
   * Create subtasks in the database. Thin adapter converting an
   * AI-generated plan (dependencies as plan-local array indices) into
   * the caller-local-key shape `buildSubtaskGraph` expects, then
   * delegating to it — the same two-pass node/edge creation is also
   * used by workflow template application.
   */
  private async createSubtasks(
    taskId: string,
    planned: PlannedSubtask[],
  ): Promise<void> {
    const nodes = planned.map((subtask, i) => ({
      key: String(i),
      title: subtask.title,
      description: subtask.description,
      orderIndex: i,
      ...(subtask.assignedAgentId && {
        assignedAgentId: subtask.assignedAgentId,
      }),
    }));

    const edges = planned.flatMap((subtask, i) =>
      subtask.dependencies.map((depIndex) => ({
        subtaskKey: String(i),
        dependsOnKey: String(depIndex),
      })),
    );

    await buildSubtaskGraph(this.subtasksRepo, taskId, nodes, edges, logger);
  }
}

/**
 * Create a planning service instance
 */
export function createPlanningService(
  options: PlanningServiceOptions,
): PlanningService {
  return new PlanningService(options);
}
