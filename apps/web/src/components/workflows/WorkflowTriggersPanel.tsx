/**
 * Side panel for what starts a workflow by itself: webhook URLs other
 * services POST to, and channel messages (WhatsApp, Discord) matching a
 * rule. A new webhook's token is shown once, right after it's created.
 */

import { For, Show, createResource, createSignal } from 'solid-js';
import {
  X,
  Webhook,
  MessageSquare,
  Trash2,
  Copy,
  RefreshCw,
  Plus,
} from 'lucide-solid';
import { API_BASE, listChannels } from '../../lib/api';
import {
  createChannelTrigger,
  createWebhookTrigger,
  deleteWorkflowTrigger,
  listWorkflowTriggers,
  regenerateWebhookToken,
  updateWorkflowTrigger,
} from '../../lib/api-tasks';
import type {
  MessageMatchType,
  WebhookTokenDto,
  WorkflowTriggerDto,
} from '../../lib/types';
import { ConfirmDialog } from '../ui/ConfirmDialog';

export type WorkflowTriggersPanelProps = {
  taskId: string;
  onClose: () => void;
};

const MATCH_LABEL: Record<MessageMatchType, string> = {
  starts_with: 'Starts with',
  contains: 'Contains',
  equals: 'Is exactly',
  regex: 'Matches regex',
  any: 'Any message',
};

const inputClass =
  'w-full text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary';

export function webhookUrl(path: string): string {
  return `${API_BASE || window.location.origin}${path}`;
}

function describeTrigger(t: WorkflowTriggerDto): string {
  if (t.kind === 'webhook') return webhookUrl(t.webhookPath ?? '');
  const c = t.channel!;
  const rule =
    c.match.type === 'any'
      ? 'Any message'
      : `${MATCH_LABEL[c.match.type]} "${c.match.value ?? ''}"`;
  return `${rule} on ${c.channelId}${c.senders?.length ? ` from ${c.senders.join(', ')}` : ''}`;
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard can be unavailable (http, permissions); the text is visible.
  }
}

export function WorkflowTriggersPanel(props: WorkflowTriggersPanelProps) {
  const [triggers, { refetch }] = createResource(
    () => props.taskId,
    async (taskId) => {
      const result = await listWorkflowTriggers(taskId);
      if (!result.ok) throw new Error(result.error.message);
      return result.data;
    },
  );
  const [channels] = createResource(() => listChannels().catch(() => []));
  const [error, setError] = createSignal<string | null>(null);
  const [newToken, setNewToken] = createSignal<WebhookTokenDto | null>(null);
  const [showMessageForm, setShowMessageForm] = createSignal(false);
  const [pendingDelete, setPendingDelete] =
    createSignal<WorkflowTriggerDto | null>(null);

  // Message trigger form
  const [channelId, setChannelId] = createSignal('');
  const [matchType, setMatchType] =
    createSignal<MessageMatchType>('starts_with');
  const [matchValue, setMatchValue] = createSignal('');
  const [senders, setSenders] = createSignal('');
  const [replyWithResult, setReplyWithResult] = createSignal(true);
  const [ackText, setAckText] = createSignal('');
  const [saving, setSaving] = createSignal(false);

  async function run<T>(
    action: () => Promise<
      { ok: true; data: T } | { ok: false; error: { message: string } }
    >,
  ): Promise<T | null> {
    setError(null);
    const result = await action();
    if (!result.ok) {
      setError(result.error.message);
      return null;
    }
    await refetch();
    return result.data;
  }

  async function addWebhook() {
    const created = await run(() => createWebhookTrigger(props.taskId));
    if (created) setNewToken(created);
  }

  async function addMessageTrigger(e: Event) {
    e.preventDefault();
    setSaving(true);
    const created = await run(() =>
      createChannelTrigger(props.taskId, {
        channelId: channelId() || channels()?.[0]?.id || '',
        match: {
          type: matchType(),
          ...(matchType() !== 'any' ? { value: matchValue() } : {}),
        },
        senders: senders()
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        replyWithResult: replyWithResult(),
        ...(ackText().trim() ? { ackText: ackText().trim() } : {}),
      }),
    );
    setSaving(false);
    if (created) {
      setShowMessageForm(false);
      setMatchValue('');
      setSenders('');
      setAckText('');
    }
  }

  async function regenerate(t: WorkflowTriggerDto) {
    const result = await run(() => regenerateWebhookToken(t.id));
    if (result) setNewToken(result);
  }

  async function confirmDelete() {
    const t = pendingDelete();
    setPendingDelete(null);
    if (t) await run(() => deleteWorkflowTrigger(t.id));
  }

  return (
    <aside class="h-full flex flex-col bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700">
      <div class="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700">
        <h2 class="text-sm font-semibold text-text-primary">Triggers</h2>
        <button
          type="button"
          class="p-1 rounded text-text-tertiary hover:bg-gray-100 dark:hover:bg-gray-700"
          title="Close"
          onClick={() => props.onClose()}
        >
          <X class="w-4 h-4" />
        </button>
      </div>

      <div class="flex-1 overflow-y-auto p-3 space-y-3 text-xs">
        <p class="text-text-tertiary">
          Start this workflow automatically. What arrives (the request body, or
          the message) is given to every step as the workflow input.
        </p>

        <Show when={error()}>
          <div
            role="alert"
            class="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 px-2.5 py-1.5"
          >
            {error()}
          </div>
        </Show>

        <Show when={newToken()}>
          {(created) => (
            <div class="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-2.5 space-y-2">
              <p class="font-medium text-amber-800 dark:text-amber-200">
                Copy the token now — it won't be shown again.
              </p>
              <div>
                <div class="text-text-tertiary mb-0.5">URL</div>
                <code class="block break-all bg-white dark:bg-gray-900 rounded px-1.5 py-1">
                  {webhookUrl(created().trigger.webhookPath ?? '')}
                </code>
              </div>
              <div>
                <div class="text-text-tertiary mb-0.5">Token</div>
                <div class="flex gap-1">
                  <code class="flex-1 min-w-0 break-all bg-white dark:bg-gray-900 rounded px-1.5 py-1">
                    {created().token}
                  </code>
                  <button
                    type="button"
                    class="p-1 rounded hover:bg-amber-100 dark:hover:bg-amber-900/40"
                    title="Copy token"
                    onClick={() => void copy(created().token)}
                  >
                    <Copy class="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <div>
                <div class="text-text-tertiary mb-0.5">Try it</div>
                <code class="block whitespace-pre-wrap break-all bg-white dark:bg-gray-900 rounded px-1.5 py-1">
                  {`curl -X POST '${webhookUrl(created().trigger.webhookPath ?? '')}' \\\n  -H 'Authorization: Bearer ${created().token}' \\\n  -H 'Content-Type: application/json' \\\n  -d '{"hello": "world"}'`}
                </code>
              </div>
              <button
                type="button"
                class="text-amber-700 dark:text-amber-300 underline"
                onClick={() => setNewToken(null)}
              >
                Done
              </button>
            </div>
          )}
        </Show>

        <Show
          when={(triggers()?.length ?? 0) > 0}
          fallback={
            <Show when={!triggers.loading}>
              <p class="text-text-tertiary italic">No triggers yet.</p>
            </Show>
          }
        >
          <ul class="space-y-2">
            <For each={triggers()}>
              {(t) => (
                <li class="rounded-lg border border-gray-200 dark:border-gray-700 p-2.5 space-y-1.5">
                  <div class="flex items-center gap-1.5">
                    {t.kind === 'webhook' ? (
                      <Webhook class="w-3.5 h-3.5 text-primary flex-shrink-0" />
                    ) : (
                      <MessageSquare class="w-3.5 h-3.5 text-green-600 flex-shrink-0" />
                    )}
                    <span class="font-medium text-text-primary truncate flex-1">
                      {t.name}
                    </span>
                    <label
                      class="flex items-center gap-1 text-text-tertiary"
                      title={t.enabled ? 'On' : 'Off'}
                    >
                      <input
                        type="checkbox"
                        checked={t.enabled}
                        aria-label={`${t.name} enabled`}
                        onChange={(e) =>
                          void run(() =>
                            updateWorkflowTrigger(t.id, {
                              enabled: e.currentTarget.checked,
                            }),
                          )
                        }
                      />
                      On
                    </label>
                    <button
                      type="button"
                      class="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                      title="Delete trigger"
                      onClick={() => setPendingDelete(t)}
                    >
                      <Trash2 class="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <Show when={describeTrigger(t) !== t.name}>
                    <p class="text-text-secondary break-all">
                      {describeTrigger(t)}
                    </p>
                  </Show>
                  <Show when={t.kind === 'channel_message'}>
                    <p class="text-text-tertiary">
                      {t.channel?.replyWithResult
                        ? 'Replies with the result in the chat.'
                        : "Doesn't reply with the result."}
                    </p>
                  </Show>
                  <div class="flex items-center gap-2 text-text-tertiary">
                    <span class="flex-1">
                      {t.lastFiredAt
                        ? `Last started a run ${new Date(t.lastFiredAt).toLocaleString()}`
                        : 'Hasn’t started a run yet'}
                    </span>
                    <Show when={t.kind === 'webhook'}>
                      <button
                        type="button"
                        class="inline-flex items-center gap-1 hover:text-text-primary"
                        title="Copy URL"
                        onClick={() =>
                          void copy(webhookUrl(t.webhookPath ?? ''))
                        }
                      >
                        <Copy class="w-3 h-3" /> URL
                      </button>
                      <button
                        type="button"
                        class="inline-flex items-center gap-1 hover:text-text-primary"
                        title="Replace the token; the old one stops working"
                        onClick={() => void regenerate(t)}
                      >
                        <RefreshCw class="w-3 h-3" /> New token
                      </button>
                    </Show>
                  </div>
                </li>
              )}
            </For>
          </ul>
        </Show>

        <div class="flex flex-wrap gap-1.5">
          <button
            type="button"
            class="inline-flex items-center gap-1.5 px-2.5 py-1.5 font-medium rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700"
            onClick={() => void addWebhook()}
          >
            <Plus class="w-3.5 h-3.5" /> Webhook
          </button>
          <button
            type="button"
            class="inline-flex items-center gap-1.5 px-2.5 py-1.5 font-medium rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700"
            onClick={() => setShowMessageForm((v) => !v)}
            aria-expanded={showMessageForm()}
          >
            <Plus class="w-3.5 h-3.5" /> Message trigger
          </button>
        </div>

        <Show when={showMessageForm()}>
          <form
            class="rounded-lg border border-gray-200 dark:border-gray-700 p-2.5 space-y-2"
            onSubmit={(e) => void addMessageTrigger(e)}
          >
            <Show
              when={(channels()?.length ?? 0) > 0}
              fallback={
                <p class="text-text-tertiary">
                  No channels are set up yet. Connect WhatsApp or Discord on the
                  Channels page first.
                </p>
              }
            >
              <label class="block">
                <span class="block text-text-tertiary mb-0.5">Channel</span>
                <select
                  class={inputClass}
                  value={channelId() || channels()?.[0]?.id || ''}
                  onChange={(e) => setChannelId(e.currentTarget.value)}
                >
                  <For each={channels() ?? []}>
                    {(c) => (
                      <option value={c.id}>
                        {c.id} ({c.type})
                      </option>
                    )}
                  </For>
                </select>
              </label>
              <div class="flex gap-1.5">
                <label class="block w-32 flex-shrink-0">
                  <span class="block text-text-tertiary mb-0.5">Message</span>
                  <select
                    class={inputClass}
                    value={matchType()}
                    onChange={(e) =>
                      setMatchType(e.currentTarget.value as MessageMatchType)
                    }
                  >
                    <For each={Object.entries(MATCH_LABEL)}>
                      {([value, label]) => (
                        <option value={value}>{label}</option>
                      )}
                    </For>
                  </select>
                </label>
                <Show when={matchType() !== 'any'}>
                  <label class="block flex-1 min-w-0">
                    <span class="block text-text-tertiary mb-0.5">Text</span>
                    <input
                      class={inputClass}
                      placeholder="e.g. quote"
                      value={matchValue()}
                      onInput={(e) => setMatchValue(e.currentTarget.value)}
                    />
                  </label>
                </Show>
              </div>
              <Show when={matchType() === 'any'}>
                <p class="text-amber-700 dark:text-amber-300">
                  Every message on this channel will start the workflow instead
                  of reaching your chat agent.
                </p>
              </Show>
              <label class="block">
                <span class="block text-text-tertiary mb-0.5">
                  Only from (optional, comma-separated numbers or ids)
                </span>
                <input
                  class={inputClass}
                  placeholder="Anyone the channel accepts"
                  value={senders()}
                  onInput={(e) => setSenders(e.currentTarget.value)}
                />
              </label>
              <label class="block">
                <span class="block text-text-tertiary mb-0.5">
                  Immediate reply (optional)
                </span>
                <input
                  class={inputClass}
                  placeholder="On it — running this workflow."
                  value={ackText()}
                  onInput={(e) => setAckText(e.currentTarget.value)}
                />
              </label>
              <label class="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={replyWithResult()}
                  onChange={(e) => setReplyWithResult(e.currentTarget.checked)}
                />
                Send the result back to the chat when the run ends
              </label>
              <button
                type="submit"
                disabled={saving()}
                class="px-2.5 py-1.5 font-medium rounded-lg bg-primary hover:bg-primary-hover text-white disabled:opacity-50"
              >
                {saving() ? 'Adding…' : 'Add trigger'}
              </button>
            </Show>
          </form>
        </Show>
      </div>

      <ConfirmDialog
        isOpen={pendingDelete() !== null}
        title="Delete trigger?"
        body={
          pendingDelete()?.kind === 'webhook'
            ? 'The webhook URL stops working immediately.'
            : 'Matching messages will go to your chat agent again.'
        }
        confirmLabel="Delete"
        tone="danger"
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </aside>
  );
}
