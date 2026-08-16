import type { SubtasksRepository } from '@openaidy/db';
import type {
  ConditionOperator,
  LoopConfig,
  SubtaskKind,
} from '@openaidy/shared-types';
import type { createLogger } from '../lib/logger';

/**
 * One node to create in a subtask graph. `key` is caller-local (an AI
 * plan's array index, or a workflow template's node key) — not a real
 * subtask id — and is resolved to one as the graph is built.
 */
export type GraphNodeInput = {
  key: string;
  title: string;
  description: string;
  orderIndex?: number;
  assignedAgentId?: string;
  subtaskKind?: SubtaskKind;
  loop?: LoopConfig | null;
};

/**
 * One dependency edge to create, referencing two `GraphNodeInput` keys.
 * `subtaskKey` is the dependent node; `dependsOnKey` is the node it
 * depends on — matching `SubtasksRepository.addEdge`'s
 * `subtaskId`/`dependsOnSubtaskId` naming.
 */
export type GraphEdgeInput = {
  subtaskKey: string;
  dependsOnKey: string;
  edgeKind?: 'dependency' | 'conditional';
  conditionOperator?: ConditionOperator;
  conditionValue?: string;
};

/**
 * Create a whole subtask graph (nodes, then dependency/conditional
 * edges) for a task in two passes — nodes first, so an edge can
 * reference a node defined later in the list, then edges once every
 * node has a real id. Shared by `PlanningService` (AI-generated graphs)
 * and workflow template application (pre-built graphs) so both go
 * through the same key-resolution and dangling-reference handling.
 *
 * Silently skips (and logs a warning for) self-edges and edges whose
 * `subtaskKey`/`dependsOnKey` doesn't match a created node — the same
 * defensive behavior the original AI-planning path had, since a
 * malformed plan/template shouldn't abort the whole graph.
 */
export async function buildSubtaskGraph(
  subtasksRepo: SubtasksRepository,
  taskId: string,
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
  logger: ReturnType<typeof createLogger>,
): Promise<void> {
  const created = new Map<string, string>();

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (!node) continue;

    const createInput: {
      taskId: string;
      title: string;
      description: string;
      orderIndex: number;
      assignedAgentId?: string;
      subtaskKind?: SubtaskKind;
      loop?: LoopConfig | null;
    } = {
      taskId,
      title: node.title,
      description: node.description,
      orderIndex: node.orderIndex ?? i,
    };
    if (node.assignedAgentId)
      createInput.assignedAgentId = node.assignedAgentId;
    if (node.subtaskKind) createInput.subtaskKind = node.subtaskKind;
    if (node.loop !== undefined) createInput.loop = node.loop;

    const createdSubtask = await subtasksRepo.create(createInput);
    created.set(node.key, createdSubtask.id);
  }

  // Group edges by their dependent node, preserving input order, so a
  // node whose edges are *all* plain dependencies can still go through
  // `addEdges` — the single bulk-insert call the AI-planning path has
  // always used (and its tests assert on) — rather than one `addEdge`
  // call per edge. Only nodes with a conditional edge need the richer
  // singular `addEdge` (it's the only repo method carrying condition
  // data), so templates pay for that per-edge cost only where it matters.
  const edgesBySubtaskKey = new Map<string, GraphEdgeInput[]>();
  for (const edge of edges) {
    if (edge.subtaskKey === edge.dependsOnKey) continue; // ignore self-edges
    const bucket = edgesBySubtaskKey.get(edge.subtaskKey);
    if (bucket) bucket.push(edge);
    else edgesBySubtaskKey.set(edge.subtaskKey, [edge]);
  }

  for (const [subtaskKey, subtaskEdges] of edgesBySubtaskKey) {
    const subtaskId = created.get(subtaskKey);
    if (!subtaskId) {
      logger.warn(
        'Graph edge references a node key that was not created; skipping edges',
        { taskId, subtaskKey },
      );
      continue;
    }

    const allPlainDependency = subtaskEdges.every(
      (edge) => (edge.edgeKind ?? 'dependency') === 'dependency',
    );

    if (allPlainDependency) {
      const dependsOnIds: string[] = [];
      for (const edge of subtaskEdges) {
        const dependsOnSubtaskId = created.get(edge.dependsOnKey);
        if (!dependsOnSubtaskId) {
          logger.warn(
            'Graph edge references a node key that was not created; skipping edge',
            { taskId, subtaskKey, dependsOnKey: edge.dependsOnKey },
          );
          continue;
        }
        dependsOnIds.push(dependsOnSubtaskId);
      }
      if (dependsOnIds.length > 0) {
        await subtasksRepo.addEdges(subtaskId, dependsOnIds);
      }
      continue;
    }

    for (const edge of subtaskEdges) {
      const dependsOnSubtaskId = created.get(edge.dependsOnKey);
      if (!dependsOnSubtaskId) {
        logger.warn(
          'Graph edge references a node key that was not created; skipping edge',
          { taskId, subtaskKey, dependsOnKey: edge.dependsOnKey },
        );
        continue;
      }
      await subtasksRepo.addEdge({
        subtaskId,
        dependsOnSubtaskId,
        edgeKind: edge.edgeKind,
        condition:
          edge.conditionOperator && edge.conditionValue
            ? { operator: edge.conditionOperator, value: edge.conditionValue }
            : undefined,
      });
    }
  }
}
