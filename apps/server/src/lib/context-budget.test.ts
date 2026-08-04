import { describe, it, expect } from 'vitest';
import { createContextBudget, truncateWithBudget } from './context-budget';

describe('context-budget', () => {
  it('returns text unchanged and decrements budget by its length when under both caps', () => {
    const budget = createContextBudget(100);
    const result = truncateWithBudget('short text', 50, budget);

    expect(result).toBe('short text');
    expect(budget.remaining).toBe(100 - 'short text'.length);
  });

  it('truncates to the per-item cap and decrements by the full returned length, including the marker', () => {
    const budget = createContextBudget(1000);
    const text = 'x'.repeat(50);

    const result = truncateWithBudget(text, 10, budget);

    expect(result).toBe('xxxxxxxxxx…[truncated 40 chars]');
    // Regression: the marker itself must count against the budget,
    // not just the sliced `cap` chars — otherwise every truncated item
    // leaks a few dozen chars past the total cap.
    expect(budget.remaining).toBe(1000 - result.length);
  });

  it('never lets a single item consume more than the remaining budget', () => {
    const budget = createContextBudget(20);
    const text = 'y'.repeat(100);

    const result = truncateWithBudget(text, 50, budget);

    expect(result.length).toBeLessThanOrEqual(
      20 + '…[truncated 100 chars]'.length,
    );
    expect(budget.remaining).toBe(20 - result.length);
  });
});
