/**
 * Workflow Template Gallery
 *
 * Lets the user pick a pre-built subtask graph (from
 * `@openaidy/workflow-templates`'s static registry) instead of AI
 * auto-planning or hand-authoring one. Once a template is selected,
 * renders its declared `inputs` as a small form and an advisory (not
 * blocking) notice if no configured agent looks like it has the
 * capability the template expects.
 */

import { createSignal, createMemo, For, Show, onMount } from 'solid-js';
import { AlertTriangle, LayoutTemplate } from 'lucide-solid';
import { WORKFLOW_TEMPLATES } from '@openaidy/workflow-templates';
import type { WorkflowTemplate } from '@openaidy/shared-types';
import { listAgents, type Agent } from '../../lib/api';

export type WorkflowTemplateGalleryProps = {
  selectedTemplateId: string | null;
  onSelectTemplate: (id: string | null) => void;
  inputValues: Record<string, string>;
  onInputChange: (key: string, value: string) => void;
  disabled?: boolean;
};

export function WorkflowTemplateGallery(props: WorkflowTemplateGalleryProps) {
  const [agents, setAgents] = createSignal<Agent[]>([]);

  onMount(async () => {
    try {
      const result = await listAgents();
      setAgents(result.items);
    } catch {
      // Advisory-only check; if it fails to load, just skip the notice.
    }
  });

  const selectedTemplate = createMemo<WorkflowTemplate | undefined>(() =>
    WORKFLOW_TEMPLATES.find((t) => t.id === props.selectedTemplateId),
  );

  const hasAnyMcpConfiguredAgent = createMemo(() =>
    agents().some((a) => (a.mcpServers?.length ?? 0) > 0),
  );

  return (
    <div class="space-y-3">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <For each={WORKFLOW_TEMPLATES}>
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
              </div>
            </label>
          )}
        </For>
      </div>

      <Show when={selectedTemplate()}>
        {(template) => (
          <div class="space-y-3 pl-1">
            <Show
              when={
                template().requirements.some(
                  (r) => r.check.mcpServerConfigured,
                ) && !hasAnyMcpConfiguredAgent()
              }
            >
              <div class="flex items-start gap-2 p-2.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50">
                <AlertTriangle class="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                <p class="text-xs text-amber-800 dark:text-amber-300">
                  No agent has MCP tool access configured yet. This workflow has
                  steps (
                  {template()
                    .requirements.filter((r) => r.check.mcpServerConfigured)
                    .map((r) => r.label)
                    .join(', ')}
                  ) that will need one assigned before they can act.
                </p>
              </div>
            </Show>

            <For each={template().inputs}>
              {(input) => (
                <div>
                  <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {input.label}
                    <Show when={input.required}>
                      <span class="text-red-500"> *</span>
                    </Show>
                  </label>
                  <input
                    type={input.type === 'number' ? 'number' : 'text'}
                    class="w-full px-3 py-1.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary dark:bg-gray-900 dark:text-gray-100 border-gray-300 dark:border-gray-600"
                    value={props.inputValues[input.key] ?? input.default ?? ''}
                    onInput={(e) =>
                      props.onInputChange(input.key, e.currentTarget.value)
                    }
                    placeholder={input.default}
                    disabled={props.disabled}
                  />
                </div>
              )}
            </For>
          </div>
        )}
      </Show>
    </div>
  );
}
