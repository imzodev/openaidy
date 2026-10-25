/**
 * Assistant settings: who OpenAidy works for, where to reach them
 * (WhatsApp etc.), their timezone and quiet hours, whether workflows tell
 * them about approvals and failures, and the daily briefing.
 */

import { createMemo, createResource, createSignal, For, Show } from 'solid-js';
import {
  listChannels,
  listScheduled,
  triggerPulse,
  type AppConfig,
} from '../../../lib/api';
import { getStoredToken } from '../../../lib/auth-token';
import type { OwnerConfig } from '../../../lib/types';

interface AssistantTabProps {
  config: () => AppConfig | undefined;
  onChange: (patch: { owner?: OwnerConfig; timezone?: string }) => void;
  /** Unsaved edits: "Send it now" uses the saved briefing. */
  hasChanges: boolean;
}

const fieldClass =
  'w-full px-3 py-1.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary bg-white dark:bg-gray-900 dark:text-gray-100 border-gray-300 dark:border-gray-600';

function timezones(): string[] {
  const intl = Intl as unknown as {
    supportedValuesOf?: (key: string) => string[];
  };
  return intl.supportedValuesOf?.('timeZone') ?? ['UTC'];
}

function Section(props: {
  title: string;
  description: string;
  children: unknown;
}) {
  return (
    <section class="space-y-3">
      <div>
        <h3 class="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {props.title}
        </h3>
        <p class="text-xs text-gray-500 dark:text-gray-400">
          {props.description}
        </p>
      </div>
      {props.children as never}
    </section>
  );
}

export function AssistantTab(props: AssistantTabProps) {
  const owner = createMemo<OwnerConfig>(() => props.config()?.owner ?? {});
  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const zone = () => props.config()?.defaults.timezone ?? '';
  const [channels] = createResource(() => listChannels().catch(() => []));
  const [sending, setSending] = createSignal(false);
  const [sendResult, setSendResult] = createSignal<string | null>(null);

  const update = (patch: Partial<OwnerConfig>) =>
    props.onChange({ owner: { ...owner(), ...patch } });
  const briefing = () => owner().briefing ?? { enabled: false, time: '08:00' };
  const updateBriefing = (
    patch: Partial<NonNullable<OwnerConfig['briefing']>>,
  ) => update({ briefing: { ...briefing(), ...patch } });

  async function sendBriefingNow() {
    setSendResult(null);
    const token = getStoredToken();
    if (!token) return;
    setSending(true);
    try {
      const { items } = await listScheduled(token, 'briefing');
      const job = items[0];
      if (!job) {
        setSendResult('Turn the briefing on and save first.');
        return;
      }
      await triggerPulse(token, job.id);
      setSendResult('Sent — check your WhatsApp.');
    } catch (err) {
      setSendResult(err instanceof Error ? err.message : "Couldn't send it");
    } finally {
      setSending(false);
    }
  }

  return (
    <div class="p-6 space-y-8 max-w-2xl">
      <Section
        title="You"
        description="Who OpenAidy works for. Agents use this to tell you from your customers, and send briefings, alerts, reminders and approvals here."
      >
        <label class="block">
          <span class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
            Your name
          </span>
          <input
            class={fieldClass}
            value={owner().name ?? ''}
            onInput={(e) =>
              update({ name: e.currentTarget.value || undefined })
            }
          />
        </label>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label class="block">
            <span class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              Reach me on
            </span>
            <select
              class={fieldClass}
              value={owner().channelId ?? ''}
              onChange={(e) =>
                update({ channelId: e.currentTarget.value || undefined })
              }
            >
              <option value="">Nowhere yet</option>
              <For each={channels() ?? []}>
                {(c) => (
                  <option value={c.id}>
                    {c.id} ({c.type})
                  </option>
                )}
              </For>
            </select>
          </label>
          <label class="block">
            <span class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              Your number (with country code)
            </span>
            <input
              class={fieldClass}
              placeholder="+52 155 1234 5678"
              value={owner().contact ?? ''}
              onInput={(e) =>
                update({ contact: e.currentTarget.value || undefined })
              }
            />
          </label>
        </div>
        <div>
          <label
            for="assistant-timezone"
            class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            Timezone
          </label>
          <select
            id="assistant-timezone"
            class={fieldClass}
            value={zone()}
            onChange={(e) =>
              props.onChange({ timezone: e.currentTarget.value || undefined })
            }
          >
            <option value="">UTC (not set)</option>
            <For each={timezones()}>
              {(tz) => <option value={tz}>{tz}</option>}
            </For>
          </select>
          <Show when={!zone() && browserZone && browserZone !== 'UTC'}>
            <button
              type="button"
              class="mt-1 text-xs text-primary hover:underline"
              onClick={() => props.onChange({ timezone: browserZone })}
            >
              Use this browser's timezone ({browserZone})
            </button>
          </Show>
          <span class="block text-[11px] text-gray-400 mt-0.5">
            Schedules ("every day at 9:00"), reminders and what agents think
            "now" is all use it.
          </span>
        </div>
        <div class="flex flex-wrap items-end gap-3">
          <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={Boolean(owner().quietHours)}
              onChange={(e) =>
                update({
                  quietHours: e.currentTarget.checked
                    ? { from: '22:00', to: '07:00' }
                    : undefined,
                })
              }
            />
            Quiet hours
          </label>
          <Show when={owner().quietHours}>
            {(quiet) => (
              <>
                <input
                  type="time"
                  class={`${fieldClass} w-28`}
                  aria-label="Quiet from"
                  value={quiet().from}
                  onInput={(e) =>
                    update({
                      quietHours: { ...quiet(), from: e.currentTarget.value },
                    })
                  }
                />
                <span class="text-xs text-gray-500 pb-2">to</span>
                <input
                  type="time"
                  class={`${fieldClass} w-28`}
                  aria-label="Quiet until"
                  value={quiet().to}
                  onInput={(e) =>
                    update({
                      quietHours: { ...quiet(), to: e.currentTarget.value },
                    })
                  }
                />
              </>
            )}
          </Show>
        </div>
        <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input
            type="checkbox"
            checked={owner().notifyWorkflowEvents !== false}
            onChange={(e) =>
              update({ notifyWorkflowEvents: e.currentTarget.checked })
            }
          />
          Tell me when a workflow needs my approval or fails
        </label>
      </Section>

      <Section
        title="Daily briefing"
        description="A short summary sent to you every morning: what's on today, what's waiting on you, what went wrong."
      >
        <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input
            type="checkbox"
            checked={briefing().enabled}
            onChange={(e) =>
              updateBriefing({ enabled: e.currentTarget.checked })
            }
          />
          Send me a daily briefing
        </label>
        <Show when={briefing().enabled}>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label class="block">
              <span class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                At
              </span>
              <input
                type="time"
                class={fieldClass}
                value={briefing().time}
                onInput={(e) => updateBriefing({ time: e.currentTarget.value })}
              />
            </label>
            <label class="block">
              <span class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                Written by
              </span>
              <select
                class={fieldClass}
                value={briefing().agentId ?? ''}
                onChange={(e) =>
                  updateBriefing({
                    agentId: e.currentTarget.value || undefined,
                  })
                }
              >
                <option value="">Default agent</option>
                <For each={props.config()?.agents ?? []}>
                  {(a) => <option value={a.id}>{a.name}</option>}
                </For>
              </select>
            </label>
          </div>
          <label class="block">
            <span class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              What to cover
            </span>
            <textarea
              rows={3}
              class={`${fieldClass} resize-y`}
              placeholder="Today's calendar, unpaid invoices, important unread email, yesterday's sales."
              value={briefing().instructions ?? ''}
              onInput={(e) =>
                updateBriefing({
                  instructions: e.currentTarget.value || undefined,
                })
              }
            />
            <span class="block text-[11px] text-gray-400 mt-0.5">
              The agent needs the matching integrations (calendar, email,
              payments). Approvals waiting and failed workflows are always
              included.
            </span>
          </label>
          <div class="flex items-center gap-3">
            <button
              type="button"
              class="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
              disabled={sending() || props.hasChanges}
              title={props.hasChanges ? 'Save your changes first' : undefined}
              onClick={() => void sendBriefingNow()}
            >
              {sending() ? 'Sending…' : 'Send it now'}
            </button>
            <Show when={sendResult()}>
              <span class="text-xs text-gray-500 dark:text-gray-400">
                {sendResult()}
              </span>
            </Show>
          </div>
        </Show>
        <Show
          when={briefing().enabled && !(owner().channelId && owner().contact)}
        >
          <p class="text-xs text-amber-700 dark:text-amber-300">
            Set where to reach you above, or the briefing has nowhere to go.
          </p>
        </Show>
      </Section>
    </div>
  );
}
