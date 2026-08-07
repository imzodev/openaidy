/**
 * Headless auto-layout for the subtask workflow canvas, via dagre
 * (pure layout algorithm, no UI/DOM dependency — a good fit since the
 * canvas itself is a hand-built SVG+HTML component, not a full
 * node-editor library).
 */

import dagre from 'dagre';

export const NODE_WIDTH = 220;
export const NODE_HEIGHT = 84;

export type LayoutEdge = { from: string; to: string };

/**
 * Compute a top-to-bottom layout for the given node ids and edges.
 * Nodes with no edges are still placed (dagre lays out disconnected
 * nodes in their own row). Returns center positions in canvas
 * coordinates, keyed by node id.
 */
export function computeAutoLayout(
  nodeIds: string[],
  edges: LayoutEdge[],
): Record<string, { x: number; y: number }> {
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: 'TB', nodesep: 40, ranksep: 60 });
  graph.setDefaultEdgeLabel(() => ({}));

  for (const id of nodeIds) {
    graph.setNode(id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of edges) {
    if (nodeIds.includes(edge.from) && nodeIds.includes(edge.to)) {
      graph.setEdge(edge.from, edge.to);
    }
  }

  dagre.layout(graph);

  const positions: Record<string, { x: number; y: number }> = {};
  for (const id of nodeIds) {
    const node = graph.node(id);
    positions[id] = node
      ? { x: node.x, y: node.y }
      : { x: NODE_WIDTH / 2, y: NODE_HEIGHT / 2 };
  }
  return positions;
}
