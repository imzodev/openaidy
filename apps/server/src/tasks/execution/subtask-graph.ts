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

const OUTCOME_TAG_RE = /^OUTCOME:\s*(.+)$/gim;
// When an agent doesn't emit an OUTCOME tag, extractOutcome falls back to
// the raw result text as the condition operand. Cap that fallback so a
// large (potentially MB-scale) result can't become the operand wholesale.
const OUTCOME_FALLBACK_MAX_CHARS = 2000;

/**
 * Pull the structured `OUTCOME: <tag>` line out of a subtask result
 * (see subtaskNeedsOutcomeTag) — the last one when there are several —
 * falling back to the raw result text
 * (capped to OUTCOME_FALLBACK_MAX_CHARS) when the agent didn't emit one.
 */
export function extractOutcome(result: string | null | undefined): string {
  if (!result) return '';
  // The agent is asked to END with the tag, so the last one wins (an
  // earlier OUTCOME line may just be quoted context).
  const tags = [...result.matchAll(OUTCOME_TAG_RE)];
  const last = tags[tags.length - 1]?.[1]?.trim();
  if (last) return last;
  return result.slice(0, OUTCOME_FALLBACK_MAX_CHARS).trim();
}

/**
 * Evaluate a conditional edge's condition against its upstream
 * dependency's result. All three operators are deliberately
 * case-insensitive for consistency — `equals`/`contains` via explicit
 * `toLowerCase()`, `matches_regex` via the `i` flag. An invalid regex
 * never matches (fails closed rather than throwing).
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
      return outcome
        .toLowerCase()
        .includes(condition.value.trim().toLowerCase());
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

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'skipped']);

/** Completed, failed or skipped: the step will not change again this run. */
export function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.has(status);
}

export type SubtaskResolution =
  | { action: 'run' }
  | { action: 'wait' }
  | { action: 'skip'; reason: string };

/**
 * Decide what happens to a pending step, given the current state of the
 * steps it depends on:
 *
 * - **wait** while any upstream step is still pending or running.
 * - **skip** when an upstream step failed, or when an upstream step
 *   completed but its edge here is not satisfied: a conditional edge
 *   whose condition doesn't match the upstream result, or a plain edge
 *   out of a *rejected* approval gate.
 * - **run** otherwise, provided at least one incoming edge is satisfied.
 *
 * Edges from skipped steps are ignored, so a step where exclusive
 * branches meet again runs after whichever branch was taken, while a
 * normal fan-in still needs every upstream step to succeed. A step
 * whose upstream steps were all skipped is skipped too.
 */
export function resolveSubtask(
  subtask: Subtask,
  allSubtasks: Subtask[],
  edges: SubtaskDependencyEdge[],
): SubtaskResolution {
  const incoming = edges.filter((e) => e.subtaskId === subtask.id);
  if (incoming.length === 0) return { action: 'run' };

  const byId = new Map(allSubtasks.map((s) => [s.id, s]));
  let satisfied = 0;
  let skippedUpstream: Subtask | undefined;
  for (const edge of incoming) {
    const dep = byId.get(edge.dependsOnSubtaskId);
    if (!dep) continue;
    if (!isTerminalStatus(dep.status)) return { action: 'wait' };
  }
  for (const edge of incoming) {
    const dep = byId.get(edge.dependsOnSubtaskId);
    if (!dep) continue;
    if (dep.status === 'failed') {
      return {
        action: 'skip',
        reason: `Skipped because "${dep.title}" failed.`,
      };
    }
    if (dep.status === 'skipped') {
      skippedUpstream ??= dep;
      continue;
    }
    if (edge.edgeKind === 'conditional' && edge.conditionOperator) {
      const matched = evaluateCondition(dep.result, {
        operator: edge.conditionOperator as ConditionOperator,
        value: edge.conditionValue ?? '',
      });
      if (!matched) {
        return {
          action: 'skip',
          reason: `Skipped: the result of "${dep.title}" did not match ${edge.conditionOperator} "${edge.conditionValue ?? ''}".`,
        };
      }
    } else if (
      (dep as { subtaskKind?: string }).subtaskKind === 'approval_gate' &&
      (dep as { approvalDecision?: string | null }).approvalDecision ===
        'rejected'
    ) {
      return {
        action: 'skip',
        reason: `Skipped because "${dep.title}" was rejected.`,
      };
    }
    satisfied++;
  }

  if (satisfied > 0) return { action: 'run' };
  return {
    action: 'skip',
    reason: skippedUpstream
      ? `Skipped because "${skippedUpstream.title}" was skipped.`
      : 'Skipped: none of the steps before it ran.',
  };
}

/**
 * True when a pending step can start now (see resolveSubtask).
 */
export function isSubtaskExecutable(
  subtask: Subtask,
  allSubtasks: Subtask[],
  edges: SubtaskDependencyEdge[],
): boolean {
  return resolveSubtask(subtask, allSubtasks, edges).action === 'run';
}

/**
 * Every step reachable downstream of `subtaskId` (not including it),
 * in breadth-first order.
 */
export function getDownstreamSubtaskIds(
  subtaskId: string,
  edges: SubtaskDependencyEdge[],
): string[] {
  const forward = new Map<string, string[]>();
  for (const e of edges) {
    const list = forward.get(e.dependsOnSubtaskId);
    if (list) list.push(e.subtaskId);
    else forward.set(e.dependsOnSubtaskId, [e.subtaskId]);
  }
  const seen = new Set<string>([subtaskId]);
  const order: string[] = [];
  const queue = [subtaskId];
  let current: string | undefined;
  while ((current = queue.shift()) !== undefined) {
    for (const next of forward.get(current) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      order.push(next);
      queue.push(next);
    }
  }
  return order;
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
  let current: string | undefined;
  while ((current = stack.pop()) !== undefined) {
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
 * The OUTCOME values `subtask`'s branches and loop are waiting for (from
 * `equals`/`contains` conditions; regexes can't be listed), so the agent
 * can be told exactly which tags to choose from instead of inventing one
 * that no branch matches.
 */
export function expectedOutcomes(
  subtask: Subtask,
  edges: SubtaskDependencyEdge[],
): string[] {
  const values: string[] = [];
  const add = (operator: string | null | undefined, value: unknown) => {
    if (operator === 'matches_regex' || typeof value !== 'string') return;
    const trimmed = value.trim();
    if (
      trimmed &&
      !values.some((v) => v.toLowerCase() === trimmed.toLowerCase())
    ) {
      values.push(trimmed);
    }
  };
  for (const edge of edges) {
    if (
      edge.dependsOnSubtaskId === subtask.id &&
      edge.edgeKind === 'conditional'
    ) {
      add(edge.conditionOperator, edge.conditionValue);
    }
  }
  const loop = subtask as {
    loopMaxIterations?: number | null;
    loopConditionOperator?: string | null;
    loopConditionValue?: string | null;
  };
  if (loop.loopMaxIterations != null) {
    add(loop.loopConditionOperator, loop.loopConditionValue);
  }
  return values;
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
