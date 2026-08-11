/**
 * Right-side panel for the workflow canvas: shows + edits whatever is
 * selected (a node or an edge). "Add subtask"/"Add approval gate" and a
 * toggleable legend live in a persistent header so they're reachable no
 * matter what's selected, instead of only when nothing is.
 */

import { Show, For, createMemo, createEffect, createSignal } from 'solid-js';
import {
  Plus,
  Trash2,
  Hourglass,
  Check,
  X,
  Info,
  CircleCheck,
  Repeat,
  MousePointerClick,
} from 'lucide-solid';
import type {
  Subtask,
  SubtaskEdgeDto,
  SubtaskKind,
  LoopConfig,
  EdgeCondition,
  ConditionOperator,
} from '../../../lib/api-tasks';
import type { Agent } from '../AgentSelector';
import { STATUS_ICONS, STATUS_BADGE_BG } from '../subtask-status';

export type WorkflowSelection =
  | { type: 'node'; id: string }
  | { type: 'edge'; id: string }
  | null;

export type WorkflowPropertyPanelProps = {
  subtasks: Subtask[];
  edges: SubtaskEdgeDto[];
  agents?: Agent[];
  selection: WorkflowSelection;
  onAddSubtask: (kind: SubtaskKind) => void;
  onUpdateSubtask: (
    id: string,
    updates: {
      title?: string;
      description?: string;
      loop?: LoopConfig | null;
    },
  ) => void;
  onDeleteSubtask: (id: string) => void;
  onUpdateEdge: (
    id: string,
    updates: {
      edgeKind?: 'dependency' | 'conditional';
      condition?: EdgeCondition | null;
    },
  ) => void;
  onDeleteEdge: (id: string) => void;
  onResolveApproval: (
    id: string,
    decision: 'approved' | 'rejected',
    note?: string,
  ) => void;
  onAssignAgent: (id: string, agentId: string) => void;
};

const CONDITION_OPERATORS: ConditionOperator[] = [
  'equals',
  'contains',
  'matches_regex',
];

/** Small "Saved" flash shown after a blur-triggered autosave, so editing a
 * field doesn't feel like it silently did nothing. Optimistic — it fires
 * as soon as the save is dispatched, not once the server confirms it (a
 * real failure still surfaces via the WorkflowEditor's error banner). */
function SaveIndicator(props: { status: () => 'idle' | 'saved' }) {
  return (
    <Show when={props.status() === 'saved'}>
      <span class="inline-flex items-center gap-1 text-[11px] text-green-600 dark:text-green-400">
        <CircleCheck class="w-3 h-3" />
        Saved
      </span>
    </Show>
  );
}

export function WorkflowPropertyPanel(props: WorkflowPropertyPanelProps) {
  const selectedSubtask = createMemo(() => {
    const sel = props.selection;
    return sel?.type === 'node'
      ? (props.subtasks.find((s) => s.id === sel.id) ?? null)
      : null;
  });
  const selectedEdge = createMemo(() => {
    const sel = props.selection;
    return sel?.type === 'edge'
      ? (props.edges.find((e) => e.id === sel.id) ?? null)
      : null;
  });

  const [showHelp, setShowHelp] = createSignal(false);

  // Node draft state
  const [draftTitle, setDraftTitle] = createSignal('');
  const [draftDescription, setDraftDescription] = createSignal('');
  const [loopEnabled, setLoopEnabled] = createSignal(false);
  const [loopMax, setLoopMax] = createSignal(3);
  const [loopOperator, setLoopOperator] =
    createSignal<ConditionOperator>('contains');
  const [loopValue, setLoopValue] = createSignal('');
  const [approvalNote, setApprovalNote] = createSignal('');
  const [fieldsSaveStatus, setFieldsSaveStatus] = createSignal<
    'idle' | 'saved'
  >('idle');
  const [loopSaveStatus, setLoopSaveStatus] = createSignal<'idle' | 'saved'>(
    'idle',
  );

  // Edge draft state
  const [edgeKind, setEdgeKind] = createSignal<'dependency' | 'conditional'>(
    'dependency',
  );
  const [edgeOperator, setEdgeOperator] =
    createSignal<ConditionOperator>('equals');
  const [edgeValue, setEdgeValue] = createSignal('');
  const [edgeSaveStatus, setEdgeSaveStatus] = createSignal<'idle' | 'saved'>(
    'idle',
  );

  function flash(setStatus: (s: 'idle' | 'saved') => void) {
    setStatus('saved');
    setTimeout(() => setStatus('idle'), 1500);
  }

  // Tracks the previously-selected subtask so a switch to a different
  // node flushes any edited-but-unsaved title/description first (dirty
  // check against what was last committed), instead of silently
  // discarding it. Comparing by id (not object identity) also means a
  // background poll refetching the same subtask doesn't re-trigger this
  // — only an actual selection change does.
  let lastSubtaskId: string | undefined;
  let lastCommittedTitle = '';
  let lastCommittedDescription = '';

  createEffect(() => {
    const subtask = selectedSubtask();
    const currentId = subtask?.id;
    if (currentId === lastSubtaskId) return;

    if (lastSubtaskId) {
      const dirty =
        draftTitle() !== lastCommittedTitle ||
        draftDescription() !== lastCommittedDescription;
      if (dirty) {
        props.onUpdateSubtask(lastSubtaskId, {
          title: draftTitle(),
          description: draftDescription(),
        });
      }
    }
    lastSubtaskId = currentId;
    if (!subtask) return;

    setDraftTitle(subtask.title);
    setDraftDescription(subtask.description);
    lastCommittedTitle = subtask.title;
    lastCommittedDescription = subtask.description;
    setLoopEnabled(subtask.loopMaxIterations != null);
    setLoopMax(subtask.loopMaxIterations ?? 3);
    setLoopOperator(
      (subtask.loopConditionOperator as ConditionOperator) ?? 'contains',
    );
    setLoopValue(subtask.loopConditionValue ?? '');
    setApprovalNote('');
  });

  // Same dirty-check-by-id pattern as the node effect above: a background
  // poll refetching the same selected edge (e.g. while the workflow is
  // running) must not clobber an operator/value the user is mid-typing
  // before they've blurred to save it. Only an actual selection change
  // (a different edge id) should reset the draft fields.
  let lastEdgeId: string | undefined;
  createEffect(() => {
    const edge = selectedEdge();
    const currentId = edge?.id;
    if (currentId === lastEdgeId) return;
    lastEdgeId = currentId;
    if (!edge) return;
    setEdgeKind(edge.edgeKind);
    setEdgeOperator(edge.condition?.operator ?? 'equals');
    setEdgeValue(edge.condition?.value ?? '');
  });

  const dependsOn = createMemo(() => {
    const subtask = selectedSubtask();
    if (!subtask) return [];
    return props.edges
      .filter((e) => e.subtaskId === subtask.id)
      .map((e) => ({
        edge: e,
        subtask: props.subtasks.find((s) => s.id === e.dependsOnSubtaskId),
      }));
  });

  function saveNodeFields(id: string) {
    props.onUpdateSubtask(id, {
      title: draftTitle(),
      description: draftDescription(),
    });
    lastCommittedTitle = draftTitle();
    lastCommittedDescription = draftDescription();
    flash(setFieldsSaveStatus);
  }

  function saveLoopConfig(id: string) {
    if (!loopEnabled()) {
      props.onUpdateSubtask(id, { loop: null });
    } else {
      // Same empty-value guard as saveEdgeFields: the server requires a
      // non-empty condition value, but checking "Repeat until condition"
      // fires this save before the user has typed one. Skip silently;
      // the value input's onBlur saves once it's filled in.
      if (loopValue().trim() === '') return;
      props.onUpdateSubtask(id, {
        loop: {
          maxIterations: loopMax(),
          conditionOperator: loopOperator(),
          conditionValue: loopValue(),
        },
      });
    }
    flash(setLoopSaveStatus);
  }

  function saveEdgeFields(id: string) {
    // The server requires a non-empty condition value for a conditional
    // edge. Checking "Conditional" (or changing the operator) fires this
    // save immediately, before the user has typed a value — without this
    // guard, that first save always fails with a raw validation error.
    // Skip it silently; the value input's onBlur saves once it's filled in.
    if (edgeKind() === 'conditional' && edgeValue().trim() === '') return;
    props.onUpdateEdge(id, {
      edgeKind: edgeKind(),
      condition:
        edgeKind() === 'conditional'
          ? { operator: edgeOperator(), value: edgeValue() }
          : null,
    });
    flash(setEdgeSaveStatus);
  }

  return (
    <div class="workflow-property-panel h-full flex flex-col border-t sm:border-t-0 sm:border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm">
      {/* Persistent toolbar — reachable no matter what's selected. */}
      <div class="flex-shrink-0 flex items-center justify-between gap-2 p-3 border-b border-gray-200 dark:border-gray-700">
        <div class="flex flex-wrap gap-1.5">
          <button
            type="button"
            class="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-primary hover:bg-primary-hover text-white shadow-sm transition-colors"
            onClick={() => props.onAddSubtask('agent')}
          >
            <Plus class="w-3.5 h-3.5" />
            Add subtask
          </button>
          <button
            type="button"
            class="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-amber-300 dark:border-amber-700 text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors"
            onClick={() => props.onAddSubtask('approval_gate')}
          >
            <Hourglass class="w-3.5 h-3.5" />
            Add gate
          </button>
        </div>
        <button
          type="button"
          class="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 dark:hover:text-gray-300 transition-colors"
          classList={{ 'text-primary dark:text-primary': showHelp() }}
          title="How this works"
          onClick={() => setShowHelp((v) => !v)}
        >
          <Info class="w-4 h-4" />
        </button>
      </div>

      <Show when={showHelp()}>
        <div class="flex-shrink-0 p-3 border-b border-gray-200 dark:border-gray-700 space-y-1.5 text-xs text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/50">
          <div class="flex items-center gap-2">
            <span class="w-6 h-0.5 bg-gray-400 dark:bg-gray-500" />
            Dependency edge — drag from a node's bottom handle onto another node
            to create one
          </div>
          <div class="flex items-center gap-2">
            <span class="w-6 h-0.5 border-t-2 border-dashed border-purple-400 dark:border-purple-500" />
            Conditional edge — select an edge, check "Conditional"
          </div>
          <div class="flex items-center gap-2">
            <Trash2 class="w-3 h-3" />
            Delete a node or edge — select it, then use the trash icon (or press
            Delete/Backspace on a selected edge)
          </div>
          <div class="flex items-center gap-2">
            <Repeat class="w-3 h-3 text-indigo-500" />
            Loop — a node can't connect to itself or form a cycle; instead
            select it and turn on "Repeat until condition" below
          </div>
          <div class="flex items-center gap-2">
            <Hourglass class="w-3 h-3 text-amber-500" />
            Approval gate — pauses the workflow for a human decision
          </div>
        </div>
      </Show>

      <div class="flex-1 overflow-y-auto p-3">
        <Show
          when={selectedSubtask() || selectedEdge()}
          fallback={
            <div class="text-center py-8 px-3 rounded-lg border border-dashed border-gray-200 dark:border-gray-700">
              <MousePointerClick class="w-6 h-6 mx-auto mb-2 text-gray-300 dark:text-gray-600" />
              <p class="text-xs text-gray-500 dark:text-gray-400">
                Click a node or edge to edit it, or add a new subtask above.
                Drag a node to reposition it.
              </p>
            </div>
          }
        >
          <Show when={selectedSubtask()}>
            {(subtask) => (
              <div class="space-y-3">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-1.5">
                    <span
                      class={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold leading-none ${STATUS_BADGE_BG[subtask().status] ?? STATUS_BADGE_BG.pending}`}
                    >
                      {STATUS_ICONS[subtask().status]}
                    </span>
                    <p class="text-xs text-gray-500 dark:text-gray-400 capitalize">
                      {subtask().status.replace('_', ' ')} ·{' '}
                      {subtask().subtaskKind === 'approval_gate'
                        ? 'Approval gate'
                        : 'Agent subtask'}
                    </p>
                  </div>
                  <button
                    type="button"
                    class="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    title="Delete this subtask"
                    onClick={() => props.onDeleteSubtask(subtask().id)}
                  >
                    <Trash2 class="w-3.5 h-3.5" />
                  </button>
                </div>

                <div>
                  <div class="flex items-center justify-between mb-0.5">
                    <label
                      for="wf-node-description"
                      class="block text-xs text-gray-500 dark:text-gray-400"
                    >
                      Description
                    </label>
                    <SaveIndicator status={fieldsSaveStatus} />
                  </div>
                  <textarea
                    id="wf-node-description"
                    class="w-full text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2.5 py-1.5 resize-y focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-shadow"
                    rows={3}
                    placeholder="What should this step do?"
                    value={draftDescription()}
                    onInput={(e) => setDraftDescription(e.currentTarget.value)}
                    onBlur={() => saveNodeFields(subtask().id)}
                  />
                </div>
                <div>
                  <label
                    for="wf-node-title"
                    class="block text-xs text-gray-500 dark:text-gray-400 mb-0.5"
                  >
                    Title{' '}
                    <span class="text-gray-400 dark:text-gray-500">
                      (optional — auto-generated from the description if left
                      blank)
                    </span>
                  </label>
                  <input
                    id="wf-node-title"
                    class="w-full text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-shadow"
                    placeholder="Auto-generated from description"
                    value={draftTitle()}
                    onInput={(e) => setDraftTitle(e.currentTarget.value)}
                    onBlur={() => saveNodeFields(subtask().id)}
                  />
                </div>

                <div>
                  <label
                    for="wf-node-agent"
                    class="block text-xs text-gray-500 dark:text-gray-400 mb-0.5"
                  >
                    Assigned agent
                  </label>
                  <select
                    id="wf-node-agent"
                    class="w-full text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-shadow"
                    value={subtask().assignedAgentId ?? ''}
                    onChange={(e) => {
                      const agentId = e.currentTarget.value;
                      if (agentId) props.onAssignAgent(subtask().id, agentId);
                    }}
                  >
                    <option value="">Unassigned</option>
                    <For each={props.agents ?? []}>
                      {(agent) => (
                        <option value={agent.id}>{agent.name}</option>
                      )}
                    </For>
                  </select>
                </div>

                <Show when={subtask().subtaskKind === 'agent'}>
                  <div class="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/30 p-2.5">
                    <div class="flex items-center justify-between">
                      <label class="flex items-center gap-2 text-xs font-medium text-gray-700 dark:text-gray-300">
                        <input
                          type="checkbox"
                          class="w-3.5 h-3.5 rounded border-gray-300 dark:border-gray-600 text-primary focus:ring-2 focus:ring-primary/40 dark:bg-gray-900"
                          checked={loopEnabled()}
                          onChange={(e) => {
                            setLoopEnabled(e.currentTarget.checked);
                            saveLoopConfig(subtask().id);
                          }}
                        />
                        <Repeat class="w-3.5 h-3.5 text-indigo-500" />
                        Repeat until condition
                      </label>
                      <SaveIndicator status={loopSaveStatus} />
                    </div>
                    <Show when={loopEnabled()}>
                      <div class="mt-2 space-y-1.5">
                        <div class="flex items-center gap-1.5">
                          <label
                            for="wf-loop-max"
                            class="text-xs text-gray-500 dark:text-gray-400"
                          >
                            Max iterations
                          </label>
                          <input
                            id="wf-loop-max"
                            type="number"
                            min={1}
                            class="w-16 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-shadow"
                            value={loopMax()}
                            onInput={(e) =>
                              setLoopMax(Number(e.currentTarget.value) || 1)
                            }
                            onBlur={() => saveLoopConfig(subtask().id)}
                          />
                        </div>
                        <div class="flex items-center gap-1.5">
                          <label for="wf-loop-operator" class="sr-only">
                            Loop condition operator
                          </label>
                          <select
                            id="wf-loop-operator"
                            class="text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-shadow"
                            value={loopOperator()}
                            onChange={(e) => {
                              setLoopOperator(
                                e.currentTarget.value as ConditionOperator,
                              );
                              saveLoopConfig(subtask().id);
                            }}
                          >
                            <For each={CONDITION_OPERATORS}>
                              {(op) => <option value={op}>{op}</option>}
                            </For>
                          </select>
                          <label for="wf-loop-value" class="sr-only">
                            Loop condition value
                          </label>
                          <input
                            id="wf-loop-value"
                            class="flex-1 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-shadow"
                            placeholder="value, e.g. approved"
                            value={loopValue()}
                            onInput={(e) => setLoopValue(e.currentTarget.value)}
                            onBlur={() => saveLoopConfig(subtask().id)}
                          />
                        </div>
                        <p class="text-[10px] text-gray-400 dark:text-gray-500">
                          This node re-runs itself (not a separate node or edge)
                          up to "Max iterations" times. Ask the agent to end its
                          message with `OUTCOME: &lt;tag&gt;` — once that
                          matches the condition above, it stops repeating and
                          completes.
                        </p>
                        <Show when={loopValue().trim() === ''}>
                          <p class="text-[10px] text-amber-600 dark:text-amber-400">
                            Enter a value above — the loop isn't saved until it
                            has one.
                          </p>
                        </Show>
                      </div>
                    </Show>
                  </div>
                </Show>

                <Show when={subtask().subtaskKind === 'approval_gate'}>
                  <div class="rounded-lg border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-2.5 space-y-2">
                    <div class="font-medium text-amber-700 dark:text-amber-300 text-xs">
                      Approval gate
                    </div>
                    <Show
                      when={subtask().awaitingApprovalSince}
                      fallback={
                        <div class="text-xs text-amber-600 dark:text-amber-400">
                          {subtask().approvalDecision
                            ? `Resolved: ${subtask().approvalDecision}${
                                subtask().approvalNote
                                  ? ` — ${subtask().approvalNote}`
                                  : ''
                              }`
                            : 'Not yet reached — earlier steps must complete first.'}
                        </div>
                      }
                    >
                      {(awaitingSince) => (
                        <>
                          <div class="text-xs text-amber-600 dark:text-amber-400">
                            Awaiting a human decision since{' '}
                            {new Date(awaitingSince()).toLocaleString()}
                          </div>
                          <label for="wf-approval-note" class="sr-only">
                            Approval note
                          </label>
                          <textarea
                            id="wf-approval-note"
                            class="w-full text-xs rounded-lg border border-amber-300 dark:border-amber-700 bg-white dark:bg-gray-800 px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-400/40 focus:border-amber-400 transition-shadow"
                            rows={2}
                            placeholder="Optional note"
                            value={approvalNote()}
                            onInput={(e) =>
                              setApprovalNote(e.currentTarget.value)
                            }
                          />
                          <div class="flex gap-1.5">
                            <button
                              type="button"
                              class="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium rounded-lg bg-green-600 hover:bg-green-700 text-white shadow-sm transition-colors"
                              onClick={() =>
                                props.onResolveApproval(
                                  subtask().id,
                                  'approved',
                                  approvalNote() || undefined,
                                )
                              }
                            >
                              <Check class="w-3.5 h-3.5" />
                              Approve
                            </button>
                            <button
                              type="button"
                              class="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium rounded-lg bg-red-600 hover:bg-red-700 text-white shadow-sm transition-colors"
                              onClick={() =>
                                props.onResolveApproval(
                                  subtask().id,
                                  'rejected',
                                  approvalNote() || undefined,
                                )
                              }
                            >
                              <X class="w-3.5 h-3.5" />
                              Reject
                            </button>
                          </div>
                        </>
                      )}
                    </Show>
                  </div>
                </Show>

                <Show when={dependsOn().length > 0}>
                  <div>
                    <h4 class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">
                      Depends on
                    </h4>
                    <ul class="space-y-1">
                      <For each={dependsOn()}>
                        {({ edge, subtask: dep }) => (
                          <li class="text-xs text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                            <span
                              class={
                                edge.edgeKind === 'conditional'
                                  ? 'text-purple-500'
                                  : 'text-gray-400'
                              }
                            >
                              {edge.edgeKind === 'conditional' ? '⤷?' : '⤷'}
                            </span>
                            {dep?.title ?? edge.dependsOnSubtaskId}
                          </li>
                        )}
                      </For>
                    </ul>
                  </div>
                </Show>

                <Show when={subtask().result}>
                  <div>
                    <h4 class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">
                      Result
                    </h4>
                    <pre class="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-2.5 max-h-40 overflow-y-auto">
                      {subtask().result}
                    </pre>
                  </div>
                </Show>
              </div>
            )}
          </Show>

          <Show when={selectedEdge()}>
            {(edge) => {
              const fromTitle = () =>
                props.subtasks.find((s) => s.id === edge().dependsOnSubtaskId)
                  ?.title ?? edge().dependsOnSubtaskId;
              const toTitle = () =>
                props.subtasks.find((s) => s.id === edge().subtaskId)?.title ??
                edge().subtaskId;
              return (
                <div class="space-y-3">
                  <div class="flex items-center justify-between">
                    <h3 class="font-medium text-gray-900 dark:text-gray-100 text-sm">
                      Edge
                    </h3>
                    <div class="flex items-center gap-2">
                      <SaveIndicator status={edgeSaveStatus} />
                      <button
                        type="button"
                        class="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                        title="Delete this edge"
                        onClick={() => props.onDeleteEdge(edge().id)}
                      >
                        <Trash2 class="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <p class="text-xs text-gray-700 dark:text-gray-300">
                    {toTitle()} depends on {fromTitle()}
                  </p>

                  <label class="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
                    <input
                      type="checkbox"
                      class="w-3.5 h-3.5 rounded border-gray-300 dark:border-gray-600 text-primary focus:ring-2 focus:ring-primary/40 dark:bg-gray-900"
                      checked={edgeKind() === 'conditional'}
                      onChange={(e) => {
                        setEdgeKind(
                          e.currentTarget.checked
                            ? 'conditional'
                            : 'dependency',
                        );
                        saveEdgeFields(edge().id);
                      }}
                    />
                    Conditional
                  </label>

                  <Show when={edgeKind() === 'conditional'}>
                    <div class="flex items-center gap-1.5">
                      <label for="wf-edge-operator" class="sr-only">
                        Edge condition operator
                      </label>
                      <select
                        id="wf-edge-operator"
                        class="text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-shadow"
                        value={edgeOperator()}
                        onChange={(e) => {
                          setEdgeOperator(
                            e.currentTarget.value as ConditionOperator,
                          );
                          saveEdgeFields(edge().id);
                        }}
                      >
                        <For each={CONDITION_OPERATORS}>
                          {(op) => <option value={op}>{op}</option>}
                        </For>
                      </select>
                      <label for="wf-edge-value" class="sr-only">
                        Edge condition value
                      </label>
                      <input
                        id="wf-edge-value"
                        class="flex-1 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-shadow"
                        placeholder="value, e.g. approved"
                        value={edgeValue()}
                        onInput={(e) => setEdgeValue(e.currentTarget.value)}
                        onBlur={() => saveEdgeFields(edge().id)}
                      />
                    </div>
                    <p class="text-[10px] text-gray-400 dark:text-gray-500">
                      Only satisfied when {fromTitle()}'s result (its `OUTCOME:`
                      tag, or raw text) matches this condition.
                    </p>
                    <Show when={edgeValue().trim() === ''}>
                      <p class="text-[10px] text-amber-600 dark:text-amber-400">
                        Enter a value above — a conditional edge isn't saved
                        until it has one.
                      </p>
                    </Show>
                  </Show>

                  <p class="text-[10px] text-gray-400 dark:text-gray-500 pt-1 border-t border-gray-200 dark:border-gray-700">
                    Tip: press Delete or Backspace while this edge is selected
                    to remove it.
                  </p>
                </div>
              );
            }}
          </Show>
        </Show>
      </div>
    </div>
  );
}
