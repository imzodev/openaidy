import type { BuiltinTool } from '@openaidy/runtime';
import type { TaskService } from '../../tasks/service';
import { parseGraphSpec } from '../../tasks/graph-spec';
import { formatToolError, requireService, requireString } from '../shared.js';
import { workflowSetGraphMeta } from '../catalog.js';
import { assertWorkflow } from './assert-workflow.js';
import {
  GRAPH_EDGES_PARAM,
  GRAPH_NODES_PARAM,
  formatCreatedNodes,
  formatWarnings,
} from './graph-params.js';

/**
 * workflow_set_graph
 *
 * Replaces a workflow's whole graph from a declarative node/edge list in
 * one validated write, so an agent can build (or rebuild) a workflow in a
 * single call and get every problem back at once instead of discovering
 * them one node_create/edge_create at a time.
 */
export function createWorkflowSetGraphTool(
  getTaskService: () => TaskService | undefined,
): BuiltinTool {
  return {
    name: workflowSetGraphMeta.name,
    description: workflowSetGraphMeta.description,
    parameters: {
      type: 'object',
      properties: {
        workflowId: {
          type: 'string',
          description: 'ID of the workflow whose graph to replace.',
        },
        nodes: GRAPH_NODES_PARAM,
        edges: GRAPH_EDGES_PARAM,
        dryRun: {
          type: 'boolean',
          description: 'Only validate; change nothing. Default false.',
        },
      },
      required: ['workflowId', 'nodes', 'edges'],
    },

    async execute(args, _ctx) {
      const resolved = requireService(getTaskService, 'Task service');
      if (!resolved.ok) return resolved;
      const taskService = resolved.service;

      const idError = requireString(args['workflowId'], 'workflowId');
      if (idError) return { ok: false, error: idError };
      const workflowId = args['workflowId'] as string;
      const dryRun = args['dryRun'] === true;

      const spec = parseGraphSpec(args['nodes'], args['edges']);
      if (!spec.ok) {
        return { ok: false, error: `The graph is malformed:\n${spec.error}` };
      }

      try {
        const existing = await taskService.getTask(workflowId);
        if (!existing) {
          return { ok: false, error: `Workflow "${workflowId}" not found` };
        }
        const workflowCheck = assertWorkflow(existing);
        if (!workflowCheck.ok) return workflowCheck;

        const result = await taskService.setWorkflowGraph(
          workflowId,
          spec.graph,
          { dryRun },
        );
        if (!result.ok) return { ok: false, error: result.error.message };

        if (dryRun) {
          return {
            ok: true,
            content: `The graph is valid (${result.data.nodes.length} nodes, ${result.data.edgeCount} edges). Nothing was changed.${formatWarnings(result.data.warnings)}`,
          };
        }
        return {
          ok: true,
          content: `Workflow graph saved.\n\n${formatCreatedNodes(result.data)}`,
        };
      } catch (err) {
        return formatToolError('Unexpected error saving workflow graph', err);
      }
    },
  };
}
