/**
 * Top-level container for the subtask workflow canvas: loads
 * subtasks + dependency-graph edges, computes node positions
 * (positions saved on the server, else auto-layout), and renders the
 * canvas + property panel side by side. Owns all editing actions
 * (add/delete subtask, drag-to-connect edge creation, edge/node property
 * edits, approval resolution, retrying a step). The parent bumps
 * `refreshKey` when the server reports a change, only asks for polling
 * while live updates are unavailable, and sets `locked` while a run is
 * going (the server refuses graph edits then).
 */

import { createSignal, createEffect, onCleanup, Show } from 'solid-js';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import {
  listSubtasks,
  listSubtaskEdges,
  createSubtask,
  updateSubtask,
  deleteSubtask,
  createSubtaskEdge,
  updateSubtaskEdge,
  deleteSubtaskEdge,
  assignSubtaskAgent,
  resolveApproval,
  retrySubtask,
  saveWorkflowLayout,
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
  /** Changes whenever the workflow changed on the server; triggers a reload. */
  refreshKey?: number;
  /** Poll for changes (live updates are down while a run is going). */
  pollForChanges?: boolean;
  /** Called after an action here changed the run (approve, retry). */
  onRunChanged?: () => void;
  /** A run is going: show the graph read-only. */
  locked?: boolean;
};

const POLL_INTERVAL_MS = 3000;

// Positions used to live in this browser's localStorage. They're read once
// to carry an existing layout over to the server, then dropped.
function positionsStorageKey(taskId: string) {
  return `workflow-positions:${taskId}`;
}

function takeLegacyPositions(
  taskId: string,
): Record<string, { x: number; y: number }> {
  try {
    const raw = localStorage.getItem(positionsStorageKey(taskId));
    localStorage.removeItem(positionsStorageKey(taskId));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
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
  const [pendingDelete, setPendingDelete] = createSignal<Subtask | null>(null);
  // The node being dragged keeps its in-memory position over whatever a
  // reload brings in, so a refresh mid-drag doesn't snap it back.
  let draggingId: string | null = null;
  let legacyPositions: Record<string, { x: number; y: number }> | null = null;

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

      legacyPositions ??= takeLegacyPositions(props.taskId);
      const legacy = legacyPositions;
      const saved: Record<string, { x: number; y: number }> = {};
      for (const s of nextSubtasks) {
        if (s.positionX != null && s.positionY != null) {
          saved[s.id] = { x: s.positionX, y: s.positionY };
        }
      }
      // Priority: the node being dragged, then positions saved on the
      // server, then ones only known here (a node just placed by
      // handleAddSubtask, or the old localStorage layout), then auto-layout.
      const current = positions();
      const nodeIds = nextSubtasks.map((s) => s.id);
      const missingIds = nodeIds.filter(
        (id) => !saved[id] && !current[id] && !legacy[id],
      );
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
        merged[id] = (id === draggingId ? current[id] : undefined) ??
          saved[id] ??
          current[id] ??
          legacy[id] ??
          autoPositions[id] ?? { x: 0, y: 0 };
      }
      setPositions(merged);
      if (Object.keys(legacy).some((id) => !saved[id] && merged[id])) {
        legacyPositions = {};
        void persistLayout();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load workflow');
    } finally {
      setIsLoading(false);
    }
  }

  createEffect(() => {
    if (props.taskId) void load();
  });

  let lastRefreshKey = props.refreshKey;
  createEffect(() => {
    const key = props.refreshKey;
    if (key === lastRefreshKey) return;
    lastRefreshKey = key;
    void load();
  });

  createEffect(() => {
    if (!props.pollForChanges) return;
    const interval = window.setInterval(() => void load(), POLL_INTERVAL_MS);
    onCleanup(() => window.clearInterval(interval));
  });

  function selectNode(id: string | null) {
    setSelection(id ? { type: 'node', id } : null);
  }
  function selectEdge(id: string | null) {
    setSelection(id ? { type: 'edge', id } : null);
  }
  function selectedNodeId(): string | null {
    const sel = selection();
    return sel?.type === 'node' ? sel.id : null;
  }
  function selectedEdgeId(): string | null {
    const sel = selection();
    return sel?.type === 'edge' ? sel.id : null;
  }

  // ── Node position editing ────────────────────────────────────────────────

  function handleNodeMove(id: string, x: number, y: number) {
    draggingId = id;
    setPositions((prev) => ({ ...prev, [id]: { x, y } }));
  }

  /** Saves every node's position, so the layout is the same everywhere. */
  async function persistLayout() {
    const result = await saveWorkflowLayout(props.taskId, positions());
    if (!result.ok) setActionError(result.error.message);
  }

  function handleNodeMoveEnd() {
    // A click without movement also ends a "move"; nothing to save then.
    if (draggingId === null) return;
    draggingId = null;
    void persistLayout();
  }

  // ── Node CRUD ─────────────────────────────────────────────────────────────

  async function handleAddSubtask(kind: SubtaskKind) {
    setActionError(null);
    // No title — the server derives one from the description, so a fresh
    // node's title tracks whatever placeholder/real description it has
    // instead of getting stuck on a generic "New subtask" the user has to
    // remember to overwrite.
    const result = await createSubtask({
      taskId: props.taskId,
      description:
        kind === 'approval_gate'
          ? 'Pause here for a human decision'
          : 'New step — click to describe what it should do',
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

  /** Resolves true once the server has saved the change. */
  async function handleUpdateSubtask(
    id: string,
    updates: {
      title?: string;
      description?: string;
      subtaskKind?: SubtaskKind;
      loop?: LoopConfig | null;
    },
  ): Promise<boolean> {
    setActionError(null);
    const result = await updateSubtask(id, updates);
    if (!result.ok) {
      setActionError(result.error.message);
      return false;
    }
    await load();
    return true;
  }

  function handleDeleteSubtask(id: string) {
    const subtask = subtasks().find((s) => s.id === id);
    if (subtask) setPendingDelete(subtask);
  }

  async function confirmDeleteSubtask() {
    const subtask = pendingDelete();
    setPendingDelete(null);
    if (!subtask) return;
    setActionError(null);
    const result = await deleteSubtask(subtask.id);
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
    if (props.locked) {
      setActionError(
        "The workflow is running, so its steps can't be changed. Stop the run to edit them.",
      );
      return;
    }
    if (sourceId === targetId) {
      setActionError(
        'A node can\'t connect to itself. To repeat a step, select it and turn on "Repeat until condition" in the panel instead.',
      );
      return;
    }
    if (
      wouldCreateCycle(
        edges().map((e) => ({
          subtaskId: e.subtaskId,
          dependsOnSubtaskId: e.dependsOnSubtaskId,
        })),
        { subtaskId: targetId, dependsOnSubtaskId: sourceId },
      )
    ) {
      setActionError(
        'That connection would create a cycle between multiple steps, which isn\'t supported. To repeat a single step, select it and turn on "Repeat until condition" in the panel instead.',
      );
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

  /** Resolves true once the server has saved the change. */
  async function handleUpdateEdge(
    id: string,
    updates: {
      edgeKind?: 'dependency' | 'conditional';
      condition?: EdgeCondition | null;
    },
  ): Promise<boolean> {
    setActionError(null);
    const result = await updateSubtaskEdge(id, updates);
    if (!result.ok) {
      setActionError(result.error.message);
      return false;
    }
    await load();
    return true;
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
    props.onRunChanged?.();
  }

  async function handleRetryStep(id: string) {
    setActionError(null);
    const result = await retrySubtask(id);
    if (!result.ok) {
      setActionError(result.error.message);
      return;
    }
    await load();
    props.onRunChanged?.();
  }

  async function handleAssignAgent(id: string, agentId: string | null) {
    setActionError(null);
    const result = await assignSubtaskAgent(id, agentId);
    if (!result.ok) {
      setActionError(result.error.message);
      return;
    }
    await load();
  }

  return (
    <div class="workflow-editor h-full w-full flex flex-col">
      <Show when={actionError()}>
        <div
          role="status"
          aria-live="assertive"
          class="px-3 py-1.5 text-xs bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border-b border-red-200 dark:border-red-800 flex items-center justify-between"
        >
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
      <Show when={props.locked}>
        <div
          role="status"
          class="px-3 py-1.5 text-xs bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border-b border-amber-200 dark:border-amber-800"
        >
          The workflow is running, so its steps can't be changed. Stop the run
          to edit them.
        </div>
      </Show>
      <div class="flex-1 flex flex-col sm:flex-row min-h-0">
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
          <div class="flex-1 min-w-0 min-h-0">
            <WorkflowCanvas
              subtasks={subtasks()}
              edges={edges()}
              agents={props.agents}
              positions={positions()}
              selectedNodeId={selectedNodeId()}
              selectedEdgeId={selectedEdgeId()}
              onSelectNode={selectNode}
              onSelectEdge={selectEdge}
              onNodeMove={handleNodeMove}
              onNodeMoveEnd={handleNodeMoveEnd}
              onConnect={handleConnect}
              onDeleteEdge={handleDeleteEdge}
            />
          </div>
          {/* Below sm: a bottom sheet (bounded height, full width) so the
              canvas keeps most of a narrow screen. sm and up: unchanged
              fixed-width side column. */}
          <div class="w-full sm:w-72 max-h-[45vh] sm:max-h-none flex-shrink-0">
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
              onRetryStep={handleRetryStep}
              onAssignAgent={handleAssignAgent}
              locked={props.locked ?? false}
            />
          </div>
        </Show>
      </div>
      <ConfirmDialog
        isOpen={pendingDelete() !== null}
        title="Delete step?"
        body={`"${pendingDelete()?.title ?? ''}" and its connections will be removed. This can't be undone.`}
        confirmLabel="Delete"
        tone="danger"
        onConfirm={() => void confirmDeleteSubtask()}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
