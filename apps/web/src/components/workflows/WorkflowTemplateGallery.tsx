/**
 * Workflow Template Gallery
 *
 * Lets the user pick a ready-made workflow (from
 * `@openaidy/workflow-templates`'s static registry), grouped by what it's
 * for. A selected template shows its form (text, choices, agent and
 * channel pickers), how it starts, and — advisory, not blocking — which
 * integrations or tools no agent has yet.
 */

import { createEffect, createMemo, createSignal, For, Show } from 'solid-js';
import { createQuery } from '@tanstack/solid-query';
import { AlertTriangle, CheckCircle2, LayoutTemplate, Zap } from 'lucide-solid';
import { WORKFLOW_TEMPLATES } from '@openaidy/workflow-templates';
import type {
  TemplateCategory,
  TemplateInput,
  TemplateRequirement,
  WorkflowTemplate,
} from '@openaidy/shared-types';
import { listAgents, listChannels, type Agent } from '../../lib/api';
import { describeStart, templateStart } from '../../lib/workflow-start';

export type WorkflowTemplateGalleryProps = {
  selectedTemplateId: string | null;
  onSelectTemplate: (id: string | null) => void;
  inputValues: Record<string, string>;
  onInputChange: (key: string, value: string) => void;
  /** Set up the template's suggested trigger/schedule when creating. */
  setupTrigger: boolean;
  onSetupTriggerChange: (value: boolean) => void;
  disabled?: boolean;
};

const CATEGORY_LABEL: Record<TemplateCategory, string> = {
  sales: 'Sales',
  support: 'Support',
  finance: 'Finance',
  marketing: 'Marketing',
  ops: 'Operations',
  content: 'Content',
  engineering: 'Engineering',
};

const fieldClass =
  'w-full px-3 py-1.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary dark:bg-gray-900 dark:text-gray-100 border-gray-300 dark:border-gray-600';

/** Whether some agent satisfies the requirement. */
export function requirementMet(
  requirement: TemplateRequirement,
  agents: Agent[],
): boolean {
  const { mcpServerIds, tools, mcpServerConfigured } = requirement.check;
  if (
    mcpServerIds?.length &&
    !agents.some((a) => a.mcpServers?.some((s) => mcpServerIds.includes(s.id)))
  ) {
    return false;
  }
  if (
    tools?.length &&
    !agents.some((a) => tools.every((t) => a.tools?.includes(t)))
  ) {
    return false;
  }
  if (
    mcpServerConfigured &&
    !mcpServerIds?.length &&
    !agents.some((a) => (a.mcpServers?.length ?? 0) > 0)
  ) {
    return false;
  }
  return true;
}

export function WorkflowTemplateGallery(props: WorkflowTemplateGalleryProps) {
  // Shares the ['agents'] cache key App.tsx's own agentsQuery already
  // populates, so opening this gallery doesn't issue a redundant fetch.
  const agentsQuery = createQuery(() => ({
    queryKey: ['agents'],
    queryFn: listAgents,
  }));
  const channelsQuery = createQuery(() => ({
    queryKey: ['channels'],
    queryFn: listChannels,
  }));
  const agents = createMemo<Agent[]>(() => agentsQuery.data?.items ?? []);
  const [category, setCategory] = createSignal<TemplateCategory | 'all'>('all');

  const categories = createMemo(() =>
    (Object.keys(CATEGORY_LABEL) as TemplateCategory[]).filter((c) =>
      WORKFLOW_TEMPLATES.some((t) => t.category === c),
    ),
  );
  const visible = createMemo(() =>
    category() === 'all'
      ? WORKFLOW_TEMPLATES
      : WORKFLOW_TEMPLATES.filter((t) => t.category === category()),
  );
  const selectedTemplate = createMemo<WorkflowTemplate | undefined>(() =>
    WORKFLOW_TEMPLATES.find((t) => t.id === props.selectedTemplateId),
  );

  // Pre-select the first channel for channel inputs, so the form's value
  // matches what the picker shows even if the user never touches it.
  createEffect(() => {
    const template = selectedTemplate();
    const first = channelsQuery.data?.[0]?.id;
    if (!template || !first) return;
    for (const input of template.inputs) {
      if (input.type === 'channel' && !props.inputValues[input.key]) {
        props.onInputChange(input.key, first);
      }
    }
  });

  const value = (input: TemplateInput) =>
    props.inputValues[input.key] ?? input.default ?? '';

  function renderInput(input: TemplateInput) {
    const id = `tpl-input-${input.key}`;
    switch (input.type) {
      case 'select':
        return (
          <select
            id={id}
            class={fieldClass}
            value={value(input)}
            onChange={(e) =>
              props.onInputChange(input.key, e.currentTarget.value)
            }
            disabled={props.disabled}
          >
            <For each={input.options ?? []}>
              {(o) => <option value={o.value}>{o.label}</option>}
            </For>
          </select>
        );
      case 'agent':
        return (
          <select
            id={id}
            class={fieldClass}
            value={value(input)}
            onChange={(e) =>
              props.onInputChange(input.key, e.currentTarget.value)
            }
            disabled={props.disabled}
          >
            <option value="">Default agent</option>
            <For each={agents()}>
              {(a) => <option value={a.id}>{a.name}</option>}
            </For>
          </select>
        );
      case 'channel':
        return (
          <Show
            when={(channelsQuery.data?.length ?? 0) > 0}
            fallback={
              <p class="text-xs text-amber-700 dark:text-amber-300">
                No channels yet — connect WhatsApp on the Channels page first.
              </p>
            }
          >
            <select
              id={id}
              class={fieldClass}
              value={value(input)}
              onChange={(e) =>
                props.onInputChange(input.key, e.currentTarget.value)
              }
              disabled={props.disabled}
            >
              <For each={channelsQuery.data ?? []}>
                {(c) => (
                  <option value={c.id}>
                    {c.id} ({c.type})
                  </option>
                )}
              </For>
            </select>
          </Show>
        );
      case 'boolean':
        return (
          <input
            id={id}
            type="checkbox"
            checked={value(input) === 'true'}
            onChange={(e) =>
              props.onInputChange(
                input.key,
                e.currentTarget.checked ? 'true' : 'false',
              )
            }
            disabled={props.disabled}
          />
        );
      case 'text':
        return (
          <textarea
            id={id}
            rows={3}
            class={`${fieldClass} resize-y`}
            value={value(input)}
            onInput={(e) =>
              props.onInputChange(input.key, e.currentTarget.value)
            }
            disabled={props.disabled}
          />
        );
      default:
        return (
          <input
            id={id}
            type={input.type === 'number' ? 'number' : 'text'}
            class={fieldClass}
            value={value(input)}
            onInput={(e) =>
              props.onInputChange(input.key, e.currentTarget.value)
            }
            placeholder={input.default}
            disabled={props.disabled}
          />
        );
    }
  }

  return (
    <div class="space-y-3">
      <div class="flex flex-wrap gap-1.5" role="group" aria-label="Category">
        <For each={['all' as const, ...categories()]}>
          {(c) => (
            <button
              type="button"
              class={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                category() === c
                  ? 'bg-primary text-white border-primary'
                  : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/40'
              }`}
              aria-pressed={category() === c}
              onClick={() => setCategory(c)}
            >
              {c === 'all' ? 'All' : CATEGORY_LABEL[c]}
            </button>
          )}
        </For>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <For each={visible()}>
          {(template) => (
            <label
              class={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                props.selectedTemplateId === template.id
                  ? 'border-primary/40 bg-primary/5'
                  : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/30'
              }`}
            >
              <div class="w-8 h-8 rounded-md bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                <LayoutTemplate class="w-4 h-4 text-teal-600 dark:text-teal-400" />
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center justify-between gap-2">
                  <span class="text-sm font-medium text-gray-800 dark:text-gray-200">
                    {template.name}
                  </span>
                  <input
                    type="radio"
                    name="workflow-template"
                    class="w-4 h-4 border-gray-300 dark:border-gray-600 text-primary focus:ring-2 focus:ring-primary/40 dark:bg-gray-900 flex-shrink-0"
                    checked={props.selectedTemplateId === template.id}
                    onChange={() => props.onSelectTemplate(template.id)}
                    disabled={props.disabled}
                  />
                </div>
                <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  {template.description}
                </p>
                <p class="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
                  {template.nodes.length} steps ·{' '}
                  {describeStart(templateStart(template, {}))}
                </p>
              </div>
            </label>
          )}
        </For>
      </div>

      <Show when={selectedTemplate()}>
        {(template) => {
          const start = createMemo(() =>
            templateStart(template(), props.inputValues),
          );
          return (
            <div class="space-y-3 pl-1">
              <Show when={template().requirements.length > 0}>
                <ul class="space-y-1">
                  <For each={template().requirements}>
                    {(r) => {
                      const met = () => requirementMet(r, agents());
                      return (
                        <li class="flex items-start gap-1.5 text-xs">
                          <Show
                            when={met()}
                            fallback={
                              <AlertTriangle class="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-px" />
                            }
                          >
                            <CheckCircle2 class="w-3.5 h-3.5 text-green-600 dark:text-green-400 flex-shrink-0 mt-px" />
                          </Show>
                          <span
                            class={
                              met()
                                ? 'text-gray-600 dark:text-gray-300'
                                : 'text-amber-800 dark:text-amber-300'
                            }
                          >
                            {r.label}
                            <Show when={!met()}>
                              {' — not set up yet. '}
                              <a
                                href={
                                  r.check.tools?.length ? '/agents' : '/mcps'
                                }
                                class="underline"
                              >
                                {r.check.tools?.length
                                  ? 'Add it to an agent'
                                  : 'Connect it'}
                              </a>
                              {' (you can still create the workflow).'}
                            </Show>
                          </span>
                        </li>
                      );
                    }}
                  </For>
                </ul>
              </Show>

              <For each={template().inputs}>
                {(input) => (
                  <div>
                    <label
                      for={`tpl-input-${input.key}`}
                      class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1"
                    >
                      {input.label}
                      <Show when={input.required}>
                        <span class="text-red-500"> *</span>
                      </Show>
                    </label>
                    {renderInput(input)}
                    <Show when={input.help}>
                      <p class="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">
                        {input.help}
                      </p>
                    </Show>
                  </div>
                )}
              </For>

              <Show when={start()}>
                {(trigger) => (
                  <label class="flex items-start gap-2.5 p-2.5 rounded-lg border border-gray-200 dark:border-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      class="mt-0.5"
                      checked={props.setupTrigger}
                      onChange={(e) =>
                        props.onSetupTriggerChange(e.currentTarget.checked)
                      }
                      disabled={props.disabled}
                    />
                    <span class="text-xs">
                      <span class="flex items-center gap-1 font-medium text-gray-800 dark:text-gray-200">
                        <Zap class="w-3.5 h-3.5 text-primary" />
                        Set up how it starts
                      </span>
                      <span class="text-gray-500 dark:text-gray-400">
                        {describeStart(trigger())}. Leave unchecked to run it by
                        hand.
                      </span>
                    </span>
                  </label>
                )}
              </Show>
            </div>
          );
        }}
      </Show>
    </div>
  );
}
