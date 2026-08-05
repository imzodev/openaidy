/**
 * Shared helpers for bounding how much text gets carried into a new
 * LLM context (e.g. handing a completed subtask's result to a
 * dependent subtask, or summarizing tool results for verification).
 * Caps both the size of any single item and the running total, so a
 * few large results can't unboundedly grow the next prompt.
 */

export type ContextBudget = { remaining: number };

export function createContextBudget(totalCap: number): ContextBudget {
  return { remaining: totalCap };
}

/**
 * Truncate `text` to at most `perItemCap` chars, further capped by
 * whatever remains of the shared `budget`. Decrements `budget` by the
 * number of characters actually kept. Callers should check
 * `budget.remaining > 0` before calling if they want to omit the item
 * entirely once the budget is exhausted, rather than get an empty
 * truncation marker.
 */
export function truncateWithBudget(
  text: string,
  perItemCap: number,
  budget: ContextBudget,
): string {
  const cap = Math.max(0, Math.min(perItemCap, budget.remaining));
  if (text.length <= cap) {
    budget.remaining -= text.length;
    return text;
  }
  const truncated =
    text.slice(0, cap) + `…[truncated ${text.length - cap} chars]`;
  budget.remaining -= truncated.length;
  return truncated;
}
