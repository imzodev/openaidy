import type {
  TasksRepository,
  SubtasksRepository,
  Subtask,
  SubtaskStatus,
} from '@openaidy/db';
import type { AgentRegistry } from '../../agents';
import { createLogger } from '../../lib/logger';
import type { CreateSubtaskInput, ServiceResult } from '../../types';

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
    return { ok: true, data: subtask };
  }

  async getSubtasks(taskId: string): Promise<Subtask[]> {
    return this.subtasksRepo.listByTask(taskId);
  }

  async updateSubtask(
    id: string,
    input: { title?: string; description?: string; orderIndex?: number },
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
    return subtasks.filter((subtask) => {
      if (subtask.status !== 'pending') return false;
      if (!subtask.parentSubtaskId) return true;
      const parent = subtasks.find((s) => s.id === subtask.parentSubtaskId);
      return parent?.status === 'completed';
    });
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
