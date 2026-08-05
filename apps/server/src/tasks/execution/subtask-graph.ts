/**
 * Pure helpers over the subtask dependency graph (subtask_edges).
 * Shared between task execution and subtask operations so gating and
 * context handoff always agree on the same dependency semantics.
 */

import type { Subtask } from '@openaidy/db';

export type ConditionOperator = 'equals' | 'contains' | 'matches_regex';

export type EdgeCondition = {
  operator: ConditionOperator;
  value: string;
};

// Flat shape matching SubtasksRepository.listEdgesByTask()'s columns
// directly, so callers can pass its result straight through without an
// adapter step.
export type SubtaskDependencyEdge = {
  subtaskId: string;
  dependsOnSubtaskId: string;
  edgeKind?: string;
  conditionOperator?: string | null;
  conditionValue?: string | null;
};

const OUTCOME_TAG_RE = /^OUTCOME:\s*(.+)$/im;

/**
 * Pull the structured `OUTCOME: <tag>` line out of a subtask result
 * (see subtaskNeedsOutcomeTag), falling back to the raw result text
 * when the agent didn't emit one.
 */
export function extractOutcome(result: string | null | undefined): string {
  if (!result) return '';
  const match = result.match(OUTCOME_TAG_RE);
  return (match?.[1] ?? result).trim();
}

/**
 * Evaluate a conditional edge's condition against its upstream
 * dependency's result. Case-insensitive; an invalid regex never
 * matches (fails closed rather than throwing).
 */
export function evaluateCondition(
  result: string | null | undefined,
  condition: EdgeCondition,
): boolean {
  const outcome = extractOutcome(result);
  switch (condition.operator) {
    case 'equals':
      return outcome.toLowerCase() === condition.value.trim().toLowerCase();
    case 'contains':
      return outcome.toLowerCase().includes(condition.value.toLowerCase());
    case 'matches_regex':
      try {
        return new RegExp(condition.value, 'i').test(outcome);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

/**
 * A subtask is executable once every subtask it depends on satisfies
 * its edge: a plain `dependency` edge requires the dependency to have
 * reached `completed`; a `conditional` edge additionally requires
 * `evaluateCondition` against the dependency's result. A subtask with
 * no incoming edges is always executable (subject to its own status
 * already being `pending`, which callers check separately). An unmet
 * condition simply never satisfies that edge — same silent
 * branch-halt semantics as a failed plain dependency.
 */
export function isSubtaskExecutable(
  subtask: Subtask,
  allSubtasks: Subtask[],
  edges: SubtaskDependencyEdge[],
): boolean {
  const dependsOn = edges.filter((e) => e.subtaskId === subtask.id);
  if (dependsOn.length === 0) return true;

  const byId = new Map(allSubtasks.map((s) => [s.id, s]));
  return dependsOn.every((edge) => {
    const dep = byId.get(edge.dependsOnSubtaskId);
    if (dep?.status !== 'completed') return false;
    if (edge.edgeKind === 'conditional' && edge.conditionOperator) {
      return evaluateCondition(dep.result, {
        operator: edge.conditionOperator as ConditionOperator,
        value: edge.conditionValue ?? '',
      });
    }
    return true;
  });
}

/**
 * DFS check for whether adding `newEdge` (subtaskId depends on
 * dependsOnSubtaskId) would create a cycle in the existing edge set.
 * Run before persisting a new edge via the edge-CRUD API.
 */
export function wouldCreateCycle(
  edges: SubtaskDependencyEdge[],
  newEdge: { subtaskId: string; dependsOnSubtaskId: string },
): boolean {
  // edge = "subtaskId depends on dependsOnSubtaskId", i.e. an arrow
  // pointing backward from subtaskId to dependsOnSubtaskId. Adding
  // subtaskId -> dependsOnSubtaskId creates a cycle iff
  // dependsOnSubtaskId can already reach subtaskId by following
  // existing edges forward (dependsOnSubtaskId -> ... -> subtaskId).
  const forward = new Map<string, string[]>();
  for (const e of edges) {
    const list = forward.get(e.dependsOnSubtaskId);
    if (list) list.push(e.subtaskId);
    else forward.set(e.dependsOnSubtaskId, [e.subtaskId]);
  }

  const stack = [newEdge.subtaskId];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === newEdge.dependsOnSubtaskId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    stack.push(...(forward.get(current) ?? []));
  }
  return false;
}

/**
 * True when `subtask` should be asked to end its final message with
 * an `OUTCOME: <tag>` line — either because a downstream conditional
 * edge branches on its result, or because it's a bounded self-loop
 * whose own convergence condition is evaluated the same way.
 */
export function subtaskNeedsOutcomeTag(
  subtask: Subtask,
  edges: SubtaskDependencyEdge[],
): boolean {
  const hasOutgoingConditional = edges.some(
    (e) => e.dependsOnSubtaskId === subtask.id && e.edgeKind === 'conditional',
  );
  return (
    hasOutgoingConditional ||
    (subtask as { loopMaxIterations?: number | null }).loopMaxIterations != null
  );
}

/**
 * The subtasks `subtask` actually depends on, in the order the edges
 * were declared. Used to scope context handoff to real dependencies
 * instead of every completed subtask in the task.
 */
export function getDependencySubtasks(
  subtask: Subtask,
  allSubtasks: Subtask[],
  edges: SubtaskDependencyEdge[],
): Subtask[] {
  const byId = new Map(allSubtasks.map((s) => [s.id, s]));
  return edges
    .filter((e) => e.subtaskId === subtask.id)
    .map((e) => byId.get(e.dependsOnSubtaskId))
    .filter((s): s is Subtask => Boolean(s));
}
