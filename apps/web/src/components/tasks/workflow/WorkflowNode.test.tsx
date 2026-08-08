import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup } from '@solidjs/testing-library';
import { WorkflowNode } from './WorkflowNode';
import type { Subtask } from '../../../lib/api-tasks';

function makeSubtask(overrides: Partial<Subtask> = {}): Subtask {
  return {
    id: 'sub-1',
    taskId: 'task-1',
    dependsOnSubtaskIds: [],
    title: 'Do the thing',
    description: 'desc',
    status: 'pending',
    assignedAgentId: null,
    orderIndex: 0,
    result: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('WorkflowNode', () => {
  beforeEach(() => {
    cleanup();
  });

  it('renders the subtask title', () => {
    const { container } = render(() => (
      <WorkflowNode
        subtask={makeSubtask()}
        x={0}
        y={0}
        selected={false}
        onSelect={() => {}}
      />
    ));
    expect(container).toHaveTextContent('Do the thing');
  });

  it('shows an approval-gate badge for approval_gate subtasks', () => {
    const { container } = render(() => (
      <WorkflowNode
        subtask={makeSubtask({ subtaskKind: 'approval_gate' })}
        x={0}
        y={0}
        selected={false}
        onSelect={() => {}}
      />
    ));
    expect(container.querySelector('[title="Approval gate"]')).not.toBeNull();
  });

  it('shows an "Awaiting approval" pill only when paused', () => {
    const { container } = render(() => (
      <WorkflowNode
        subtask={makeSubtask({
          subtaskKind: 'approval_gate',
          awaitingApprovalSince: '2026-01-01T00:00:00Z',
        })}
        x={0}
        y={0}
        selected={false}
        onSelect={() => {}}
      />
    ));
    expect(container).toHaveTextContent('Awaiting approval');
  });

  it('does not show the awaiting badge when not paused', () => {
    const { container } = render(() => (
      <WorkflowNode
        subtask={makeSubtask({ subtaskKind: 'approval_gate' })}
        x={0}
        y={0}
        selected={false}
        onSelect={() => {}}
      />
    ));
    expect(container).not.toHaveTextContent('Awaiting approval');
  });

  it('shows a loop badge with iteration/max for loop-configured subtasks', () => {
    const { container } = render(() => (
      <WorkflowNode
        subtask={makeSubtask({
          loopMaxIterations: 3,
          loopIterationCount: 1,
        })}
        x={0}
        y={0}
        selected={false}
        onSelect={() => {}}
      />
    ));
    expect(container).toHaveTextContent('1/3');
  });

  it('calls onSelect when clicked', () => {
    const onSelect = vi.fn();
    const { container } = render(() => (
      <WorkflowNode
        subtask={makeSubtask()}
        x={0}
        y={0}
        selected={false}
        onSelect={onSelect}
      />
    ));
    (container.firstChild as HTMLElement).click();
    expect(onSelect).toHaveBeenCalled();
  });

  it('shows the assigned agent name when agents are provided', () => {
    const { container } = render(() => (
      <WorkflowNode
        subtask={makeSubtask({ assignedAgentId: 'agent-1' })}
        agents={[{ id: 'agent-1', name: 'Codex' }]}
        x={0}
        y={0}
        selected={false}
        onSelect={() => {}}
      />
    ));
    expect(container).toHaveTextContent('Codex');
  });
});
