/**
 * Right-side panel for the workflow canvas: shows + edits whatever is
 * selected (a node or an edge), or a legend + "add node" toolbar when
 * nothing is selected.
 */

import { Show, For, createMemo, createEffect, createSignal } from 'solid-js';
import { Plus, Trash2, Hourglass, Check, X } from 'lucide-solid';
import type {
  Subtask,
  SubtaskEdgeDto,
  SubtaskKind,
  LoopConfig,
  EdgeCondition,
  ConditionOperator,
} from '../../../lib/api-tasks';
import type { Agent } from '../AgentSelector';
import { STATUS_COLORS, STATUS_ICONS } from '../subtask-status';

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

  // Node draft state
  const [draftTitle, setDraftTitle] = createSignal('');
  const [draftDescription, setDraftDescription] = createSignal('');
  const [loopEnabled, setLoopEnabled] = createSignal(false);
  const [loopMax, setLoopMax] = createSignal(3);
  const [loopOperator, setLoopOperator] =
    createSignal<ConditionOperator>('contains');
  const [loopValue, setLoopValue] = createSignal('');
  const [approvalNote, setApprovalNote] = createSignal('');

  // Edge draft state
  const [edgeKind, setEdgeKind] = createSignal<'dependency' | 'conditional'>(
    'dependency',
  );
  const [edgeOperator, setEdgeOperator] =
    createSignal<ConditionOperator>('equals');
  const [edgeValue, setEdgeValue] = createSignal('');

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

  createEffect(() => {
    const edge = selectedEdge();
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
  }

  function saveLoopConfig(id: string) {
    if (!loopEnabled()) {
      props.onUpdateSubtask(id, { loop: null });
      return;
    }
    props.onUpdateSubtask(id, {
      loop: {
        maxIterations: loopMax(),
        conditionOperator: loopOperator(),
        conditionValue: loopValue(),
      },
    });
  }

  function saveEdgeFields(id: string) {
    props.onUpdateEdge(id, {
      edgeKind: edgeKind(),
      condition:
        edgeKind() === 'conditional'
          ? { operator: edgeOperator(), value: edgeValue() }
          : null,
    });
  }

  return (
    <div class="workflow-property-panel h-full overflow-y-auto border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3 text-sm">
      <Show
        when={selectedSubtask() || selectedEdge()}
        fallback={
          <div class="space-y-3">
            <div class="flex flex-col gap-1.5">
              <button
                type="button"
                class="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded bg-blue-600 hover:bg-blue-700 text-white"
                onClick={() => props.onAddSubtask('agent')}
              >
                <Plus class="w-3.5 h-3.5" />
                Add subtask
              </button>
              <button
                type="button"
                class="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded border border-amber-400 text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20"
                onClick={() => props.onAddSubtask('approval_gate')}
              >
                <Hourglass class="w-3.5 h-3.5" />
                Add approval gate
              </button>
            </div>

            <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 pt-2 border-t border-gray-200 dark:border-gray-700">
              Legend
            </h3>
            <div class="space-y-1.5 text-xs text-gray-600 dark:text-gray-400">
              <div class="flex items-center gap-2">
                <span class="w-6 h-0.5 bg-gray-400 dark:bg-gray-500" />
                Dependency edge
              </div>
              <div class="flex items-center gap-2">
                <span class="w-6 h-0.5 border-t-2 border-dashed border-purple-400 dark:border-purple-500" />
                Conditional edge
              </div>
              <div class="flex items-center gap-2">
                <span class="text-amber-500">⧗</span>
                Approval gate node
              </div>
              <div class="flex items-center gap-2">
                <span class="text-indigo-500">↻</span>
                Loop-configured node (badge shows iteration/max)
              </div>
            </div>
            <p class="text-xs text-gray-500 dark:text-gray-400 pt-2 border-t border-gray-200 dark:border-gray-700">
              Click a node or edge to edit it. Drag a node to reposition it, or
              drag from its bottom handle onto another node to connect them.
            </p>
          </div>
        }
      >
        <Show when={selectedSubtask()}>
          {(subtask) => (
            <div class="space-y-3">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-1.5">
                  <span class={STATUS_COLORS[subtask().status]}>
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
                  class="p-1 text-gray-400 hover:text-red-600"
                  title="Delete this subtask"
                  onClick={() => props.onDeleteSubtask(subtask().id)}
                >
                  <Trash2 class="w-3.5 h-3.5" />
                </button>
              </div>

              <div>
                <label
                  for="wf-node-title"
                  class="block text-xs text-gray-500 dark:text-gray-400 mb-0.5"
                >
                  Title
                </label>
                <input
                  id="wf-node-title"
                  class="w-full text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1"
                  value={draftTitle()}
                  onInput={(e) => setDraftTitle(e.currentTarget.value)}
                  onBlur={() => saveNodeFields(subtask().id)}
                />
              </div>
              <div>
                <label
                  for="wf-node-description"
                  class="block text-xs text-gray-500 dark:text-gray-400 mb-0.5"
                >
                  Description
                </label>
                <textarea
                  id="wf-node-description"
                  class="w-full text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 resize-y"
                  rows={3}
                  value={draftDescription()}
                  onInput={(e) => setDraftDescription(e.currentTarget.value)}
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
                  class="w-full text-xs rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1"
                  value={subtask().assignedAgentId ?? ''}
                  onChange={(e) => {
                    const agentId = e.currentTarget.value;
                    if (agentId) props.onAssignAgent(subtask().id, agentId);
                  }}
                >
                  <option value="">Unassigned</option>
                  <For each={props.agents ?? []}>
                    {(agent) => <option value={agent.id}>{agent.name}</option>}
                  </For>
                </select>
              </div>

              <Show when={subtask().subtaskKind === 'agent'}>
                <div class="rounded-md border border-gray-200 dark:border-gray-700 p-2">
                  <label class="flex items-center gap-2 text-xs font-medium text-gray-700 dark:text-gray-300">
                    <input
                      type="checkbox"
                      checked={loopEnabled()}
                      onChange={(e) => {
                        setLoopEnabled(e.currentTarget.checked);
                        saveLoopConfig(subtask().id);
                      }}
                    />
                    Repeat until condition
                  </label>
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
                          class="w-16 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-1.5 py-0.5"
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
                          class="text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-1.5 py-0.5"
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
                          class="flex-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-1.5 py-0.5"
                          placeholder="value, e.g. approved"
                          value={loopValue()}
                          onInput={(e) => setLoopValue(e.currentTarget.value)}
                          onBlur={() => saveLoopConfig(subtask().id)}
                        />
                      </div>
                      <p class="text-[10px] text-gray-400 dark:text-gray-500">
                        Ask the agent to end its message with `OUTCOME:
                        &lt;tag&gt;` — this is compared against the condition
                        above to decide whether to repeat.
                      </p>
                    </div>
                  </Show>
                </div>
              </Show>

              <Show when={subtask().subtaskKind === 'approval_gate'}>
                <div class="rounded-md border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-2 space-y-2">
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
                          class="w-full text-xs rounded-md border border-amber-300 dark:border-amber-700 bg-white dark:bg-gray-800 px-2 py-1"
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
                            class="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1 text-xs rounded bg-green-600 hover:bg-green-700 text-white"
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
                            class="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1 text-xs rounded bg-red-600 hover:bg-red-700 text-white"
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
                  <pre class="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap bg-gray-50 dark:bg-gray-800 rounded p-2 max-h-40 overflow-y-auto">
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
                  <button
                    type="button"
                    class="p-1 text-gray-400 hover:text-red-600"
                    title="Delete this edge"
                    onClick={() => props.onDeleteEdge(edge().id)}
                  >
                    <Trash2 class="w-3.5 h-3.5" />
                  </button>
                </div>
                <p class="text-xs text-gray-700 dark:text-gray-300">
                  {toTitle()} depends on {fromTitle()}
                </p>

                <label class="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={edgeKind() === 'conditional'}
                    onChange={(e) => {
                      setEdgeKind(
                        e.currentTarget.checked ? 'conditional' : 'dependency',
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
                      class="text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-1.5 py-0.5"
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
                      class="flex-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-1.5 py-0.5"
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
                </Show>
              </div>
            );
          }}
        </Show>
      </Show>
    </div>
  );
}
