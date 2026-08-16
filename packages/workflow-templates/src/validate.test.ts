import { describe, it, expect } from 'vitest';
import type { WorkflowTemplate } from '@openaidy/shared-types';
import { WORKFLOW_TEMPLATES } from './templates/index.js';
import { validateWorkflowTemplate } from './validate.js';

describe('workflow template registry', () => {
  it('has no duplicate template ids', () => {
    const ids = WORKFLOW_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(WORKFLOW_TEMPLATES.map((t) => [t.id, t] as const))(
    '%s is structurally valid',
    (_id, template) => {
      expect(validateWorkflowTemplate(template)).toEqual([]);
    },
  );
});

describe('validateWorkflowTemplate', () => {
  const base: WorkflowTemplate = {
    id: 'test',
    version: 1,
    name: 'Test',
    description: 'Test template',
    category: 'engineering',
    inputs: [{ key: 'repo', label: 'Repo', type: 'string' }],
    requirements: [],
    nodes: [
      { key: 'a', description: 'do a', kind: 'agent' },
      { key: 'b', description: 'do b with {{repo}}', kind: 'agent' },
    ],
    edges: [{ from: 'a', to: 'b', edgeKind: 'dependency' }],
  };

  it('accepts a well-formed template', () => {
    expect(validateWorkflowTemplate(base)).toEqual([]);
  });

  it('flags a dangling edge reference', () => {
    const errors = validateWorkflowTemplate({
      ...base,
      edges: [{ from: 'a', to: 'missing', edgeKind: 'dependency' }],
    });
    expect(errors.some((e) => e.includes('unknown node "missing"'))).toBe(true);
  });

  it('flags a cycle', () => {
    const errors = validateWorkflowTemplate({
      ...base,
      edges: [
        { from: 'a', to: 'b', edgeKind: 'dependency' },
        { from: 'b', to: 'a', edgeKind: 'dependency' },
      ],
    });
    expect(errors.some((e) => e.includes('cycle'))).toBe(true);
  });

  it('flags a conditional edge missing operator/value', () => {
    const errors = validateWorkflowTemplate({
      ...base,
      edges: [{ from: 'a', to: 'b', edgeKind: 'conditional' }],
    });
    expect(errors.some((e) => e.includes('missing operator/value'))).toBe(true);
  });

  it('flags loop config on a non-agent node', () => {
    const errors = validateWorkflowTemplate({
      ...base,
      nodes: [
        ...base.nodes.slice(0, 1),
        {
          key: 'b',
          description: 'approve',
          kind: 'approval_gate',
          loop: {
            maxIterations: 2,
            conditionOperator: 'contains',
            conditionValue: 'x',
          },
        },
      ],
    });
    expect(errors.some((e) => e.includes('loop config is only valid'))).toBe(
      true,
    );
  });

  it('flags an undeclared input placeholder', () => {
    const errors = validateWorkflowTemplate({
      ...base,
      nodes: [
        { key: 'a', description: 'uses {{branch}}', kind: 'agent' },
        base.nodes[1]!,
      ],
    });
    expect(
      errors.some((e) => e.includes('undeclared input "{{branch}}"')),
    ).toBe(true);
  });
});
