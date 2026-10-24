import { describe, expect, it } from 'vitest';
import {
  findCycle,
  newGraphErrors,
  validateWorkflowGraph,
  type WorkflowGraph,
} from './graph';

const base: WorkflowGraph = {
  nodes: [
    { key: 'draft', title: 'Draft', description: 'Write it', kind: 'agent' },
    { key: 'review', title: 'Review', kind: 'approval_gate' },
    { key: 'publish', title: 'Publish', description: 'Ship it' },
  ],
  edges: [
    { from: 'draft', to: 'review' },
    {
      from: 'review',
      to: 'publish',
      edgeKind: 'conditional',
      conditionOperator: 'equals',
      conditionValue: 'approved',
    },
  ],
};

function codes(graph: WorkflowGraph, options = {}) {
  const check = validateWorkflowGraph(graph, options);
  return {
    errors: check.errors.map((e) => e.code),
    warnings: check.warnings.map((e) => e.code),
  };
}

describe('validateWorkflowGraph', () => {
  it('accepts a well-formed graph', () => {
    const check = validateWorkflowGraph(base);
    expect(check.ok).toBe(true);
    expect(check.errors).toEqual([]);
    expect(check.warnings).toEqual([]);
  });

  it('names unknown nodes with the edge number', () => {
    const check = validateWorkflowGraph({
      ...base,
      edges: [...base.edges, { from: 'publish', to: 'tests' }],
    });
    expect(check.errors[0]?.message).toBe(
      'Edge 3 (publish → tests): unknown node "tests".',
    );
    expect(check.errors[0]?.edgeIndex).toBe(2);
  });

  it('flags duplicate keys, duplicate edges and self edges', () => {
    expect(
      codes({
        nodes: [...base.nodes, { key: 'draft', description: 'again' }],
        edges: [
          { from: 'draft', to: 'review' },
          { from: 'draft', to: 'review' },
          { from: 'publish', to: 'publish' },
        ],
      }).errors,
    ).toEqual(['node.duplicate_key', 'edge.duplicate', 'edge.self']);
  });

  it('describes a cycle by step titles', () => {
    const check = validateWorkflowGraph({
      ...base,
      edges: [...base.edges, { from: 'publish', to: 'draft' }],
    });
    expect(check.errors.map((e) => e.message)).toEqual([
      'The graph contains a cycle: "Draft" → "Review" → "Publish" → "Draft". To repeat a step, give it a loop instead.',
    ]);
  });

  it('requires a description on agent steps but not on approval steps', () => {
    expect(
      codes({
        nodes: [
          { key: 'a', description: '  ' },
          { key: 'b', kind: 'approval_gate' },
        ],
        edges: [{ from: 'a', to: 'b' }],
      }).errors,
    ).toEqual(['node.missing_description']);
  });

  it('validates loops', () => {
    const node = (loop: unknown) => ({
      nodes: [
        {
          key: 'a',
          description: 'x',
          loop: loop as NonNullable<WorkflowGraph['nodes'][0]['loop']>,
        },
      ],
      edges: [],
    });
    expect(
      codes(
        node({
          maxIterations: 0,
          conditionOperator: 'equals',
          conditionValue: 'x',
        }),
      ).errors,
    ).toEqual(['loop.invalid_max']);
    expect(
      codes(
        node({
          maxIterations: 3,
          conditionOperator: 'equals',
          conditionValue: '',
        }),
      ).errors,
    ).toEqual(['loop.missing_value']);
    expect(
      codes(
        node({
          maxIterations: 3,
          conditionOperator: 'matches_regex',
          conditionValue: '(',
        }),
      ).errors,
    ).toEqual(['loop.invalid_regex']);
    expect(
      codes({
        nodes: [
          {
            key: 'g',
            kind: 'approval_gate',
            loop: {
              maxIterations: 2,
              conditionOperator: 'equals',
              conditionValue: 'x',
            },
          },
        ],
        edges: [],
      }).errors,
    ).toEqual(['loop.on_gate']);
  });

  it('validates edge conditions', () => {
    const withEdge = (edge: WorkflowGraph['edges'][0]) => ({
      ...base,
      edges: [base.edges[0]!, edge],
    });
    expect(
      codes(
        withEdge({ from: 'review', to: 'publish', edgeKind: 'conditional' }),
      ).errors,
    ).toEqual(['edge.missing_condition']);
    expect(
      codes(
        withEdge({
          from: 'review',
          to: 'publish',
          conditionOperator: 'equals',
          conditionValue: 'approved',
        }),
      ).errors,
    ).toEqual(['edge.unexpected_condition']);
    expect(
      codes(
        withEdge({
          from: 'review',
          to: 'publish',
          edgeKind: 'conditional',
          conditionOperator: 'matches_regex',
          conditionValue: '[',
        }),
      ).errors,
    ).toEqual(['edge.invalid_regex']);
  });

  it('warns about a gate condition that can never match', () => {
    expect(
      codes({
        ...base,
        edges: [
          base.edges[0]!,
          {
            from: 'review',
            to: 'publish',
            edgeKind: 'conditional',
            conditionOperator: 'equals',
            conditionValue: 'yes',
          },
        ],
      }).warnings,
    ).toEqual(['edge.unreachable_condition']);
  });

  it('warns about a disconnected step', () => {
    expect(
      codes({
        ...base,
        nodes: [...base.nodes, { key: 'extra', description: 'alone' }],
      }).warnings,
    ).toEqual(['node.disconnected']);
  });

  it('checks agents against the known set when given', () => {
    const graph = {
      nodes: [{ key: 'a', description: 'x', agentId: 'ghost' }],
      edges: [],
    };
    expect(codes(graph).errors).toEqual([]);
    expect(codes(graph, { knownAgentIds: ['writer'] }).errors).toEqual([
      'node.unknown_agent',
    ]);
  });

  it('rejects an empty graph only when asked to', () => {
    expect(codes({ nodes: [], edges: [] }).errors).toEqual([]);
    expect(
      codes({ nodes: [], edges: [] }, { allowEmpty: false }).errors,
    ).toEqual(['graph.empty']);
  });
});

describe('findCycle', () => {
  it('returns null for a DAG', () => {
    expect(
      findCycle(
        ['a', 'b', 'c'],
        [
          { from: 'a', to: 'b' },
          { from: 'a', to: 'c' },
          { from: 'b', to: 'c' },
        ],
      ),
    ).toBeNull();
  });
});

describe('newGraphErrors', () => {
  it('only reports errors the change introduced', () => {
    const before = validateWorkflowGraph({
      nodes: [{ key: 'a', description: '' }],
      edges: [],
    });
    const after = validateWorkflowGraph({
      nodes: [
        { key: 'a', description: '' },
        { key: 'b', description: 'x' },
      ],
      edges: [{ from: 'b', to: 'b' }],
    });
    expect(newGraphErrors(before, after).map((e) => e.code)).toEqual([
      'edge.self',
    ]);
  });
});
