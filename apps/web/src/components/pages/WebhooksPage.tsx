/**
 * Every webhook that starts a workflow, across workflows. Webhooks are
 * created and managed from each workflow's Triggers panel; this page is
 * the overview, linking back to them.
 */

import { For, Show, createResource } from 'solid-js';
import { Webhook, Copy, ArrowRight } from 'lucide-solid';
import { Layout } from './Layout';
import { listAllWorkflowTriggers } from '../../lib/api-tasks';
import { webhookUrl } from '../workflows/WorkflowTriggersPanel';

export type WebhooksPageProps = {
  onOpenWorkflow: (taskId: string) => void;
};

export function WebhooksPage(props: WebhooksPageProps) {
  const [hooks] = createResource(async () => {
    const result = await listAllWorkflowTriggers('webhook');
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  });

  return (
    <Layout
      title="Webhooks"
      description="URLs that start a workflow when another service calls them"
    >
      <div class="max-w-3xl space-y-3">
        <p class="text-sm text-text-tertiary">
          To add a webhook, open a workflow and use its Triggers panel (the
          lightning button). The request body becomes the workflow's input.
        </p>
        <Show when={hooks.error}>
          <p class="text-sm text-red-600 dark:text-red-400">
            Couldn't load webhooks:{' '}
            {String(hooks.error?.message ?? hooks.error)}
          </p>
        </Show>
        <Show
          when={(hooks()?.length ?? 0) > 0}
          fallback={
            <Show when={!hooks.loading && !hooks.error}>
              <div class="rounded-lg border border-dashed border-gray-300 dark:border-gray-600 p-8 text-center text-sm text-text-tertiary">
                No webhooks yet.
              </div>
            </Show>
          }
        >
          <ul class="divide-y divide-gray-200 dark:divide-gray-700 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
            <For each={hooks()}>
              {(hook) => (
                <li class="p-3 flex items-start gap-3">
                  <Webhook class="w-4 h-4 mt-0.5 text-primary flex-shrink-0" />
                  <div class="flex-1 min-w-0 space-y-0.5">
                    <div class="flex items-center gap-2">
                      <span class="text-sm font-medium text-text-primary truncate">
                        {hook.name}
                      </span>
                      <Show when={!hook.enabled}>
                        <span class="text-[10px] rounded-full px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 text-text-tertiary">
                          Off
                        </span>
                      </Show>
                    </div>
                    <code class="block text-xs text-text-secondary break-all">
                      {webhookUrl(hook.webhookPath ?? '')}
                    </code>
                    <p class="text-xs text-text-tertiary">
                      {hook.lastFiredAt
                        ? `Last started a run ${new Date(hook.lastFiredAt).toLocaleString()}`
                        : 'Hasn’t started a run yet'}
                    </p>
                  </div>
                  <button
                    type="button"
                    class="p-1.5 rounded-lg text-text-tertiary hover:bg-gray-100 dark:hover:bg-gray-700"
                    title="Copy URL"
                    onClick={() =>
                      void navigator.clipboard
                        ?.writeText(webhookUrl(hook.webhookPath ?? ''))
                        .catch(() => undefined)
                    }
                  >
                    <Copy class="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    class="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline flex-shrink-0 mt-1"
                    onClick={() => props.onOpenWorkflow(hook.taskId)}
                  >
                    {hook.taskTitle || 'Workflow'}
                    <ArrowRight class="w-3 h-3" />
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>
    </Layout>
  );
}
