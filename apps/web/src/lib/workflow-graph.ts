/**
 * Client-side duplicate of the server's cycle-detection algorithm
 * (apps/server/src/tasks/execution/subtask-graph.ts#wouldCreateCycle),
 * used for instant feedback while drag-connecting nodes on the
 * workflow canvas. The server still re-checks authoritatively on
 * POST /tasks/:taskId/subtask-edges — this is UX only.
 */

export function wouldCreateCycle(
  edges: Array<{ subtaskId: string; dependsOnSubtaskId: string }>,
  newEdge: { subtaskId: string; dependsOnSubtaskId: string },
): boolean {
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
