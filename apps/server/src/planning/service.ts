/**
 * Planning Service
 *
 * Service for decomposing tasks into subtasks using an AI planning agent.
 */

import type { ProviderServices } from '../providers';
import type { TasksRepository, SubtasksRepository } from '@openaidy/db';
import type { AgentRegistry } from '../agents';
import { parseModelString } from '../agents/schema';
import {
  PLANNING_AGENT_CONFIG,
  type PlanningOptions,
  type PlannedSubtask,
} from './config';
import { buildPlanningPrompt } from './prompts';

/**
 * Planning service options
 */
export type PlanningServiceOptions = {
  providers: ProviderServices;
  tasksRepo: TasksRepository;
  subtasksRepo: SubtasksRepository;
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
  private readonly agents: AgentRegistry | undefined;
  private readonly getDefaultAgentId: (() => string | undefined) | undefined;

  constructor(options: PlanningServiceOptions) {
    this.providers = options.providers;
    this.tasksRepo = options.tasksRepo;
    this.subtasksRepo = options.subtasksRepo;
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
      // Build prompt
      const prompt = buildPlanningPrompt(task);

      // Resolve model config from default agent or provider
      const modelConfig = this.resolveModelConfig();
      if (!modelConfig) {
        throw new Error(
          'No model configured: set a model on the default agent or configure a default provider',
        );
      }

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
      const subtasks = this.parsePlanningResponse(
        result.value.content,
        options,
      );

      // Create subtasks in database
      await this.createSubtasks(taskId, subtasks);

      // Update planning status to completed
      await this.tasksRepo.updatePlanningStatus(taskId, 'completed');

      return { ok: true, subtasks };
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
   * Parse the planning response from AI
   */
  parsePlanningResponse(
    content: string,
    options?: PlanningOptions,
  ): PlannedSubtask[] {
    let subtasks: PlannedSubtask[];

    try {
      subtasks = JSON.parse(content);
    } catch {
      // Try to extract JSON from response
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        try {
          subtasks = JSON.parse(jsonMatch[0]);
        } catch {
          throw new Error('Failed to parse planning response as JSON');
        }
      } else {
        throw new Error('Failed to parse planning response as JSON');
      }
    }

    // Validate array
    if (!Array.isArray(subtasks)) {
      throw new Error('Planning response must be an array');
    }

    // Validate and limit subtasks
    const maxSubtasks =
      options?.maxSubtasks ?? PLANNING_AGENT_CONFIG.defaults.maxSubtasks;
    return subtasks.slice(0, maxSubtasks).map((s, index) => ({
      title: s.title || `Subtask ${index + 1}`,
      description: s.description || '',
      dependencies: Array.isArray(s.dependencies) ? s.dependencies : [],
    }));
  }

  /**
   * Create subtasks in the database
   */
  private async createSubtasks(
    taskId: string,
    planned: PlannedSubtask[],
  ): Promise<void> {
    // Create subtasks in order, respecting dependencies
    const created = new Map<number, string>();

    for (let i = 0; i < planned.length; i++) {
      const subtask = planned[i];
      if (!subtask) continue;

      // Get parent subtask ID from first dependency if exists
      const parentSubtaskId =
        subtask.dependencies.length > 0 && subtask.dependencies[0] !== undefined
          ? created.get(subtask.dependencies[0])
          : undefined;

      const createdSubtask = await this.subtasksRepo.create({
        taskId,
        ...(parentSubtaskId !== undefined ? { parentSubtaskId } : {}),
        title: subtask.title,
        description: subtask.description,
        orderIndex: i,
      });

      created.set(i, createdSubtask.id);
    }
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
