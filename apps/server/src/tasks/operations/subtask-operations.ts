import type {
  TasksRepository,
  SubtasksRepository,
  Subtask,
  SubtaskEdge,
  SubtaskStatus,
} from '@openaidy/db';
import type { AgentRegistry } from '../../agents';
import { createLogger } from '../../lib/logger';
import type {
  CreateSubtaskInput,
  UpdateSubtaskInput,
  ServiceResult,
} from '../../types';
import {
  isSubtaskExecutable,
  wouldCreateCycle,
} from '../execution/subtask-graph';

export class SubtaskOperations {
  constructor(
    private readonly tasksRepo: TasksRepository,
    private readonly subtasksRepo: SubtasksRepository,
    private readonly agents: AgentRegistry | undefined,
    private readonly logger: ReturnType<typeof createLogger>,
  ) {}

  async createSubtask(
    input: CreateSubtaskInput,
  ): Promise<ServiceResult<Subtask>> {
    const existing = await this.tasksRepo.findById(input.taskId);
    if (!existing) {
      return {
        ok: false,
        error: {
          code: 'task.not_found',
          message: `Task "${input.taskId}" not found`,
        },
      };
    }
    if (input.assignedAgentId && this.agents) {
      if (!this.agents.getAgent(input.assignedAgentId)) {
        return {
          ok: false,
          error: {
            code: 'agent.not_found',
            message: `Agent "${input.assignedAgentId}" not found`,
          },
        };
      }
    }
    const subtask = await this.subtasksRepo.create(input);
    if (input.dependsOn && input.dependsOn.length > 0) {
      await this.subtasksRepo.addEdges(subtask.id, input.dependsOn);
    }
    return { ok: true, data: subtask };
  }

  async getSubtasks(
    taskId: string,
  ): Promise<(Subtask & { dependsOnSubtaskIds: string[] })[]> {
    const [subtasks, edges] = await Promise.all([
      this.subtasksRepo.listByTask(taskId),
      this.subtasksRepo.listEdgesByTask(taskId),
    ]);
    return subtasks.map((subtask) => ({
      ...subtask,
      dependsOnSubtaskIds: edges
        .filter((e) => e.subtaskId === subtask.id)
        .map((e) => e.dependsOnSubtaskId),
    }));
  }

  async getSubtask(id: string): Promise<Subtask | null> {
    return this.subtasksRepo.findById(id);
  }

  async getSubtaskEdge(id: string): Promise<SubtaskEdge | null> {
    return this.subtasksRepo.findEdgeById(id);
  }

  async updateSubtask(
    id: string,
    input: UpdateSubtaskInput,
  ): Promise<ServiceResult<Subtask>> {
    const existing = await this.subtasksRepo.findById(id);
    if (!existing) {
      return {
        ok: false,
        error: {
          code: 'subtask.not_found',
          message: `Subtask "${id}" not found`,
        },
      };
    }

    // Editing what a step should do, after it already ran, means its old
    // result no longer reflects the current instructions — and any
    // dependent subtask that already ran off that result got stale
    // context. Without this, the subtask stays `completed`/`failed`
    // forever and executeSubtasks() silently skips it on every future
    // run, so the edit never actually takes effect.
    const contentChanged =
      (input.description !== undefined &&
        input.description !== existing.description) ||
      (input.title !== undefined && input.title !== existing.title);
    const isTerminal =
      existing.status === 'completed' || existing.status === 'failed';
    if (contentChanged && isTerminal) {
      await this.subtasksRepo.resetOne(id);
      this.logger.info(
        'Reset terminal subtask to pending after a content edit',
        { subtaskId: id, previousStatus: existing.status },
      );
    }

    const updated = await this.subtasksRepo.update(id, input);
    return { ok: true, data: updated! };
  }

  async deleteSubtask(id: string): Promise<ServiceResult<true>> {
    const existing = await this.subtasksRepo.findById(id);
    if (!existing) {
      return {
        ok: false,
        error: {
          code: 'subtask.not_found',
          message: `Subtask "${id}" not found`,
        },
      };
    }
    await this.subtasksRepo.delete(id);
    return { ok: true, data: true };
  }

  async listSubtaskEdges(taskId: string): Promise<
    ServiceResult<
      Array<{
        id: string;
        subtaskId: string;
        dependsOnSubtaskId: string;
        edgeKind: string;
        conditionOperator: string | null;
        conditionValue: string | null;
        createdAt: Date;
      }>
    >
  > {
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
    const edges = await this.subtasksRepo.listEdgesByTaskFull(taskId);
    return { ok: true, data: edges };
  }

  async createSubtaskEdge(
    taskId: string,
    input: {
      subtaskId: string;
      dependsOnSubtaskId: string;
      edgeKind?: 'dependency' | 'conditional' | undefined;
      condition?: { operator: string; value: string } | null | undefined;
    },
  ): Promise<ServiceResult<SubtaskEdge>> {
    if (input.subtaskId === input.dependsOnSubtaskId) {
      return {
        ok: false,
        error: {
          code: 'edge.self_edge',
          message: 'A subtask cannot depend on itself',
        },
      };
    }
    if (input.edgeKind === 'conditional' && !input.condition) {
      return {
        ok: false,
        error: {
          code: 'edge.condition_required',
          message: 'A conditional edge requires a condition',
        },
      };
    }

    const subtasks = await this.subtasksRepo.listByTask(taskId);
    const subtaskIds = new Set(subtasks.map((s) => s.id));
    if (
      !subtaskIds.has(input.subtaskId) ||
      !subtaskIds.has(input.dependsOnSubtaskId)
    ) {
      return {
        ok: false,
        error: {
          code: 'subtask.not_found',
          message: 'Both subtasks must belong to the given task',
        },
      };
    }

    const existingEdges = await this.subtasksRepo.listEdgesByTask(taskId);
    if (wouldCreateCycle(existingEdges, input)) {
      return {
        ok: false,
        error: {
          code: 'edge.would_create_cycle',
          message: 'Adding this edge would create a cycle in the subtask graph',
        },
      };
    }

    const edge = await this.subtasksRepo.addEdge(input);
    return { ok: true, data: edge };
  }

  async updateSubtaskEdge(
    id: string,
    input: {
      edgeKind?: 'dependency' | 'conditional' | undefined;
      condition?: { operator: string; value: string } | null | undefined;
    },
  ): Promise<ServiceResult<SubtaskEdge>> {
    if (input.edgeKind === 'conditional' && input.condition === null) {
      return {
        ok: false,
        error: {
          code: 'edge.condition_required',
          message: 'A conditional edge requires a condition',
        },
      };
    }
    const updated = await this.subtasksRepo.updateEdge(id, input);
    if (!updated) {
      return {
        ok: false,
        error: { code: 'edge.not_found', message: `Edge "${id}" not found` },
      };
    }
    return { ok: true, data: updated };
  }

  async deleteSubtaskEdge(id: string): Promise<ServiceResult<true>> {
    const deleted = await this.subtasksRepo.deleteEdge(id);
    if (!deleted) {
      return {
        ok: false,
        error: { code: 'edge.not_found', message: `Edge "${id}" not found` },
      };
    }
    return { ok: true, data: true };
  }

  async updateSubtaskStatus(
    id: string,
    status: SubtaskStatus,
  ): Promise<ServiceResult<Subtask>> {
    const updated = await this.subtasksRepo.updateStatus(id, status);
    if (!updated) {
      return {
        ok: false,
        error: {
          code: 'subtask.not_found',
          message: `Subtask "${id}" not found`,
        },
      };
    }
    return { ok: true, data: updated };
  }

  async assignSubtaskAgent(
    id: string,
    agentId: string,
  ): Promise<ServiceResult<Subtask>> {
    if (this.agents && !this.agents.getAgent(agentId)) {
      return {
        ok: false,
        error: {
          code: 'agent.not_found',
          message: `Agent "${agentId}" not found`,
        },
      };
    }
    const updated = await this.subtasksRepo.assignAgent(id, agentId);
    if (!updated) {
      return {
        ok: false,
        error: {
          code: 'subtask.not_found',
          message: `Subtask "${id}" not found`,
        },
      };
    }
    return { ok: true, data: updated };
  }

  async setSubtaskResult(
    id: string,
    result: string,
  ): Promise<ServiceResult<Subtask>> {
    const updated = await this.subtasksRepo.setResult(id, result);
    if (!updated) {
      return {
        ok: false,
        error: {
          code: 'subtask.not_found',
          message: `Subtask "${id}" not found`,
        },
      };
    }
    return { ok: true, data: updated };
  }

  async getTaskProgress(taskId: string): Promise<{
    total: number;
    completed: number;
    inProgress: number;
    failed: number;
    pending: number;
  }> {
    const counts = await this.subtasksRepo.getCountsByStatus(taskId);
    return {
      total: Object.values(counts).reduce((a, b) => a + b, 0),
      completed: counts.completed,
      inProgress: counts.in_progress,
      failed: counts.failed,
      pending: counts.pending + counts.assigned,
    };
  }

  async getNextExecutableSubtasks(taskId: string): Promise<Subtask[]> {
    const subtasks = await this.subtasksRepo.listByTask(taskId);
    const edges = await this.subtasksRepo.listEdgesByTask(taskId);
    return subtasks
      .filter((s) => s.status === 'pending')
      .filter((subtask) => isSubtaskExecutable(subtask, subtasks, edges));
  }

  async getSubtaskBySessionId(
    sessionId: string,
  ): Promise<ServiceResult<Subtask>> {
    const tasks = await this.tasksRepo.list();
    for (const task of tasks) {
      const subtasks = await this.subtasksRepo.listByTask(task.id);
      const found = subtasks.find((s) => s.sessionId === sessionId);
      if (found) return { ok: true, data: found };
    }
    return {
      ok: false,
      error: {
        code: 'subtask.not_found',
        message: `No subtask found linked to session "${sessionId}"`,
      },
    };
  }

  async getTaskSession(
    taskId: string,
  ): Promise<ServiceResult<{ sessionId: string | null }>> {
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
    return { ok: true, data: { sessionId: task.sessionId } };
  }

  async getSubtaskSession(
    subtaskId: string,
  ): Promise<ServiceResult<{ sessionId: string | null }>> {
    const subtask = await this.subtasksRepo.findById(subtaskId);
    if (!subtask) {
      return {
        ok: false,
        error: {
          code: 'subtask.not_found',
          message: `Subtask "${subtaskId}" not found`,
        },
      };
    }
    return { ok: true, data: { sessionId: subtask.sessionId } };
  }
}
