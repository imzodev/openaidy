/**
 * Create Workflow Modal
 *
 * Purpose-built creation form for the Workflows page — not the generic
 * TaskModal. A workflow only needs a description, a choice between
 * auto-generating its subtask graph (the pre-existing AI planner) or
 * hand-authoring it in the graph editor, and an optional recurring
 * schedule. No title (auto-generated from the description), priority,
 * or agent assignment — those are Tasks-page concerns.
 */

import { createSignal, Show, createEffect, on } from 'solid-js';
import { X, Workflow, Sparkles, RefreshCw, LayoutTemplate } from 'lucide-solid';
import type { CreateTaskInput } from '../../lib/api-tasks';
import type { ScheduleInput } from '../../lib/types';
import { ScheduleEditor } from '../common/ScheduleEditor';
import { WorkflowTemplateGallery } from './WorkflowTemplateGallery';
import { WORKFLOW_TEMPLATES } from '@openaidy/workflow-templates';
import { useEscapeKey } from '../settings/hooks';

export type CreateWorkflowSubmitInput = {
  task: CreateTaskInput;
  template?: { templateId: string; inputs: Record<string, string> };
};

export type CreateWorkflowModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (input: CreateWorkflowSubmitInput) => Promise<void>;
  isLoading?: boolean;
};

export function CreateWorkflowModal(props: CreateWorkflowModalProps) {
  const [description, setDescription] = createSignal('');
  const [autoGenerate, setAutoGenerate] = createSignal(false);
  const [mode, setMode] = createSignal<'blank' | 'template'>('blank');
  const [templateId, setTemplateId] = createSignal<string | null>(null);
  const [templateInputs, setTemplateInputs] = createSignal<
    Record<string, string>
  >({});
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
        setAutoGenerate(false);
        setMode('blank');
        setTemplateId(null);
        setTemplateInputs({});
        setRecurringEnabled(false);
        setDraftSchedule(null);
        setError(null);
        setSubmitting(false);
      },
    ),
  );

  const isLoading = () => props.isLoading || submitting();

  function selectedTemplate() {
    return WORKFLOW_TEMPLATES.find((t) => t.id === templateId());
  }

  async function handleSubmit(e: Event) {
    e.preventDefault();
    if (!description().trim()) {
      setError('Description is required');
      return;
    }
    if (mode() === 'template') {
      const template = selectedTemplate();
      if (!template) {
        setError('Choose a template');
        return;
      }
      const missing = template.inputs.find(
        (input) => input.required && !templateInputs()[input.key]?.trim(),
      );
      if (missing) {
        setError(`"${missing.label}" is required`);
        return;
      }
    }

    setSubmitting(true);
    setError(null);
    try {
      await props.onSubmit({
        task: {
          description: description().trim(),
          planningEnabled: true,
          // In 'blank' mode, checking "auto-generate" lets the existing AI
          // planner run; leaving it unchecked means hand-authoring in the
          // editor. In 'template' mode the graph always comes from the
          // template, so the AI planner must never race it.
          skipAutoPlan: mode() === 'template' ? true : !autoGenerate(),
          ...(recurringEnabled() && draftSchedule()
            ? { schedule: { schedule: draftSchedule()! } }
            : {}),
        },
        ...(mode() === 'template' && templateId()
          ? {
              template: {
                templateId: templateId()!,
                inputs: templateInputs(),
              },
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
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Description <span class="text-red-500">*</span>
              </label>
              <textarea
                class={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary dark:bg-gray-900 dark:text-gray-100 transition-shadow ${
                  error()
                    ? 'border-red-400'
                    : 'border-gray-300 dark:border-gray-600'
                } resize-none`}
                rows={4}
                value={description()}
                onInput={(e) => setDescription(e.currentTarget.value)}
                placeholder="What is this workflow for?"
                disabled={isLoading()}
                autofocus
              />
              <Show when={error()}>
                <p class="text-xs text-red-500 mt-1">{error()}</p>
              </Show>
            </div>

            <div class="flex gap-2 p-1 rounded-lg bg-gray-100 dark:bg-gray-900">
              <button
                type="button"
                class={`flex-1 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  mode() === 'blank'
                    ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                    : 'text-gray-500 dark:text-gray-400'
                }`}
                onClick={() => setMode('blank')}
                disabled={isLoading()}
              >
                Blank workflow
              </button>
              <button
                type="button"
                class={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  mode() === 'template'
                    ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                    : 'text-gray-500 dark:text-gray-400'
                }`}
                onClick={() => setMode('template')}
                disabled={isLoading()}
              >
                <LayoutTemplate class="w-3.5 h-3.5" />
                From a template
              </button>
            </div>

            <Show when={mode() === 'template'}>
              <WorkflowTemplateGallery
                selectedTemplateId={templateId()}
                onSelectTemplate={setTemplateId}
                inputValues={templateInputs()}
                onInputChange={(key, value) =>
                  setTemplateInputs((prev) => ({ ...prev, [key]: value }))
                }
                disabled={isLoading()}
              />
            </Show>

            <Show when={mode() === 'blank'}>
              <label
                class={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  autoGenerate()
                    ? 'border-primary/40 bg-primary/5'
                    : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/30'
                }`}
              >
                <div class="w-8 h-8 rounded-md bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Sparkles class="w-4 h-4 text-purple-600 dark:text-purple-400" />
                </div>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center justify-between gap-2">
                    <span class="text-sm font-medium text-gray-800 dark:text-gray-200">
                      Create workflow automatically
                    </span>
                    <input
                      type="checkbox"
                      class="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-primary focus:ring-2 focus:ring-primary/40 dark:bg-gray-900 flex-shrink-0"
                      checked={autoGenerate()}
                      onChange={(e) => setAutoGenerate(e.currentTarget.checked)}
                      disabled={isLoading()}
                    />
                  </div>
                  <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    Let AI break the description into subtasks. Leave unchecked
                    to build the graph yourself.
                  </p>
                </div>
              </label>
            </Show>

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
                <Show when={isLoading()} fallback="Create">
                  Creating...
                </Show>
              </button>
            </div>
          </form>
        </div>
      </div>
    </Show>
  );
}
