import type { SubtasksRepository, TasksRepository } from '@openaidy/db';
import type { ConditionOperator, SubtaskKind } from '@openaidy/shared-types';
import {
  newGraphErrors,
  validateWorkflowGraph,
  type WorkflowGraph,
  type WorkflowGraphCheck,
  type WorkflowGraphIssue,
} from '@openaidy/workflow-templates';
import type { AgentRegistry } from '../../agents';
import type { createLogger } from '../../lib/logger';
import type { ServiceResult } from '../../types';
import { deriveTitleFromDescription } from '../derive-title';

export type SetGraphResult = {
  /** Each input node key and the id of the step created for it. */
  nodes: Array<{ key: string; id: string; title: string }>;
  edgeCount: number;
  warnings: WorkflowGraphIssue[];
};

function invalidGraph<T>(
  issues: WorkflowGraphIssue[],
  intro = 'The workflow graph has problems',
): ServiceResult<T> {
  return {
    ok: false,
    error: {
      code: 'workflow.invalid_graph',
      message: `${intro}:\n${issues.map((i) => `- ${i.message}`).join('\n')}`,
      details: { issues },
    },
  };
}

/**
 * Whole-graph reads and writes for workflows, all checked by the shared
 * `validateWorkflowGraph` so the REST routes, agent tools, templates and
 * editor agree on what a valid workflow is.
 */
export class WorkflowGraphOperations {
  constructor(
    private readonly tasksRepo: TasksRepository,
    private readonly subtasksRepo: SubtasksRepository,
    private readonly agents: AgentRegistry | undefined,
    private readonly logger: ReturnType<typeof createLogger>,
  ) {}

  /** The task's current graph, keyed by subtask id. */
  async loadGraph(taskId: string): Promise<WorkflowGraph> {
    const [subtasks, edges] = await Promise.all([
      this.subtasksRepo.listByTask(taskId),
      this.subtasksRepo.listEdgesByTaskFull(taskId),
    ]);
    return {
      nodes: subtasks.map((s) => ({
        key: s.id,
        title: s.title,
        description: s.description,
        kind: s.subtaskKind,
        agentId: s.assignedAgentId,
        loop:
          s.loopMaxIterations != null
            ? {
                maxIterations: s.loopMaxIterations,
                conditionOperator: s.loopConditionOperator ?? '',
                conditionValue: s.loopConditionValue ?? '',
              }
            : null,
      })),
      edges: edges.map((e) => ({
        from: e.dependsOnSubtaskId,
        to: e.subtaskId,
        edgeKind: e.edgeKind,
        conditionOperator: e.conditionOperator,
        conditionValue: e.conditionValue,
      })),
    };
  }

  private knownAgentIds(): string[] | undefined {
    return this.agents?.listAgents().map((a) => a.id);
  }

  validate(
    graph: WorkflowGraph,
    options: { allowEmpty?: boolean } = {},
  ): WorkflowGraphCheck {
    const knownAgentIds = this.knownAgentIds();
    return validateWorkflowGraph(graph, {
      ...(knownAgentIds ? { knownAgentIds } : {}),
      ...(options.allowEmpty !== undefined
        ? { allowEmpty: options.allowEmpty }
        : {}),
    });
  }

  /** Everything that would stop the workflow from running as built. */
  async checkTask(taskId: string): Promise<ServiceResult<WorkflowGraphCheck>> {
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
    const graph = await this.loadGraph(taskId);
    return { ok: true, data: this.validate(graph, { allowEmpty: false }) };
  }

  /**
   * Checks a single edit: `edit` returns the graph as it would be after
   * the change. Only problems the edit introduces are reported, so an
   * unrelated, older problem elsewhere doesn't block every change.
   */
  async checkEdit(
    taskId: string,
    edit: (graph: WorkflowGraph) => WorkflowGraph,
  ): Promise<ServiceResult<true>> {
    const before = await this.loadGraph(taskId);
    const introduced = newGraphErrors(
      this.validate(before),
      this.validate(edit(before)),
    );
    if (introduced.length === 0) return { ok: true, data: true };
    return invalidGraph(introduced, "That change isn't valid");
  }

  /**
   * Resolves a node's `agentId` given as an agent id or (case-insensitive)
   * name to the agent id, so agents can write `"agent": "Writer"`.
   */
  resolveAgentRefs(graph: WorkflowGraph): WorkflowGraph {
    if (!this.agents) return graph;
    const agents = this.agents.listAgents();
    return {
      ...graph,
      nodes: graph.nodes.map((node) => {
        const ref = node.agentId?.trim();
        if (!ref) return { ...node, agentId: null };
        const match =
          agents.find((a) => a.id === ref) ??
          agents.find((a) => a.name.toLowerCase() === ref.toLowerCase());
        return match ? { ...node, agentId: match.id } : node;
      }),
    };
  }

  /** Validates a graph that isn't saved anywhere yet. */
  checkGraph(graph: WorkflowGraph): WorkflowGraphCheck {
    return this.validate(this.resolveAgentRefs(graph));
  }

  /**
   * Replaces the task's whole graph with `graph`. The new graph is
   * validated first; nothing is written if it has errors. The new steps are
   * created before the old ones are deleted, and a failure part-way removes
   * what was created, so the task never ends up with half a graph.
   */
  async setGraph(
    taskId: string,
    input: WorkflowGraph,
    options: { dryRun?: boolean } = {},
  ): Promise<ServiceResult<SetGraphResult>> {
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
    const graph = this.resolveAgentRefs(input);
    const check = this.validate(graph);
    if (!check.ok) return invalidGraph(check.errors);

    const preview = graph.nodes.map((node) => ({
      key: node.key,
      id: '',
      title: nodeTitle(node),
    }));
    if (options.dryRun) {
      return {
        ok: true,
        data: {
          nodes: preview,
          edgeCount: graph.edges.length,
          warnings: check.warnings,
        },
      };
    }

    const replaced = await this.replaceGraph(taskId, async () => {
      const ids = new Map<string, string>();
      for (const [index, node] of graph.nodes.entries()) {
        const created = await this.subtasksRepo.create({
          taskId,
          title: nodeTitle(node),
          description: node.description?.trim() ?? '',
          orderIndex: index,
          subtaskKind: (node.kind ?? 'agent') as SubtaskKind,
          ...(node.agentId ? { assignedAgentId: node.agentId } : {}),
          ...(node.loop
            ? {
                loop: {
                  maxIterations: node.loop.maxIterations,
                  conditionOperator: node.loop
                    .conditionOperator as ConditionOperator,
                  conditionValue: node.loop.conditionValue,
                },
              }
            : {}),
        });
        ids.set(node.key, created.id);
      }
      for (const edge of graph.edges) {
        const conditional = (edge.edgeKind ?? 'dependency') === 'conditional';
        await this.subtasksRepo.addEdge({
          subtaskId: ids.get(edge.to)!,
          dependsOnSubtaskId: ids.get(edge.from)!,
          edgeKind: conditional ? 'conditional' : 'dependency',
          ...(conditional
            ? {
                condition: {
                  operator: edge.conditionOperator!,
                  value: edge.conditionValue!,
                },
              }
            : {}),
        });
      }
      return { ok: true as const, data: ids };
    });
    if (!replaced.ok) return replaced;

    return {
      ok: true,
      data: {
        nodes: preview.map((node) => ({
          ...node,
          id: replaced.data.get(node.key)!,
        })),
        edgeCount: graph.edges.length,
        warnings: check.warnings,
      },
    };
  }

  /**
   * Runs `build` to add a new graph next to the existing one, then deletes
   * the old steps. If `build` fails (returns an error or throws), the steps
   * it created are removed instead and the old graph stays as it was.
   * (Deleting a step cascades to its edges.)
   */
  async replaceGraph<T>(
    taskId: string,
    build: () => Promise<ServiceResult<T>>,
  ): Promise<ServiceResult<T>> {
    const oldIds = new Set(
      (await this.subtasksRepo.listByTask(taskId)).map((s) => s.id),
    );
    const rollback = async () => {
      const created = (await this.subtasksRepo.listByTask(taskId)).filter(
        (s) => !oldIds.has(s.id),
      );
      for (const subtask of created) await this.subtasksRepo.delete(subtask.id);
    };

    let result: ServiceResult<T>;
    try {
      result = await build();
    } catch (err) {
      await rollback();
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error('Replacing a workflow graph failed; rolled back', {
        taskId,
        error: message,
      });
      return {
        ok: false,
        error: {
          code: 'workflow.write_failed',
          message: `Saving the workflow failed, so nothing was changed: ${message}`,
        },
      };
    }
    if (!result.ok) {
      await rollback();
      return result;
    }
    for (const id of oldIds) await this.subtasksRepo.delete(id);
    return result;
  }

  async savePositions(
    taskId: string,
    positions: Record<string, { x: number; y: number }>,
  ): Promise<ServiceResult<{ updated: number }>> {
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
    const updated = await this.subtasksRepo.setPositions(taskId, positions);
    return { ok: true, data: { updated } };
  }
}

function nodeTitle(node: WorkflowGraph['nodes'][number]): string {
  const title = node.title?.trim();
  if (title) return title;
  const description = node.description?.trim();
  if (description) return deriveTitleFromDescription(description);
  return node.kind === 'approval_gate' ? 'Approval' : node.key;
}
