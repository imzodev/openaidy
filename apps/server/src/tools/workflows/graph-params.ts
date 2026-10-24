import type { WorkflowGraphIssue } from '@openaidy/workflow-templates';
import type { SetGraphResult } from '../../tasks/operations/workflow-graph-operations';

/**
 * JSON Schema for the declarative `nodes` / `edges` arrays accepted by
 * workflow_create and workflow_set_graph (parsed by `parseGraphSpec`).
 */
export const GRAPH_NODES_PARAM = {
  type: 'array',
  description: 'Every step of the workflow. Edges refer to steps by `key`.',
  items: {
    type: 'object',
    properties: {
      key: {
        type: 'string',
        description:
          'Short unique name for this step, e.g. "draft". Only used to wire edges.',
      },
      title: {
        type: 'string',
        description: 'Short title shown on the canvas.',
      },
      description: {
        type: 'string',
        description:
          'What the agent should do in this step (required for agent steps). ' +
          'If outgoing edges branch on the outcome, tell the agent which ' +
          'OUTCOME values to choose from.',
      },
      kind: {
        type: 'string',
        enum: ['agent', 'approval_gate'],
        description:
          '"agent" (default) runs an agent; "approval_gate" waits for a person to approve or reject.',
      },
      agent: {
        type: 'string',
        description:
          'Agent id or name to run this step. Omit to use the default agent.',
      },
      loop: {
        type: 'object',
        description:
          'Repeat this step until its OUTCOME matches the condition, at most maxIterations times.',
        properties: {
          maxIterations: { type: 'integer', description: '1 to 50.' },
          conditionOperator: {
            type: 'string',
            enum: ['equals', 'contains', 'matches_regex'],
          },
          conditionValue: { type: 'string' },
        },
        required: ['maxIterations', 'conditionOperator', 'conditionValue'],
      },
    },
    required: ['key'],
  },
} as const;

export const GRAPH_EDGES_PARAM = {
  type: 'array',
  description:
    'Connections between steps: `to` waits for `from`. Add `condition` to ' +
    'take the edge only for a given outcome of `from`.',
  items: {
    type: 'object',
    properties: {
      from: { type: 'string', description: 'Key of the upstream step.' },
      to: { type: 'string', description: 'Key of the downstream step.' },
      condition: {
        type: 'string',
        description:
          'Optional. Take this edge only when the OUTCOME of `from` matches ' +
          'this value (e.g. "approved", "PASS"). Without it the edge is a ' +
          'plain dependency.',
      },
      operator: {
        type: 'string',
        enum: ['equals', 'contains', 'matches_regex'],
        description: 'How `condition` is compared. Default "equals".',
      },
    },
    required: ['from', 'to'],
  },
} as const;

export function formatWarnings(warnings: WorkflowGraphIssue[]): string {
  if (warnings.length === 0) return '';
  return `\n\nWarnings:\n${warnings.map((w) => `- ${w.message}`).join('\n')}`;
}

export function formatCreatedNodes(result: SetGraphResult): string {
  const nodes = result.nodes
    .map((n) => `- ${n.key} → ${n.id} (${n.title})`)
    .join('\n');
  return `Nodes:\n${nodes}\nEdges: ${result.edgeCount}${formatWarnings(result.warnings)}`;
}
