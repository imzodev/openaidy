import { describe, it, expect } from 'vitest';
import { wouldCreateCycle } from './workflow-graph';

describe('wouldCreateCycle (client-side duplicate)', () => {
  it('detects a direct cycle', () => {
    const edges = [{ subtaskId: 'a', dependsOnSubtaskId: 'b' }];
    expect(
      wouldCreateCycle(edges, { subtaskId: 'b', dependsOnSubtaskId: 'a' }),
    ).toBe(true);
  });

  it('detects a multi-hop cycle', () => {
    const edges = [
      { subtaskId: 'b', dependsOnSubtaskId: 'a' },
      { subtaskId: 'c', dependsOnSubtaskId: 'b' },
    ];
    expect(
      wouldCreateCycle(edges, { subtaskId: 'a', dependsOnSubtaskId: 'c' }),
    ).toBe(true);
  });

  it('does not false-positive on a diamond dependency', () => {
    const edges = [
      { subtaskId: 'b', dependsOnSubtaskId: 'a' },
      { subtaskId: 'c', dependsOnSubtaskId: 'a' },
    ];
    expect(
      wouldCreateCycle(edges, { subtaskId: 'd', dependsOnSubtaskId: 'b' }),
    ).toBe(false);
  });
});
