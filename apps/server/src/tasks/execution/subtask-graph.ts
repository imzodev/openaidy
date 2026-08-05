/**
 * Pure helpers over the subtask dependency graph (subtask_edges).
 * Shared between task execution and subtask operations so gating and
 * context handoff always agree on the same dependency semantics.
 */

import type { Subtask } from '@openaidy/db';

export type SubtaskDependencyEdge = {
  subtaskId: string;
  dependsOnSubtaskId: string;
};

/**
 * A subtask is executable once every subtask it depends on has
 * reached `completed`. A subtask with no incoming edges is always
 * executable (subject to its own status already being `pending`,
 * which callers check separately).
 */
export function isSubtaskExecutable(
  subtask: Subtask,
  allSubtasks: Subtask[],
  edges: SubtaskDependencyEdge[],
): boolean {
  const dependsOnIds = edges
    .filter((e) => e.subtaskId === subtask.id)
    .map((e) => e.dependsOnSubtaskId);
  if (dependsOnIds.length === 0) return true;

  const byId = new Map(allSubtasks.map((s) => [s.id, s]));
  return dependsOnIds.every((depId) => byId.get(depId)?.status === 'completed');
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
