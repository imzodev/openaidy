import type {
  WorkflowGraph,
  WorkflowGraphEdge,
  WorkflowGraphNode,
} from '@openaidy/workflow-templates';

/**
 * Parses a whole workflow graph as agents and API clients write it into
 * the shape `validateWorkflowGraph` checks. Only the JSON shape is checked
 * here (types, required fields); the graph rules live in the validator.
 *
 * Accepted, per node: `key` (or `id`), `title`, `description`, `kind`
 * (or `subtaskKind`), `agent` (agent id or name; also `agentId` /
 * `assignedAgentId`), `loop: {maxIterations, conditionOperator,
 * conditionValue}`. Per edge: `from`/`to` (or `fromNodeId`/`toNodeId`, as
 * `workflow_get` returns them) and an optional `condition`: a string the
 * upstream outcome is compared with (by `operator`, default `equals`), or
 * an `{operator, value}` object.
 * The `edgeKind`/`conditionOperator`/`conditionValue` fields `workflow_get`
 * returns are accepted too, so its output can be sent back as is.
 */
export type GraphSpecResult =
  | { ok: true; graph: WorkflowGraph }
  | { ok: false; error: string };

type Obj = Record<string, unknown>;

const isObject = (value: unknown): value is Obj =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function pickString(
  obj: Obj,
  names: string[],
  where: string,
  errors: string[],
): string | null {
  for (const name of names) {
    const value = obj[name];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string') {
      errors.push(`${where}.${name} must be a string`);
      return null;
    }
    return value;
  }
  return null;
}

function parseNode(raw: unknown, index: number, errors: string[]) {
  const where = `nodes[${index}]`;
  if (!isObject(raw)) {
    errors.push(`${where} must be an object`);
    return null;
  }
  const key = pickString(raw, ['key', 'id'], where, errors);
  if (!key) {
    errors.push(`${where} needs a "key" (a short name edges can refer to)`);
    return null;
  }
  const node: WorkflowGraphNode = {
    key,
    title: pickString(raw, ['title'], where, errors),
    description: pickString(raw, ['description'], where, errors),
    kind: pickString(raw, ['kind', 'subtaskKind'], where, errors) ?? 'agent',
    agentId: pickString(
      raw,
      ['agent', 'agentId', 'assignedAgentId'],
      where,
      errors,
    ),
    loop: null,
  };

  const loop = raw['loop'];
  if (loop !== undefined && loop !== null) {
    if (!isObject(loop)) {
      errors.push(`${where}.loop must be an object or null`);
    } else if (
      loop['maxIterations'] != null ||
      loop['conditionValue'] != null
    ) {
      // workflow_get reports "no loop" as an object of nulls.
      const maxIterations = loop['maxIterations'];
      if (typeof maxIterations !== 'number') {
        errors.push(`${where}.loop.maxIterations must be a number`);
      }
      node.loop = {
        maxIterations: typeof maxIterations === 'number' ? maxIterations : 0,
        conditionOperator:
          pickString(
            loop,
            ['conditionOperator', 'operator'],
            `${where}.loop`,
            errors,
          ) ?? 'contains',
        conditionValue:
          pickString(
            loop,
            ['conditionValue', 'value'],
            `${where}.loop`,
            errors,
          ) ?? '',
      };
    }
  }
  return node;
}

function parseEdge(raw: unknown, index: number, errors: string[]) {
  const where = `edges[${index}]`;
  if (!isObject(raw)) {
    errors.push(`${where} must be an object`);
    return null;
  }
  const from = pickString(raw, ['from', 'fromNodeId'], where, errors);
  const to = pickString(raw, ['to', 'toNodeId'], where, errors);
  if (!from || !to) {
    errors.push(`${where} needs "from" and "to" node keys`);
    return null;
  }
  const edge: WorkflowGraphEdge = { from, to, edgeKind: 'dependency' };

  const condition = raw['condition'];
  if (typeof condition === 'string') {
    edge.edgeKind = 'conditional';
    edge.conditionOperator =
      pickString(raw, ['operator'], where, errors) ?? 'equals';
    edge.conditionValue = condition;
  } else if (isObject(condition)) {
    edge.edgeKind = 'conditional';
    edge.conditionOperator =
      pickString(condition, ['operator'], `${where}.condition`, errors) ??
      'equals';
    edge.conditionValue = pickString(
      condition,
      ['value'],
      `${where}.condition`,
      errors,
    );
  } else if (condition !== undefined && condition !== null) {
    errors.push(
      `${where}.condition must be a string or {operator, value} object`,
    );
  } else {
    const kind = pickString(raw, ['edgeKind'], where, errors);
    const operator = pickString(raw, ['conditionOperator'], where, errors);
    const value = pickString(raw, ['conditionValue'], where, errors);
    if (kind) edge.edgeKind = kind;
    if (kind === 'conditional' || operator || value) {
      edge.edgeKind = kind ?? 'conditional';
      edge.conditionOperator = operator;
      edge.conditionValue = value;
    }
  }
  return edge;
}

export function parseGraphSpec(
  nodesRaw: unknown,
  edgesRaw: unknown,
): GraphSpecResult {
  if (!Array.isArray(nodesRaw)) {
    return { ok: false, error: 'nodes must be an array' };
  }
  if (edgesRaw !== undefined && edgesRaw !== null && !Array.isArray(edgesRaw)) {
    return { ok: false, error: 'edges must be an array' };
  }
  const errors: string[] = [];
  const nodes = nodesRaw
    .map((raw, i) => parseNode(raw, i, errors))
    .filter((n): n is WorkflowGraphNode => n !== null);
  const edges = ((edgesRaw as unknown[] | null | undefined) ?? [])
    .map((raw, i) => parseEdge(raw, i, errors))
    .filter((e): e is WorkflowGraphEdge => e !== null);
  if (errors.length > 0) {
    return { ok: false, error: errors.map((e) => `- ${e}`).join('\n') };
  }
  return { ok: true, graph: { nodes, edges } };
}
