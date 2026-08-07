import { describe, it, expect } from 'vitest';
import {
  isSubtaskExecutable,
  evaluateCondition,
  extractOutcome,
  wouldCreateCycle,
  subtaskNeedsOutcomeTag,
  type SubtaskDependencyEdge,
} from './subtask-graph';
import type { Subtask } from '@openaidy/db';

function makeSubtask(overrides: Partial<Subtask> = {}): Subtask {
  return {
    id: 'sub-1',
    taskId: 'task-1',
    title: 'Subtask',
    description: 'desc',
    status: 'pending',
    assignedAgentId: null,
    sessionId: null,
    orderIndex: 0,
    result: null,
    retryCount: 0,
    pendingVerificationResult: null,
    subtaskKind: 'agent',
    loopMaxIterations: null,
    loopConditionOperator: null,
    loopConditionValue: null,
    loopIterationCount: 0,
    loopLastResult: null,
    awaitingApprovalSince: null,
    approvalDecision: null,
    approvalNote: null,
    approvedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Subtask;
}

describe('extractOutcome', () => {
  it('pulls the OUTCOME tag out of a result', () => {
    expect(extractOutcome('Did the work.\nOUTCOME: approved')).toBe('approved');
  });

  it('falls back to the raw text when there is no OUTCOME tag', () => {
    expect(extractOutcome('Just a plain result')).toBe('Just a plain result');
  });

  it('returns empty string for null/undefined', () => {
    expect(extractOutcome(null)).toBe('');
    expect(extractOutcome(undefined)).toBe('');
  });
});

describe('evaluateCondition', () => {
  it('equals is case-insensitive', () => {
    expect(
      evaluateCondition('OUTCOME: Approved', {
        operator: 'equals',
        value: 'approved',
      }),
    ).toBe(true);
  });

  it('contains matches a substring', () => {
    expect(
      evaluateCondition('OUTCOME: needs more review', {
        operator: 'contains',
        value: 'review',
      }),
    ).toBe(true);
  });

  it('matches_regex matches a pattern', () => {
    expect(
      evaluateCondition('OUTCOME: error-42', {
        operator: 'matches_regex',
        value: '^error-\\d+$',
      }),
    ).toBe(true);
  });

  it('an invalid regex never matches instead of throwing', () => {
    expect(
      evaluateCondition('OUTCOME: anything', {
        operator: 'matches_regex',
        value: '(unterminated',
      }),
    ).toBe(false);
  });

  it('falls back to raw text when there is no OUTCOME tag', () => {
    expect(
      evaluateCondition('plain approved text', {
        operator: 'contains',
        value: 'approved',
      }),
    ).toBe(true);
  });
});

describe('isSubtaskExecutable', () => {
  it('is executable with no incoming edges', () => {
    const subtask = makeSubtask({ id: 'a' });
    expect(isSubtaskExecutable(subtask, [subtask], [])).toBe(true);
  });

  it('a plain dependency edge requires completed status only', () => {
    const dep = makeSubtask({ id: 'a', status: 'completed', result: 'x' });
    const subtask = makeSubtask({ id: 'b' });
    const edges: SubtaskDependencyEdge[] = [
      { subtaskId: 'b', dependsOnSubtaskId: 'a', edgeKind: 'dependency' },
    ];
    expect(isSubtaskExecutable(subtask, [dep, subtask], edges)).toBe(true);
  });

  it('a conditional edge additionally requires the condition to hold', () => {
    const dep = makeSubtask({
      id: 'a',
      status: 'completed',
      result: 'OUTCOME: approved',
    });
    const subtask = makeSubtask({ id: 'b' });
    const edges: SubtaskDependencyEdge[] = [
      {
        subtaskId: 'b',
        dependsOnSubtaskId: 'a',
        edgeKind: 'conditional',
        conditionOperator: 'equals',
        conditionValue: 'approved',
      },
    ];
    expect(isSubtaskExecutable(subtask, [dep, subtask], edges)).toBe(true);
  });

  it('a conditional edge blocks the branch when the condition does not hold', () => {
    const dep = makeSubtask({
      id: 'a',
      status: 'completed',
      result: 'OUTCOME: rejected',
    });
    const subtask = makeSubtask({ id: 'b' });
    const edges: SubtaskDependencyEdge[] = [
      {
        subtaskId: 'b',
        dependsOnSubtaskId: 'a',
        edgeKind: 'conditional',
        conditionOperator: 'equals',
        conditionValue: 'approved',
      },
    ];
    expect(isSubtaskExecutable(subtask, [dep, subtask], edges)).toBe(false);
  });

  it('requires all edges to be satisfied on fan-in, mixing plain and conditional', () => {
    const depA = makeSubtask({ id: 'a', status: 'completed', result: 'ok' });
    const depB = makeSubtask({
      id: 'b',
      status: 'completed',
      result: 'OUTCOME: rejected',
    });
    const subtask = makeSubtask({ id: 'c' });
    const edges: SubtaskDependencyEdge[] = [
      { subtaskId: 'c', dependsOnSubtaskId: 'a', edgeKind: 'dependency' },
      {
        subtaskId: 'c',
        dependsOnSubtaskId: 'b',
        edgeKind: 'conditional',
        conditionOperator: 'equals',
        conditionValue: 'approved',
      },
    ];
    expect(isSubtaskExecutable(subtask, [depA, depB, subtask], edges)).toBe(
      false,
    );
  });
});

describe('wouldCreateCycle', () => {
  it('detects a direct cycle', () => {
    const edges: SubtaskDependencyEdge[] = [
      { subtaskId: 'a', dependsOnSubtaskId: 'b' },
    ];
    expect(
      wouldCreateCycle(edges, { subtaskId: 'b', dependsOnSubtaskId: 'a' }),
    ).toBe(true);
  });

  it('detects a multi-hop cycle', () => {
    const edges: SubtaskDependencyEdge[] = [
      { subtaskId: 'b', dependsOnSubtaskId: 'a' },
      { subtaskId: 'c', dependsOnSubtaskId: 'b' },
    ];
    expect(
      wouldCreateCycle(edges, { subtaskId: 'a', dependsOnSubtaskId: 'c' }),
    ).toBe(true);
  });

  it('does not false-positive on a diamond dependency', () => {
    const edges: SubtaskDependencyEdge[] = [
      { subtaskId: 'b', dependsOnSubtaskId: 'a' },
      { subtaskId: 'c', dependsOnSubtaskId: 'a' },
    ];
    expect(
      wouldCreateCycle(edges, { subtaskId: 'd', dependsOnSubtaskId: 'b' }),
    ).toBe(false);
  });
});

describe('subtaskNeedsOutcomeTag', () => {
  it('is true when the subtask has an outgoing conditional edge', () => {
    const subtask = makeSubtask({ id: 'a' });
    const edges: SubtaskDependencyEdge[] = [
      { subtaskId: 'b', dependsOnSubtaskId: 'a', edgeKind: 'conditional' },
    ];
    expect(subtaskNeedsOutcomeTag(subtask, edges)).toBe(true);
  });

  it('is true when the subtask is loop-configured', () => {
    const subtask = makeSubtask({ id: 'a', loopMaxIterations: 3 });
    expect(subtaskNeedsOutcomeTag(subtask, [])).toBe(true);
  });

  it('is false for a plain subtask with only dependency edges', () => {
    const subtask = makeSubtask({ id: 'a' });
    const edges: SubtaskDependencyEdge[] = [
      { subtaskId: 'b', dependsOnSubtaskId: 'a', edgeKind: 'dependency' },
    ];
    expect(subtaskNeedsOutcomeTag(subtask, edges)).toBe(false);
  });
});
