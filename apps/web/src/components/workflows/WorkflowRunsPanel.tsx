/**
 * Side panel listing a workflow's runs, newest first. Expanding a finished
 * run shows how each step ended (its result, or why it failed or was
 * skipped) with a link to the step's conversation. The run in progress is
 * shown live on the canvas instead.
 */

import { For, Show, createSignal } from 'solid-js';
import { X, ChevronDown, ChevronRight, MessageSquare } from 'lucide-solid';
import type { WorkflowRunDto } from '../../lib/types';
import { STATUS_ICONS, STATUS_BADGE_BG } from '../tasks/subtask-status';

export type WorkflowRunsPanelProps = {
  runs: WorkflowRunDto[];
  onClose: () => void;
};

const RUN_STATUS_STYLE: Record<WorkflowRunDto['status'], string> = {
  running:
    'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
  completed:
    'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  failed: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  cancelled: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
};

export const RUN_STATUS_LABEL: Record<WorkflowRunDto['status'], string> = {
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Stopped',
};

const TRIGGER_LABEL: Record<WorkflowRunDto['trigger'], string> = {
  manual: 'Run button',
  schedule: 'Schedule',
  agent: 'Agent',
};

/** A rejected approval step completes with `OUTCOME: rejected`. */
function isRejected(result: string | null | undefined): boolean {
  const outcomes = result?.match(/^OUTCOME:\s*(.+)$/gim);
  return /rejected\s*$/i.test(outcomes?.at(-1) ?? '');
}

/** "12s", "4m 05s", "1h 02m". */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

export function WorkflowRunsPanel(props: WorkflowRunsPanelProps) {
  const [expanded, setExpanded] = createSignal<string | null>(
    props.runs.find((r) => r.status !== 'running')?.id ?? null,
  );

  return (
    <aside class="h-full flex flex-col bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700">
      <div class="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700">
        <h2 class="text-sm font-semibold text-text-primary">Runs</h2>
        <button
          type="button"
          class="p-1 rounded text-text-tertiary hover:bg-gray-100 dark:hover:bg-gray-700"
          title="Close"
          onClick={() => props.onClose()}
        >
          <X class="w-4 h-4" />
        </button>
      </div>

      <div class="flex-1 overflow-y-auto">
        <Show
          when={props.runs.length > 0}
          fallback={
            <p class="p-4 text-xs text-text-tertiary">
              This workflow hasn't run yet. Press Run to start it.
            </p>
          }
        >
          <ul class="divide-y divide-gray-100 dark:divide-gray-700">
            <For each={props.runs}>
              {(run) => {
                const isOpen = () => expanded() === run.id;
                const duration = () =>
                  formatDuration(
                    (run.finishedAt ? Date.parse(run.finishedAt) : Date.now()) -
                      Date.parse(run.startedAt),
                  );
                return (
                  <li>
                    <button
                      type="button"
                      class="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700/50 flex items-start gap-2"
                      onClick={() => setExpanded(isOpen() ? null : run.id)}
                      aria-expanded={isOpen()}
                    >
                      <span class="mt-0.5 text-text-tertiary">
                        {isOpen() ? (
                          <ChevronDown class="w-3.5 h-3.5" />
                        ) : (
                          <ChevronRight class="w-3.5 h-3.5" />
                        )}
                      </span>
                      <span class="flex-1 min-w-0">
                        <span class="flex items-center gap-1.5">
                          <span
                            class={`text-[11px] font-medium rounded-full px-2 py-0.5 ${RUN_STATUS_STYLE[run.status]}`}
                          >
                            {RUN_STATUS_LABEL[run.status]}
                          </span>
                          <span class="text-[11px] text-text-tertiary">
                            {TRIGGER_LABEL[run.trigger]} · {duration()}
                          </span>
                        </span>
                        <span class="block text-[11px] text-text-tertiary mt-0.5">
                          {new Date(run.startedAt).toLocaleString()}
                        </span>
                        <Show when={run.error}>
                          <span class="block text-xs text-red-600 dark:text-red-400 mt-1 line-clamp-2">
                            {run.error}
                          </span>
                        </Show>
                      </span>
                    </button>

                    <Show when={isOpen()}>
                      <div class="px-3 pb-3 pl-8">
                        <Show
                          when={run.summary}
                          fallback={
                            <p class="text-xs text-text-tertiary">
                              In progress — see the canvas for live status.
                            </p>
                          }
                        >
                          {(summary) => (
                            <ol class="space-y-1.5">
                              <For each={summary().items}>
                                {(item) => (
                                  <li class="text-xs">
                                    <div class="flex items-center gap-1.5">
                                      <span
                                        class={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold leading-none flex-shrink-0 ${STATUS_BADGE_BG[item.status] ?? STATUS_BADGE_BG.pending}`}
                                      >
                                        {STATUS_ICONS[item.status]}
                                      </span>
                                      <span class="font-medium text-text-primary truncate flex-1">
                                        {item.title}
                                      </span>
                                      <Show when={isRejected(item.result)}>
                                        <span class="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
                                          Rejected
                                        </span>
                                      </Show>
                                      <Show when={item.sessionId}>
                                        <a
                                          href={`/chat?sessionId=${item.sessionId}`}
                                          class="text-primary"
                                          title="Open conversation"
                                        >
                                          <MessageSquare class="w-3.5 h-3.5" />
                                        </a>
                                      </Show>
                                    </div>
                                    <Show when={item.result}>
                                      <p class="ml-5 mt-0.5 text-text-tertiary whitespace-pre-wrap break-words line-clamp-3">
                                        {item.result}
                                      </p>
                                    </Show>
                                  </li>
                                )}
                              </For>
                            </ol>
                          )}
                        </Show>
                      </div>
                    </Show>
                  </li>
                );
              }}
            </For>
          </ul>
        </Show>
      </div>
    </aside>
  );
}
