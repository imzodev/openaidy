/**
 * Create Workflow Modal
 *
 * Purpose-built creation form for the Workflows page — not the generic
 * TaskModal. Three ways to start:
 * - Describe it: a sentence becomes a drafted workflow (steps, branches,
 *   approvals, how it starts) shown for review before it's created.
 * - From a template: a ready-made business workflow with its form.
 * - Build it yourself: an empty graph, optionally on a schedule.
 * No title (auto-generated from the description), priority, or agent
 * assignment — those are Tasks-page concerns.
 */

import { createSignal, Show, For, createEffect, on } from 'solid-js';
import {
  X,
  Workflow,
  Sparkles,
  RefreshCw,
  LayoutTemplate,
  PenLine,
  Hourglass,
  Repeat,
  Zap,
  AlertTriangle,
} from 'lucide-solid';
import { draftWorkflow, type CreateTaskInput } from '../../lib/api-tasks';
import type { ScheduleInput, WorkflowDraftDto } from '../../lib/types';
import type { CreateWorkflowSubmitInput as CreateWorkflowSubmitInputOf } from '@openaidy/shared-types';
import { ScheduleEditor } from '../common/ScheduleEditor';
import { WorkflowTemplateGallery } from './WorkflowTemplateGallery';
import { WORKFLOW_TEMPLATES } from '@openaidy/workflow-templates';
import { useEscapeKey } from '../settings/hooks';
import { describeStart } from '../../lib/workflow-start';

export type CreateWorkflowSubmitInput =
  CreateWorkflowSubmitInputOf<CreateTaskInput>;

export type CreateWorkflowModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (input: CreateWorkflowSubmitInput) => Promise<void>;
  isLoading?: boolean;
};

type Mode = 'describe' | 'template' | 'blank';

/** The draft as a readable list: each step and what leads to it. */
function DraftPreview(props: {
  draft: WorkflowDraftDto;
  keepTrigger: boolean;
  onKeepTriggerChange: (value: boolean) => void;
  disabled: boolean;
}) {
  const titleOf = (key: string) =>
    props.draft.graph.nodes.find((n) => n.key === key)?.title || key;
  const incoming = (key: string) =>
    props.draft.graph.edges.filter((e) => e.to === key);
  return (
    <div class="rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-2.5">
      <div class="text-sm font-medium text-gray-900 dark:text-gray-100">
        {props.draft.title}
      </div>
      <ol class="space-y-1.5">
        <For each={props.draft.graph.nodes}>
          {(node, index) => (
            <li class="text-xs">
              <div class="flex items-center gap-1.5">
                <span class="w-4 h-4 rounded-full bg-gray-100 dark:bg-gray-700 text-[10px] flex items-center justify-center flex-shrink-0">
                  {index() + 1}
                </span>
                <span class="font-medium text-gray-800 dark:text-gray-200">
                  {node.title || node.key}
                </span>
                <Show when={node.kind === 'approval_gate'}>
                  <Hourglass class="w-3 h-3 text-amber-500" />
                  <span class="text-amber-600 dark:text-amber-400">
                    you approve
                  </span>
                </Show>
                <Show when={node.loop}>
                  <Repeat class="w-3 h-3 text-indigo-500" />
                </Show>
                <Show when={node.agentId}>
                  <span class="text-purple-600 dark:text-purple-400 truncate">
                    · {node.agentId}
                  </span>
                </Show>
              </div>
              <Show when={incoming(node.key).length > 0}>
                <p class="ml-5 text-gray-400 dark:text-gray-500">
                  after{' '}
                  {incoming(node.key)
                    .map(
                      (e) =>
                        `${titleOf(e.from)}${e.conditionValue ? ` (if ${e.conditionValue})` : ''}`,
                    )
                    .join(', ')}
                </p>
              </Show>
            </li>
          )}
        </For>
      </ol>
      <Show when={props.draft.trigger}>
        {(trigger) => (
          <label class="flex items-start gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              class="mt-0.5"
              checked={props.keepTrigger}
              onChange={(e) =>
                props.onKeepTriggerChange(e.currentTarget.checked)
              }
              disabled={props.disabled}
            />
            <span>
              <span class="inline-flex items-center gap-1 font-medium text-gray-800 dark:text-gray-200">
                <Zap class="w-3.5 h-3.5 text-primary" /> Starts:
              </span>{' '}
              <span class="text-gray-600 dark:text-gray-300">
                {describeStart(trigger())}
                {trigger().kind === 'webhook'
                  ? ' — add the webhook from the Triggers panel after creating it.'
                  : ''}
              </span>
            </span>
          </label>
        )}
      </Show>
      <Show when={props.draft.warnings.length > 0}>
        <ul class="space-y-1">
          <For each={props.draft.warnings}>
            {(w) => (
              <li class="flex gap-1.5 text-xs text-amber-700 dark:text-amber-300">
                <AlertTriangle class="w-3.5 h-3.5 flex-shrink-0 mt-px" />
                {w}
              </li>
            )}
          </For>
        </ul>
      </Show>
      <p class="text-[11px] text-gray-400 dark:text-gray-500">
        You can change anything in the editor after creating it.
      </p>
    </div>
  );
}

export function CreateWorkflowModal(props: CreateWorkflowModalProps) {
  const MODES: Array<{ id: Mode; label: string; icon: typeof Sparkles }> = [
    { id: 'describe', label: 'Describe it', icon: Sparkles },
    { id: 'template', label: 'From a template', icon: LayoutTemplate },
    { id: 'blank', label: 'Build it yourself', icon: PenLine },
  ];
  const [description, setDescription] = createSignal('');
  const [mode, setMode] = createSignal<Mode>('describe');
  const [templateId, setTemplateId] = createSignal<string | null>(null);
  const [templateInputs, setTemplateInputs] = createSignal<
    Record<string, string>
  >({});
  const [setupTrigger, setSetupTrigger] = createSignal(true);
  const [draft, setDraft] = createSignal<WorkflowDraftDto | null>(null);
  const [draftedFrom, setDraftedFrom] = createSignal('');
  const [drafting, setDrafting] = createSignal(false);
  const [keepTrigger, setKeepTrigger] = createSignal(true);
  const [recurringEnabled, setRecurringEnabled] = createSignal(false);
  const [draftSchedule, setDraftSchedule] = createSignal<ScheduleInput | null>(
    null,
  );
  const [error, setError] = createSignal<string | null>(null);
  const [submitting, setSubmitting] = createSignal(false);

  createEffect(
    on(
      () => props.isOpen,
      (isOpen) => {
        if (!isOpen) return;
        setDescription('');
        setMode('describe');
        setTemplateId(null);
        setTemplateInputs({});
        setSetupTrigger(true);
        setDraft(null);
        setDraftedFrom('');
        setKeepTrigger(true);
        setRecurringEnabled(false);
        setDraftSchedule(null);
        setError(null);
        setSubmitting(false);
      },
    ),
  );

  const isLoading = () => props.isLoading || submitting() || drafting();
  // The draft only counts while the description still matches it.
  const currentDraft = () =>
    draft() && draftedFrom() === description().trim() ? draft() : null;

  function selectedTemplate() {
    return WORKFLOW_TEMPLATES.find((t) => t.id === templateId());
  }

  async function handleDraft() {
    const text = description().trim();
    if (!text) {
      setError('Describe what the workflow should do');
      return;
    }
    setError(null);
    setDrafting(true);
    try {
      const result = await draftWorkflow(text);
      if (!result.ok) throw new Error(result.error.message);
      setDraft(result.data);
      setDraftedFrom(text);
      setKeepTrigger(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't draft it");
    } finally {
      setDrafting(false);
    }
  }

  async function handleSubmit(e: Event) {
    e.preventDefault();
    if (!description().trim()) {
      setError('Description is required');
      return;
    }
    if (mode() === 'describe' && !currentDraft()) {
      await handleDraft();
      return;
    }
    if (mode() === 'template') {
      const template = selectedTemplate();
      if (!template) {
        setError('Choose a template');
        return;
      }
      // An input can be `required` and still have a `default` — the
      // gallery pre-fills the field's *display* value from that default,
      // but `templateInputs()` itself stays empty until the user types,
      // so a default must also satisfy this check (the server applies
      // the same default fallback in WorkflowTemplateOperations.applyTemplate).
      const missing = template.inputs.find(
        (input) =>
          input.required &&
          !templateInputs()[input.key]?.trim() &&
          !input.default,
      );
      if (missing) {
        setError(`"${missing.label}" is required`);
        return;
      }
    }

    setSubmitting(true);
    setError(null);
    const drafted = currentDraft();
    try {
      await props.onSubmit({
        task: {
          description: description().trim(),
          ...(mode() === 'describe' && drafted ? { title: drafted.title } : {}),
          planningEnabled: true,
          // The graph comes from the draft, the template or the editor —
          // never from the old auto-planner.
          skipAutoPlan: true,
          ...(mode() === 'blank' && recurringEnabled() && draftSchedule()
            ? { schedule: { schedule: draftSchedule()! } }
            : {}),
        },
        ...(mode() === 'template' && templateId()
          ? {
              template: {
                templateId: templateId()!,
                inputs: templateInputs(),
                setupTrigger: setupTrigger(),
              },
            }
          : {}),
        ...(mode() === 'describe' && drafted
          ? {
              graph: drafted.graph,
              ...(keepTrigger() &&
              drafted.trigger &&
              drafted.trigger.kind !== 'webhook'
                ? { trigger: drafted.trigger }
                : {}),
            }
          : {}),
      });
      setSubmitting(false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to create workflow',
      );
      setSubmitting(false);
    }
  }

  useEscapeKey(props.onClose, () => props.isOpen);

  const submitLabel = () => {
    if (drafting()) return 'Drafting…';
    if (submitting() || props.isLoading) return 'Creating…';
    if (mode() === 'describe' && !currentDraft()) return 'Draft it';
    return 'Create';
  };

  return (
    <Show when={props.isOpen}>
      <div
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 dark:bg-black/70 p-4"
        onClick={props.onClose}
      >
        <div
          class="bg-white dark:bg-gray-800 dark:border dark:border-gray-700 rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <div class="flex items-center justify-between p-4 border-b border-gray-100 dark:border-gray-700">
            <div class="flex items-center gap-2.5">
              <div class="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Workflow class="w-4 h-4 text-primary" />
              </div>
              <h2 class="text-base font-semibold text-gray-900 dark:text-gray-100">
                Create Workflow
              </h2>
            </div>
            <button
              type="button"
              class="p-1 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 rounded"
              onClick={props.onClose}
              disabled={isLoading()}
            >
              <X class="w-5 h-5" />
            </button>
          </div>

          <form onSubmit={handleSubmit} class="p-4 space-y-3">
            <div class="flex gap-1 p-1 rounded-lg bg-gray-100 dark:bg-gray-900">
              <For each={MODES}>
                {(m) => (
                  <button
                    type="button"
                    class={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs sm:text-sm font-medium rounded-md transition-colors ${
                      mode() === m.id
                        ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                        : 'text-gray-500 dark:text-gray-400'
                    }`}
                    onClick={() => {
                      setMode(m.id);
                      setError(null);
                    }}
                    aria-pressed={mode() === m.id}
                    disabled={isLoading()}
                  >
                    <m.icon class="w-3.5 h-3.5" />
                    {m.label}
                  </button>
                )}
              </For>
            </div>

            <div>
              <label
                for="workflow-description"
                class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5"
              >
                {mode() === 'describe' ? 'What should happen?' : 'Description'}{' '}
                <span class="text-red-500">*</span>
              </label>
              <textarea
                id="workflow-description"
                class={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary dark:bg-gray-900 dark:text-gray-100 transition-shadow ${
                  error()
                    ? 'border-red-400'
                    : 'border-gray-300 dark:border-gray-600'
                } resize-none`}
                rows={mode() === 'describe' ? 4 : 3}
                value={description()}
                onInput={(e) => setDescription(e.currentTarget.value)}
                placeholder={
                  mode() === 'describe'
                    ? 'e.g. When a customer sends "cita" on WhatsApp, check my calendar and offer two times. Ask me before confirming.'
                    : 'What is this workflow for?'
                }
                disabled={isLoading()}
                autofocus
              />
              <Show when={error()}>
                <p class="text-xs text-red-500 mt-1 whitespace-pre-line">
                  {error()}
                </p>
              </Show>
            </div>

            <Show when={mode() === 'describe'}>
              <Show
                when={currentDraft()}
                fallback={
                  <p class="text-xs text-gray-500 dark:text-gray-400">
                    Say what should start it, what should happen, and where you
                    want to approve things. You'll see the steps before anything
                    is created.
                  </p>
                }
              >
                {(d) => (
                  <>
                    <DraftPreview
                      draft={d()}
                      keepTrigger={keepTrigger()}
                      onKeepTriggerChange={setKeepTrigger}
                      disabled={isLoading()}
                    />
                    <button
                      type="button"
                      class="text-xs text-primary hover:underline"
                      onClick={() => void handleDraft()}
                      disabled={isLoading()}
                    >
                      Draft it again
                    </button>
                  </>
                )}
              </Show>
            </Show>

            <Show when={mode() === 'template'}>
              <WorkflowTemplateGallery
                selectedTemplateId={templateId()}
                onSelectTemplate={setTemplateId}
                inputValues={templateInputs()}
                onInputChange={(key, value) =>
                  setTemplateInputs((prev) => ({ ...prev, [key]: value }))
                }
                setupTrigger={setupTrigger()}
                onSetupTriggerChange={setSetupTrigger}
                disabled={isLoading()}
              />
            </Show>

            <Show when={mode() === 'blank'}>
              <label
                class={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  recurringEnabled()
                    ? 'border-primary/40 bg-primary/5'
                    : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/30'
                }`}
              >
                <div class="w-8 h-8 rounded-md bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <RefreshCw class="w-4 h-4 text-blue-600 dark:text-blue-400" />
                </div>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center justify-between gap-2">
                    <span class="text-sm font-medium text-gray-800 dark:text-gray-200">
                      Enable recurring schedule
                    </span>
                    <input
                      type="checkbox"
                      class="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-primary focus:ring-2 focus:ring-primary/40 dark:bg-gray-900 flex-shrink-0"
                      checked={recurringEnabled()}
                      onChange={(e) => {
                        const checked = e.currentTarget.checked;
                        setRecurringEnabled(checked);
                        if (checked && !draftSchedule()) {
                          setDraftSchedule({ every: '1h' });
                        }
                      }}
                      disabled={isLoading()}
                    />
                  </div>
                  <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    Automatically re-run this workflow on a schedule
                  </p>
                </div>
              </label>

              <Show when={recurringEnabled()}>
                <div class="pl-3">
                  <ScheduleEditor
                    value={draftSchedule()}
                    onChange={(v) => setDraftSchedule(v)}
                  />
                </div>
              </Show>
            </Show>

            <div class="flex items-center justify-end gap-3 pt-3 border-t border-gray-100 dark:border-gray-700">
              <button
                type="button"
                class="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 border border-gray-300 dark:border-gray-600 rounded-lg dark:hover:border-gray-500 transition-colors"
                onClick={props.onClose}
                disabled={isLoading()}
              >
                Cancel
              </button>
              <button
                type="submit"
                class="px-4 py-2 text-sm font-medium text-white bg-primary hover:bg-primary-hover rounded-lg shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                disabled={isLoading()}
              >
                {submitLabel()}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Show>
  );
}
