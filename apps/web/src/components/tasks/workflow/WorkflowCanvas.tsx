/**
 * Pannable canvas rendering the subtask dependency graph: an SVG layer
 * draws edges behind absolutely-positioned HTML node cards (the same
 * "HTML nodes over SVG edges" split react-flow itself uses, which
 * avoids <foreignObject> quirks). Supports panning, click-to-select,
 * dragging a node to reposition it, and dragging from a node's
 * connect handle to another node to create a dependency edge.
 */

import { For, Show, createSignal } from 'solid-js';
import type { Subtask, SubtaskEdgeDto } from '../../../lib/api-tasks';
import type { Agent } from '../AgentSelector';
import { WorkflowNode } from './WorkflowNode';
import { NODE_HEIGHT } from '../../../lib/workflow-layout';

export type WorkflowCanvasProps = {
  subtasks: Subtask[];
  edges: SubtaskEdgeDto[];
  agents?: Agent[];
  positions: Record<string, { x: number; y: number }>;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  onSelectNode: (id: string | null) => void;
  onSelectEdge: (id: string | null) => void;
  /** Live position update while a node is being dragged. */
  onNodeMove?: (id: string, x: number, y: number) => void;
  /** Fired once when a node drag ends — the point to persist positions. */
  onNodeMoveEnd?: () => void;
  /** Fired when a connect-drag from `sourceId` is released over `targetId`. */
  onConnect?: (sourceId: string, targetId: string) => void;
};

type DragState =
  | { kind: 'none' }
  | {
      kind: 'move';
      nodeId: string;
      startClientX: number;
      startClientY: number;
      origX: number;
      origY: number;
    }
  | { kind: 'connect'; sourceId: string; cursorX: number; cursorY: number };

function edgePath(
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  const midY = (from.y + to.y) / 2;
  return `M ${from.x} ${from.y + NODE_HEIGHT / 2} C ${from.x} ${midY}, ${to.x} ${midY}, ${to.x} ${to.y - NODE_HEIGHT / 2}`;
}

export function WorkflowCanvas(props: WorkflowCanvasProps) {
  const [pan, setPan] = createSignal({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = createSignal(false);
  const [drag, setDrag] = createSignal<DragState>({ kind: 'none' });
  let panStart = { x: 0, y: 0, panX: 0, panY: 0 };
  let rootEl: HTMLDivElement | undefined;

  function toCanvasCoords(clientX: number, clientY: number) {
    const rect = rootEl?.getBoundingClientRect();
    const p = pan();
    return {
      x: clientX - (rect?.left ?? 0) - p.x,
      y: clientY - (rect?.top ?? 0) - p.y,
    };
  }

  function onBackgroundPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    setIsPanning(true);
    panStart = { x: e.clientX, y: e.clientY, panX: pan().x, panY: pan().y };
    props.onSelectNode(null);
    props.onSelectEdge(null);
  }

  function onNodeMoveStart(nodeId: string, e: PointerEvent) {
    const pos = props.positions[nodeId];
    if (!pos) return;
    setDrag({
      kind: 'move',
      nodeId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      origX: pos.x,
      origY: pos.y,
    });
    props.onSelectNode(nodeId);
  }

  function onNodeConnectStart(nodeId: string, e: PointerEvent) {
    const { x, y } = toCanvasCoords(e.clientX, e.clientY);
    setDrag({ kind: 'connect', sourceId: nodeId, cursorX: x, cursorY: y });
  }

  function onPointerMove(e: PointerEvent) {
    const d = drag();
    if (d.kind === 'move') {
      const dx = e.clientX - d.startClientX;
      const dy = e.clientY - d.startClientY;
      props.onNodeMove?.(d.nodeId, d.origX + dx, d.origY + dy);
      return;
    }
    if (d.kind === 'connect') {
      const { x, y } = toCanvasCoords(e.clientX, e.clientY);
      setDrag({ ...d, cursorX: x, cursorY: y });
      return;
    }
    if (isPanning()) {
      setPan({
        x: panStart.panX + (e.clientX - panStart.x),
        y: panStart.panY + (e.clientY - panStart.y),
      });
    }
  }

  function onPointerUp(e: PointerEvent) {
    const d = drag();
    if (d.kind === 'move') {
      props.onNodeMoveEnd?.();
    } else if (d.kind === 'connect') {
      const target = document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest('[data-node-id]') as HTMLElement | null;
      const targetId = target?.dataset.nodeId;
      if (targetId && targetId !== d.sourceId) {
        props.onConnect?.(d.sourceId, targetId);
      }
    }
    setDrag({ kind: 'none' });
    setIsPanning(false);
  }

  function resetView() {
    setPan({ x: 0, y: 0 });
  }

  return (
    <div
      ref={rootEl}
      class="workflow-canvas relative w-full h-full overflow-hidden bg-gray-50 dark:bg-gray-950 cursor-grab"
      classList={{ 'cursor-grabbing': isPanning() }}
      onPointerDown={onBackgroundPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
    >
      <button
        type="button"
        class="absolute top-2 right-2 z-10 px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
        onClick={(e) => {
          e.stopPropagation();
          resetView();
        }}
      >
        Reset view
      </button>

      <div
        class="absolute inset-0"
        style={{ transform: `translate(${pan().x}px, ${pan().y}px)` }}
      >
        <svg class="absolute inset-0 w-[6000px] h-[4000px] overflow-visible pointer-events-none">
          <defs>
            <marker
              id="wf-arrow"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path
                d="M 0 0 L 10 5 L 0 10 z"
                class="fill-gray-400 dark:fill-gray-500"
              />
            </marker>
          </defs>
          <For each={props.edges}>
            {(edge) => {
              const from = () => props.positions[edge.dependsOnSubtaskId];
              const to = () => props.positions[edge.subtaskId];
              return (
                <Show when={from() && to()}>
                  <g
                    class="pointer-events-auto cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onSelectEdge(edge.id);
                    }}
                  >
                    <path
                      d={edgePath(from()!, to()!)}
                      fill="none"
                      stroke-width={
                        props.selectedEdgeId === edge.id ? 2.5 : 1.5
                      }
                      class={
                        edge.edgeKind === 'conditional'
                          ? 'stroke-purple-400 dark:stroke-purple-500'
                          : 'stroke-gray-400 dark:stroke-gray-500'
                      }
                      stroke-dasharray={
                        edge.edgeKind === 'conditional' ? '6,4' : undefined
                      }
                      marker-end="url(#wf-arrow)"
                    />
                    <Show
                      when={edge.edgeKind === 'conditional' && edge.condition}
                    >
                      <foreignObject
                        x={(from()!.x + to()!.x) / 2 - 60}
                        y={(from()!.y + to()!.y) / 2 - 10}
                        width={120}
                        height={20}
                      >
                        <div class="flex justify-center">
                          <span class="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-700 whitespace-nowrap">
                            {edge.condition!.operator} "{edge.condition!.value}"
                          </span>
                        </div>
                      </foreignObject>
                    </Show>
                  </g>
                </Show>
              );
            }}
          </For>

          {/* Live preview line while dragging a new connection. */}
          <Show when={drag().kind === 'connect'}>
            {(() => {
              const d = drag() as {
                kind: 'connect';
                sourceId: string;
                cursorX: number;
                cursorY: number;
              };
              const from = props.positions[d.sourceId];
              return (
                <Show when={from}>
                  <path
                    d={edgePath(from!, {
                      x: d.cursorX,
                      y: d.cursorY + NODE_HEIGHT / 2,
                    })}
                    fill="none"
                    stroke-width={1.5}
                    class="stroke-blue-400 dark:stroke-blue-500"
                    stroke-dasharray="4,4"
                  />
                </Show>
              );
            })()}
          </Show>
        </svg>

        <For each={props.subtasks}>
          {(subtask) => {
            const pos = () => props.positions[subtask.id];
            return (
              <Show when={pos()}>
                <WorkflowNode
                  subtask={subtask}
                  agents={props.agents}
                  x={pos()!.x}
                  y={pos()!.y}
                  selected={props.selectedNodeId === subtask.id}
                  onSelect={() => props.onSelectNode(subtask.id)}
                  onMoveStart={(e) => onNodeMoveStart(subtask.id, e)}
                  onConnectStart={(e) => onNodeConnectStart(subtask.id, e)}
                />
              </Show>
            );
          }}
        </For>
      </div>
    </div>
  );
}
