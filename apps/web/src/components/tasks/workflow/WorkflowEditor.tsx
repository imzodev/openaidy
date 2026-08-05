/**
 * Top-level container for the subtask workflow canvas: loads
 * subtasks + dependency-graph edges, computes node positions
 * (auto-layout merged with any positions the user dragged and saved
 * to localStorage), and renders the canvas + property panel side by
 * side. Owns all editing actions (add/delete subtask, drag-to-connect
 * edge creation, edge/node property edits, approval resolution) and
 * polls for status updates while the task is running.
 */

import { createSignal, createEffect, onCleanup, Show } from 'solid-js';
import {
  listSubtasks,
  listSubtaskEdges,
  createSubtask,
  updateSubtask,
  deleteSubtask,
  createSubtaskEdge,
  updateSubtaskEdge,
  deleteSubtaskEdge,
  resolveApproval,
  type Subtask,
  type SubtaskEdgeDto,
  type SubtaskKind,
  type LoopConfig,
  type EdgeCondition,
} from '../../../lib/api-tasks';
import type { Agent } from '../AgentSelector';
import { WorkflowCanvas } from './WorkflowCanvas';
import {
  WorkflowPropertyPanel,
  type WorkflowSelection,
} from './WorkflowPropertyPanel';
import { computeAutoLayout, NODE_WIDTH } from '../../../lib/workflow-layout';
import { wouldCreateCycle } from '../../../lib/workflow-graph';

export type WorkflowEditorProps = {
  taskId: string;
  agents: Agent[];
  isTaskRunning: boolean;
};

const POLL_INTERVAL_MS = 3000;

function positionsStorageKey(taskId: string) {
  return `workflow-positions:${taskId}`;
}

function loadStoredPositions(
  taskId: string,
): Record<string, { x: number; y: number }> {
  try {
    const raw = localStorage.getItem(positionsStorageKey(taskId));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveStoredPositions(
  taskId: string,
  positions: Record<string, { x: number; y: number }>,
) {
  try {
    localStorage.setItem(
      positionsStorageKey(taskId),
      JSON.stringify(positions),
    );
  } catch {
    // best-effort only
  }
}

export function WorkflowEditor(props: WorkflowEditorProps) {
  const [subtasks, setSubtasks] = createSignal<Subtask[]>([]);
  const [edges, setEdges] = createSignal<SubtaskEdgeDto[]>([]);
  const [positions, setPositions] = createSignal<
    Record<string, { x: number; y: number }>
  >({});
  const [selection, setSelection] = createSignal<WorkflowSelection>(null);
  const [isLoading, setIsLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [actionError, setActionError] = createSignal<string | null>(null);

  async function load() {
    try {
      const [subtasksResult, edgesResult] = await Promise.all([
        listSubtasks(props.taskId),
        listSubtaskEdges(props.taskId),
      ]);
      const nextSubtasks = subtasksResult.items;
      const nextEdges = edgesResult.items;
      setSubtasks(nextSubtasks);
      setEdges(nextEdges);

      const stored = loadStoredPositions(props.taskId);
      const nodeIds = nextSubtasks.map((s) => s.id);
      const missingIds = nodeIds.filter((id) => !stored[id]);
      const autoPositions =
        missingIds.length > 0
          ? computeAutoLayout(
              nodeIds,
              nextEdges.map((e) => ({
                from: e.dependsOnSubtaskId,
                to: e.subtaskId,
              })),
            )
          : {};
      const merged: Record<string, { x: number; y: number }> = {};
      for (const id of nodeIds) {
        merged[id] = stored[id] ?? autoPositions[id] ?? { x: 0, y: 0 };
      }
      setPositions(merged);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load workflow');
    } finally {
      setIsLoading(false);
    }
  }

  createEffect(() => {
    if (props.taskId) void load();
  });

  createEffect(() => {
    if (!props.isTaskRunning) return;
    const interval = window.setInterval(() => void load(), POLL_INTERVAL_MS);
    onCleanup(() => window.clearInterval(interval));
  });

  function selectNode(id: string | null) {
    setSelection(id ? { type: 'node', id } : null);
  }
  function selectEdge(id: string | null) {
    setSelection(id ? { type: 'edge', id } : null);
  }

  // ── Node position editing ────────────────────────────────────────────────

  function handleNodeMove(id: string, x: number, y: number) {
    setPositions((prev) => ({ ...prev, [id]: { x, y } }));
  }

  function handleNodeMoveEnd() {
    saveStoredPositions(props.taskId, positions());
  }

  // ── Node CRUD ─────────────────────────────────────────────────────────────

  async function handleAddSubtask(kind: SubtaskKind) {
    setActionError(null);
    const result = await createSubtask({
      taskId: props.taskId,
      title: kind === 'approval_gate' ? 'New approval gate' : 'New subtask',
      description: 'Describe what this step should do.',
      subtaskKind: kind,
    });
    if (!result.ok) {
      setActionError(result.error.message);
      return;
    }
    // Place the new node near the current view center, avoiding overlap
    // with the auto-layout by nudging it slightly per existing node count.
    const offset = subtasks().length * 30;
    setPositions((prev) => ({
      ...prev,
      [result.data.id]: { x: NODE_WIDTH + offset, y: 80 + offset },
    }));
    await load();
    selectNode(result.data.id);
  }

  async function handleUpdateSubtask(
    id: string,
    updates: {
      title?: string;
      description?: string;
      subtaskKind?: SubtaskKind;
      loop?: LoopConfig | null;
    },
  ) {
    setActionError(null);
    const result = await updateSubtask(id, updates);
    if (!result.ok) {
      setActionError(result.error.message);
      return;
    }
    await load();
  }

  async function handleDeleteSubtask(id: string) {
    setActionError(null);
    const result = await deleteSubtask(id);
    if (!result.ok) {
      setActionError(result.error.message);
      return;
    }
    setSelection(null);
    await load();
  }

  // ── Edge CRUD ─────────────────────────────────────────────────────────────

  async function handleConnect(sourceId: string, targetId: string) {
    setActionError(null);
    if (
      wouldCreateCycle(
        edges().map((e) => ({
          subtaskId: e.subtaskId,
          dependsOnSubtaskId: e.dependsOnSubtaskId,
        })),
        { subtaskId: targetId, dependsOnSubtaskId: sourceId },
      )
    ) {
      setActionError('That connection would create a cycle.');
      return;
    }
    const result = await createSubtaskEdge(props.taskId, {
      subtaskId: targetId,
      dependsOnSubtaskId: sourceId,
    });
    if (!result.ok) {
      setActionError(result.error.message);
      return;
    }
    await load();
    selectEdge(result.data.id);
  }

  async function handleUpdateEdge(
    id: string,
    updates: {
      edgeKind?: 'dependency' | 'conditional';
      condition?: EdgeCondition | null;
    },
  ) {
    setActionError(null);
    const result = await updateSubtaskEdge(id, updates);
    if (!result.ok) {
      setActionError(result.error.message);
      return;
    }
    await load();
  }

  async function handleDeleteEdge(id: string) {
    setActionError(null);
    const result = await deleteSubtaskEdge(id);
    if (!result.ok) {
      setActionError(result.error.message);
      return;
    }
    setSelection(null);
    await load();
  }

  // ── Approval ──────────────────────────────────────────────────────────────

  async function handleResolveApproval(
    id: string,
    decision: 'approved' | 'rejected',
    note?: string,
  ) {
    setActionError(null);
    const result = await resolveApproval(id, decision, note);
    if (!result.ok) {
      setActionError(result.error.message);
      return;
    }
    await load();
  }

  return (
    <div class="workflow-editor h-full w-full flex flex-col">
      <Show when={actionError()}>
        <div class="px-3 py-1.5 text-xs bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border-b border-red-200 dark:border-red-800 flex items-center justify-between">
          {actionError()}
          <button
            type="button"
            class="ml-2 text-red-400 hover:text-red-600"
            onClick={() => setActionError(null)}
          >
            ✕
          </button>
        </div>
      </Show>
      <div class="flex-1 flex min-h-0">
        <Show when={isLoading()}>
          <div class="flex-1 flex items-center justify-center text-gray-500 dark:text-gray-400">
            Loading workflow…
          </div>
        </Show>
        <Show when={error()}>
          <div class="flex-1 flex items-center justify-center text-red-500">
            {error()}
          </div>
        </Show>
        <Show when={!isLoading() && !error()}>
          <div class="flex-1 min-w-0">
            <WorkflowCanvas
              subtasks={subtasks()}
              edges={edges()}
              agents={props.agents}
              positions={positions()}
              selectedNodeId={
                selection()?.type === 'node' ? selection()!.id : null
              }
              selectedEdgeId={
                selection()?.type === 'edge' ? selection()!.id : null
              }
              onSelectNode={selectNode}
              onSelectEdge={selectEdge}
              onNodeMove={handleNodeMove}
              onNodeMoveEnd={handleNodeMoveEnd}
              onConnect={handleConnect}
            />
          </div>
          <div class="w-72 flex-shrink-0">
            <WorkflowPropertyPanel
              subtasks={subtasks()}
              edges={edges()}
              agents={props.agents}
              selection={selection()}
              onAddSubtask={handleAddSubtask}
              onUpdateSubtask={handleUpdateSubtask}
              onDeleteSubtask={handleDeleteSubtask}
              onUpdateEdge={handleUpdateEdge}
              onDeleteEdge={handleDeleteEdge}
              onResolveApproval={handleResolveApproval}
            />
          </div>
        </Show>
      </div>
    </div>
  );
}
