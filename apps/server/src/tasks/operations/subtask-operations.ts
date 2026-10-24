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
  getDownstreamSubtaskIds,
  isSubtaskExecutable,
  wouldCreateCycle,
} from '../execution/subtask-graph';
import type { WorkflowGraph } from '@openaidy/workflow-templates';
import type { WorkflowGraphOperations } from './workflow-graph-operations';

/** Key used for a node that doesn't exist yet when checking an edit. */
const NEW_NODE_KEY = '\u0000new';

export class SubtaskOperations {
  constructor(
    private readonly tasksRepo: TasksRepository,
    private readonly subtasksRepo: SubtasksRepository,
    private readonly agents: AgentRegistry | undefined,
    private readonly logger: ReturnType<typeof createLogger>,
    private readonly graphOps?: WorkflowGraphOperations,
    private readonly isRunning?: (taskId: string) => Promise<boolean>,
  ) {}

  /**
   * Refuses graph edits while a run is going (the engine is walking the
   * graph), and, given `edit`, any change that would make the graph
   * invalid.
   */
  private async guardEdit(
    taskId: string,
    edit?: (graph: WorkflowGraph) => WorkflowGraph,
  ): Promise<ServiceResult<never> | null> {
    if (this.isRunning && (await this.isRunning(taskId))) {
      return {
        ok: false,
        error: {
          code: 'workflow.locked',
          message:
            'This workflow is running. Stop the run (or wait for it to finish) before changing its steps.',
        },
      };
    }
    if (edit && this.graphOps) {
      const check = await this.graphOps.checkEdit(taskId, edit);
      if (!check.ok) return check;
    }
    return null;
  }

  /**
   * A completed step whose instructions or inputs changed no longer has a
   * result that matches them, and neither does anything downstream that
   * ran off it. Put them back to pending so the next run redoes them.
   * Failed and skipped steps are left as they are, so Retry still works.
   */
  private async invalidateFrom(subtaskId: string): Promise<void> {
    const subtask = await this.subtasksRepo.findById(subtaskId);
    if (!subtask || subtask.status !== 'completed') return;
    const edges = await this.subtasksRepo.listEdgesByTask(subtask.taskId);
    const downstream = getDownstreamSubtaskIds(subtaskId, edges);
    const statuses = new Map(
      (await this.subtasksRepo.listByTask(subtask.taskId)).map((s) => [
        s.id,
        s.status,
      ]),
    );
    const toReset = [subtaskId, ...downstream].filter((id) => {
      const status = statuses.get(id);
      return (
        status === 'completed' || status === 'failed' || status === 'skipped'
      );
    });
    for (const id of toReset) await this.subtasksRepo.resetOne(id);
    this.logger.info('Reset an edited step and the steps after it', {
      subtaskId,
      resetCount: toReset.length,
    });
  }

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
    const blocked = await this.guardEdit(input.taskId, (graph) => ({
      nodes: [
        ...graph.nodes,
        {
          key: NEW_NODE_KEY,
          title: input.title,
          description: input.description,
          kind: input.subtaskKind ?? 'agent',
          loop: input.loop ?? null,
        },
      ],
      edges: [
        ...graph.edges,
        ...(input.dependsOn ?? []).map((from) => ({ from, to: NEW_NODE_KEY })),
      ],
    }));
    if (blocked) return blocked;
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

    // Approval steps can't loop, so turning a step into one drops its loop.
    if (input.subtaskKind === 'approval_gate' && input.loop === undefined) {
      input = { ...input, loop: null };
    }

    const blocked = await this.guardEdit(existing.taskId, (graph) => ({
      ...graph,
      nodes: graph.nodes.map((node) =>
        node.key === id
          ? {
              ...node,
              ...(input.title !== undefined && { title: input.title }),
              ...(input.description !== undefined && {
                description: input.description,
              }),
              ...(input.subtaskKind !== undefined && {
                kind: input.subtaskKind,
              }),
              ...(input.loop !== undefined && { loop: input.loop }),
            }
          : node,
      ),
    }));
    if (blocked) return blocked;

    // Changing what a step does, after it already ran, means its old
    // result (and anything downstream that ran off it) is stale.
    const changed =
      (input.description !== undefined &&
        input.description !== existing.description) ||
      (input.title !== undefined && input.title !== existing.title) ||
      (input.subtaskKind !== undefined &&
        input.subtaskKind !== existing.subtaskKind) ||
      input.loop !== undefined;
    if (changed) await this.invalidateFrom(id);

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
    const blocked = await this.guardEdit(existing.taskId);
    if (blocked) return blocked;
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

    const blocked = await this.guardEdit(taskId, (graph) => ({
      ...graph,
      edges: [
        ...graph.edges,
        {
          from: input.dependsOnSubtaskId,
          to: input.subtaskId,
          edgeKind: input.edgeKind ?? 'dependency',
          conditionOperator: input.condition?.operator ?? null,
          conditionValue: input.condition?.value ?? null,
        },
      ],
    }));
    if (blocked) return blocked;

    const edge = await this.subtasksRepo.addEdge(input);
    await this.invalidateFrom(input.subtaskId);
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
    const existing = await this.subtasksRepo.findEdgeById(id);
    const owner = existing
      ? await this.subtasksRepo.findById(existing.subtaskId)
      : null;
    if (!existing || !owner) {
      return {
        ok: false,
        error: { code: 'edge.not_found', message: `Edge "${id}" not found` },
      };
    }
    const blocked = await this.guardEdit(owner.taskId, (graph) => ({
      ...graph,
      edges: graph.edges.map((edge) => {
        if (
          edge.from !== existing.dependsOnSubtaskId ||
          edge.to !== existing.subtaskId
        ) {
          return edge;
        }
        const edgeKind = input.edgeKind ?? edge.edgeKind ?? null;
        const condition =
          input.condition === undefined
            ? edge.conditionOperator
              ? {
                  operator: edge.conditionOperator,
                  value: edge.conditionValue ?? '',
                }
              : null
            : input.condition;
        return {
          ...edge,
          edgeKind,
          conditionOperator:
            edgeKind === 'conditional' ? (condition?.operator ?? null) : null,
          conditionValue:
            edgeKind === 'conditional' ? (condition?.value ?? null) : null,
        };
      }),
    }));
    if (blocked) return blocked;

    const updated = await this.subtasksRepo.updateEdge(id, input);
    if (!updated) {
      return {
        ok: false,
        error: { code: 'edge.not_found', message: `Edge "${id}" not found` },
      };
    }
    await this.invalidateFrom(updated.subtaskId);
    return { ok: true, data: updated };
  }

  async deleteSubtaskEdge(id: string): Promise<ServiceResult<true>> {
    const existing = await this.subtasksRepo.findEdgeById(id);
    const owner = existing
      ? await this.subtasksRepo.findById(existing.subtaskId)
      : null;
    if (owner) {
      const blocked = await this.guardEdit(owner.taskId);
      if (blocked) return blocked;
    }
    const deleted = await this.subtasksRepo.deleteEdge(id);
    if (!deleted) {
      return {
        ok: false,
        error: { code: 'edge.not_found', message: `Edge "${id}" not found` },
      };
    }
    await this.invalidateFrom(deleted.subtaskId);
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
    agentId: string | null,
  ): Promise<ServiceResult<Subtask>> {
    const existing = await this.subtasksRepo.findById(id);
    if (existing) {
      const blocked = await this.guardEdit(existing.taskId);
      if (blocked) return blocked;
    }
    if (agentId && this.agents && !this.agents.getAgent(agentId)) {
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
