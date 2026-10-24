/**
 * The one set of rules for what makes a workflow graph valid. Used by the
 * REST routes, the agent tools, template application and the web editor,
 * so a graph that one surface accepts is never rejected (or silently
 * mis-run) by another.
 *
 * Nodes are referenced by `key` — a caller-local name for graphs that
 * aren't saved yet (agent tools, templates), or the subtask id for a
 * graph loaded from the database. Messages name a node by its title when
 * it has one, so they read well in the UI and to an agent alike.
 */

export const CONDITION_OPERATORS = [
  'equals',
  'contains',
  'matches_regex',
] as const;

export type GraphConditionOperator = (typeof CONDITION_OPERATORS)[number];

/** Highest loop cap the editor and tools accept. */
export const MAX_LOOP_ITERATIONS = 50;

export type WorkflowGraphNode = {
  key: string;
  title?: string | null;
  description?: string | null;
  kind?: string | null;
  agentId?: string | null;
  loop?: {
    maxIterations: number;
    conditionOperator: string;
    conditionValue: string;
  } | null;
};

export type WorkflowGraphEdge = {
  from: string;
  to: string;
  edgeKind?: string | null;
  conditionOperator?: string | null;
  conditionValue?: string | null;
};

export type WorkflowGraph = {
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
};

export type WorkflowGraphIssue = {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  /** Key of the node the issue is about, if any. */
  nodeKey?: string;
  /** Index into `edges` of the edge the issue is about, if any. */
  edgeIndex?: number;
};

export type WorkflowGraphCheck = {
  ok: boolean;
  errors: WorkflowGraphIssue[];
  warnings: WorkflowGraphIssue[];
};

export type ValidateWorkflowGraphOptions = {
  /** When given, an assigned agent outside this set is an error. */
  knownAgentIds?: Iterable<string>;
  /** Whether a graph with no steps is acceptable (default true). */
  allowEmpty?: boolean;
};

function invalidRegex(pattern: string): string | null {
  try {
    new RegExp(pattern, 'i');
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : 'invalid pattern';
  }
}

/**
 * Finds one cycle in the `from -> to` edges and returns its node keys in
 * order (first key repeated at the end), or null if the graph is acyclic.
 */
export function findCycle(
  nodeKeys: string[],
  edges: Array<{ from: string; to: string }>,
): string[] | null {
  const adjacency = new Map<string, string[]>();
  for (const key of nodeKeys) adjacency.set(key, []);
  for (const edge of edges) adjacency.get(edge.from)?.push(edge.to);

  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];

  function visit(key: string): string[] | null {
    const current = state.get(key);
    if (current === 'visiting') {
      return [...stack.slice(stack.indexOf(key)), key];
    }
    if (current === 'done') return null;
    state.set(key, 'visiting');
    stack.push(key);
    for (const next of adjacency.get(key) ?? []) {
      const cycle = visit(next);
      if (cycle) return cycle;
    }
    stack.pop();
    state.set(key, 'done');
    return null;
  }

  for (const key of nodeKeys) {
    if (state.has(key)) continue;
    const cycle = visit(key);
    if (cycle) return cycle;
  }
  return null;
}

export function validateWorkflowGraph(
  graph: WorkflowGraph,
  options: ValidateWorkflowGraphOptions = {},
): WorkflowGraphCheck {
  const errors: WorkflowGraphIssue[] = [];
  const warnings: WorkflowGraphIssue[] = [];
  const knownAgents = options.knownAgentIds
    ? new Set(options.knownAgentIds)
    : null;

  const byKey = new Map<string, WorkflowGraphNode>();
  for (const node of graph.nodes) {
    if (!byKey.has(node.key)) byKey.set(node.key, node);
  }
  const name = (key: string): string => {
    const title = byKey.get(key)?.title?.trim();
    return `"${title || key}"`;
  };
  const edgeName = (edge: WorkflowGraphEdge, index: number): string =>
    byKey.has(edge.from) && byKey.has(edge.to)
      ? `connection ${name(edge.from)} → ${name(edge.to)}`
      : `edge ${index + 1}`;

  if (graph.nodes.length === 0 && options.allowEmpty === false) {
    errors.push({
      severity: 'error',
      code: 'graph.empty',
      message: 'The workflow has no steps yet. Add at least one step.',
    });
  }

  // ── Nodes ────────────────────────────────────────────────────────────────
  const seenKeys = new Set<string>();
  graph.nodes.forEach((node, index) => {
    if (!node.key || !node.key.trim()) {
      errors.push({
        severity: 'error',
        code: 'node.missing_key',
        message: `Node ${index + 1} has no key.`,
      });
      return;
    }
    if (seenKeys.has(node.key)) {
      errors.push({
        severity: 'error',
        code: 'node.duplicate_key',
        message: `Node key "${node.key}" is used more than once.`,
        nodeKey: node.key,
      });
      return;
    }
    seenKeys.add(node.key);

    const kind = node.kind ?? 'agent';
    if (kind !== 'agent' && kind !== 'approval_gate') {
      errors.push({
        severity: 'error',
        code: 'node.invalid_kind',
        message: `Step ${name(node.key)}: kind must be "agent" or "approval_gate", not "${kind}".`,
        nodeKey: node.key,
      });
    }

    if (kind === 'agent' && !node.description?.trim()) {
      errors.push({
        severity: 'error',
        code: 'node.missing_description',
        message: `Step ${name(node.key)} needs a description of what the agent should do.`,
        nodeKey: node.key,
      });
    }

    if (node.agentId && knownAgents && !knownAgents.has(node.agentId)) {
      errors.push({
        severity: 'error',
        code: 'node.unknown_agent',
        message: `Step ${name(node.key)} is assigned to agent "${node.agentId}", which doesn't exist or is disabled.`,
        nodeKey: node.key,
      });
    }

    const loop = node.loop;
    if (loop) {
      if (kind === 'approval_gate') {
        errors.push({
          severity: 'error',
          code: 'loop.on_gate',
          message: `Step ${name(node.key)}: approval steps can't repeat; loop config is only valid on agent nodes.`,
          nodeKey: node.key,
        });
      }
      if (
        !Number.isInteger(loop.maxIterations) ||
        loop.maxIterations < 1 ||
        loop.maxIterations > MAX_LOOP_ITERATIONS
      ) {
        errors.push({
          severity: 'error',
          code: 'loop.invalid_max',
          message: `Step ${name(node.key)}: the repeat limit must be a whole number from 1 to ${MAX_LOOP_ITERATIONS}.`,
          nodeKey: node.key,
        });
      }
      if (
        !CONDITION_OPERATORS.includes(
          loop.conditionOperator as GraphConditionOperator,
        )
      ) {
        errors.push({
          severity: 'error',
          code: 'loop.invalid_operator',
          message: `Step ${name(node.key)}: the repeat condition must use one of ${CONDITION_OPERATORS.join(', ')}.`,
          nodeKey: node.key,
        });
      }
      if (!loop.conditionValue?.trim()) {
        errors.push({
          severity: 'error',
          code: 'loop.missing_value',
          message: `Step ${name(node.key)}: the repeat condition needs a value to stop on.`,
          nodeKey: node.key,
        });
      } else if (loop.conditionOperator === 'matches_regex') {
        const problem = invalidRegex(loop.conditionValue);
        if (problem) {
          errors.push({
            severity: 'error',
            code: 'loop.invalid_regex',
            message: `Step ${name(node.key)}: the repeat condition is not a valid regular expression (${problem}).`,
            nodeKey: node.key,
          });
        }
      }
    }
  });

  // ── Edges ────────────────────────────────────────────────────────────────
  const seenEdges = new Set<string>();
  const validEdges: Array<{ from: string; to: string }> = [];
  graph.edges.forEach((edge, index) => {
    const label = edgeName(edge, index);
    let endpointsOk = true;
    for (const end of [edge.from, edge.to]) {
      if (!byKey.has(end)) {
        errors.push({
          severity: 'error',
          code: 'edge.unknown_node',
          message: `Edge ${index + 1} (${edge.from} → ${edge.to}): unknown node "${end}".`,
          edgeIndex: index,
        });
        endpointsOk = false;
      }
    }
    if (!endpointsOk) return;

    if (edge.from === edge.to) {
      errors.push({
        severity: 'error',
        code: 'edge.self',
        message: `Step ${name(edge.from)} can't connect to itself. To repeat a step, give it a loop instead.`,
        edgeIndex: index,
        nodeKey: edge.from,
      });
      return;
    }

    const pair = `${edge.from}\u0000${edge.to}`;
    if (seenEdges.has(pair)) {
      errors.push({
        severity: 'error',
        code: 'edge.duplicate',
        message: `${capitalize(label)} is defined more than once.`,
        edgeIndex: index,
      });
      return;
    }
    seenEdges.add(pair);
    validEdges.push({ from: edge.from, to: edge.to });

    const kind = edge.edgeKind ?? 'dependency';
    if (kind !== 'dependency' && kind !== 'conditional') {
      errors.push({
        severity: 'error',
        code: 'edge.invalid_kind',
        message: `${capitalize(label)}: kind must be "dependency" or "conditional".`,
        edgeIndex: index,
      });
      return;
    }

    if (kind === 'dependency') {
      if (edge.conditionOperator || edge.conditionValue) {
        errors.push({
          severity: 'error',
          code: 'edge.unexpected_condition',
          message: `${capitalize(label)}: only conditional edges take a condition.`,
          edgeIndex: index,
        });
      }
      return;
    }

    if (!edge.conditionOperator || !edge.conditionValue?.trim()) {
      errors.push({
        severity: 'error',
        code: 'edge.missing_condition',
        message: `${capitalize(label)}: conditional edge missing operator/value.`,
        edgeIndex: index,
      });
      return;
    }
    if (
      !CONDITION_OPERATORS.includes(
        edge.conditionOperator as GraphConditionOperator,
      )
    ) {
      errors.push({
        severity: 'error',
        code: 'edge.invalid_operator',
        message: `${capitalize(label)}: the condition must use one of ${CONDITION_OPERATORS.join(', ')}.`,
        edgeIndex: index,
      });
      return;
    }
    if (edge.conditionOperator === 'matches_regex') {
      const problem = invalidRegex(edge.conditionValue);
      if (problem) {
        errors.push({
          severity: 'error',
          code: 'edge.invalid_regex',
          message: `${capitalize(label)}: the condition is not a valid regular expression (${problem}).`,
          edgeIndex: index,
        });
      }
      return;
    }

    // An approval step's outcome is always "approved" or "rejected", so a
    // condition looking for anything else can never match.
    const upstream = byKey.get(edge.from);
    if (upstream?.kind === 'approval_gate') {
      const value = edge.conditionValue.trim().toLowerCase();
      const matchable = ['approved', 'rejected'].some((outcome) =>
        edge.conditionOperator === 'equals'
          ? outcome === value
          : outcome.includes(value),
      );
      if (!matchable) {
        warnings.push({
          severity: 'warning',
          code: 'edge.unreachable_condition',
          message: `${capitalize(label)}: an approval step ends as "approved" or "rejected", so the condition "${edge.conditionValue}" never matches.`,
          edgeIndex: index,
        });
      }
    }
  });

  const cycle = findCycle([...seenKeys], validEdges);
  if (cycle) {
    errors.push({
      severity: 'error',
      code: 'graph.cycle',
      message: `The graph contains a cycle: ${cycle.map(name).join(' → ')}. To repeat a step, give it a loop instead.`,
    });
  }

  // ── Warnings ─────────────────────────────────────────────────────────────
  if (seenKeys.size > 1 && validEdges.length > 0) {
    const connected = new Set(validEdges.flatMap((e) => [e.from, e.to]));
    for (const key of seenKeys) {
      if (!connected.has(key)) {
        warnings.push({
          severity: 'warning',
          code: 'node.disconnected',
          message: `Step ${name(key)} isn't connected to any other step, so it starts right away alongside the first steps.`,
          nodeKey: key,
        });
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Issues in `after` that `before` didn't already have, so a single edit is
 * only rejected for problems it introduces — not for older ones elsewhere
 * in the graph that the user hasn't fixed yet.
 */
export function newGraphErrors(
  before: WorkflowGraphCheck,
  after: WorkflowGraphCheck,
): WorkflowGraphIssue[] {
  const existing = new Set(before.errors.map((e) => e.message));
  return after.errors.filter((e) => !existing.has(e.message));
}
