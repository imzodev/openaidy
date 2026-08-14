/**
 * WorkflowThumbnail — a small, non-interactive preview of a workflow's
 * subtask graph, used on the Workflows list page. Reuses the exact same
 * layout algorithm as the real WorkflowCanvas (`computeAutoLayout`), just
 * rendered into a fixed viewBox instead of a pannable/draggable canvas.
 */

import { createSignal, onMount, For, Show } from 'solid-js';
import { Workflow } from 'lucide-solid';
import {
  listSubtasks,
  listSubtaskEdges,
  type Subtask,
  type SubtaskEdgeDto,
} from '../../lib/api-tasks';
import { computeAutoLayout, NODE_WIDTH } from '../../lib/workflow-layout';
import { STATUS_COLORS } from '../tasks/subtask-status';

export type WorkflowThumbnailProps = {
  taskId: string;
};

const DOT_RADIUS = NODE_WIDTH / 8;
const GATE_SIZE = DOT_RADIUS * 1.6;
const PADDING = NODE_WIDTH / 2;

export function WorkflowThumbnail(props: WorkflowThumbnailProps) {
  const [subtasks, setSubtasks] = createSignal<Subtask[]>([]);
  const [edges, setEdges] = createSignal<SubtaskEdgeDto[]>([]);
  const [isLoading, setIsLoading] = createSignal(true);

  onMount(async () => {
    try {
      const [subtasksRes, edgesRes] = await Promise.all([
        listSubtasks(props.taskId),
        listSubtaskEdges(props.taskId),
      ]);
      setSubtasks(subtasksRes.items);
      setEdges(edgesRes.items);
    } catch {
      // Non-fatal — the card just renders without a preview.
    } finally {
      setIsLoading(false);
    }
  });

  const positions = () =>
    computeAutoLayout(
      subtasks().map((s) => s.id),
      edges().map((e) => ({ from: e.dependsOnSubtaskId, to: e.subtaskId })),
    );

  const viewBox = () => {
    const pos = Object.values(positions());
    if (pos.length === 0) return '0 0 100 60';
    const minX = Math.min(...pos.map((p) => p.x)) - PADDING;
    const maxX = Math.max(...pos.map((p) => p.x)) + PADDING;
    const minY = Math.min(...pos.map((p) => p.y)) - PADDING;
    const maxY = Math.max(...pos.map((p) => p.y)) + PADDING;
    return `${minX} ${minY} ${maxX - minX} ${maxY - minY}`;
  };

  return (
    <div class="w-full h-24 rounded-lg overflow-hidden bg-gray-50 dark:bg-gray-800/50 bg-[radial-gradient(circle,theme(colors.gray.300)_1px,transparent_1px)] dark:bg-[radial-gradient(circle,theme(colors.gray.700)_1px,transparent_1px)] [background-size:14px_14px]">
      <Show
        when={!isLoading()}
        fallback={<div class="w-full h-full animate-pulse" />}
      >
        <Show
          when={subtasks().length > 0}
          fallback={
            <div class="w-full h-full flex flex-col items-center justify-center gap-1 text-text-tertiary">
              <Workflow class="w-5 h-5 opacity-40" />
              <span class="text-xs">Empty workflow</span>
            </div>
          }
        >
          <svg
            viewBox={viewBox()}
            class="w-full h-full"
            preserveAspectRatio="xMidYMid meet"
          >
            <For each={edges()}>
              {(edge) => {
                const from = () => positions()[edge.dependsOnSubtaskId];
                const to = () => positions()[edge.subtaskId];
                return (
                  <Show when={from() && to()}>
                    <line
                      x1={from()!.x}
                      y1={from()!.y}
                      x2={to()!.x}
                      y2={to()!.y}
                      class="stroke-gray-300 dark:stroke-gray-600"
                      stroke-width={3}
                      stroke-dasharray={
                        edge.edgeKind === 'conditional' ? '6 4' : undefined
                      }
                    />
                  </Show>
                );
              }}
            </For>
            <For each={subtasks()}>
              {(subtask) => {
                const pos = () => positions()[subtask.id];
                const colorClass = () =>
                  STATUS_COLORS[subtask.status] ?? STATUS_COLORS.pending;
                return (
                  <Show when={pos()}>
                    <Show
                      when={subtask.subtaskKind === 'approval_gate'}
                      fallback={
                        <circle
                          cx={pos()!.x}
                          cy={pos()!.y}
                          r={DOT_RADIUS}
                          class={colorClass()}
                          fill="currentColor"
                        />
                      }
                    >
                      <rect
                        x={pos()!.x - GATE_SIZE / 2}
                        y={pos()!.y - GATE_SIZE / 2}
                        width={GATE_SIZE}
                        height={GATE_SIZE}
                        class={colorClass()}
                        fill="currentColor"
                      />
                    </Show>
                  </Show>
                );
              }}
            </For>
          </svg>
        </Show>
      </Show>
    </div>
  );
}
