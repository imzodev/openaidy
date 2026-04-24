/**
 * PulseHistoryDrawer Component
 *
 * Right-side drawer showing execution history for a pulse.
 */

import { createSignal, createEffect, Show, For } from 'solid-js';
import { X, CheckCircle, XCircle, Clock, Loader } from 'lucide-solid';
import { getPulseHistory, type PulseRun } from '../../lib/api';
import { resolveToken } from '../../lib/auth-token';

export type PulseHistoryDrawerProps = {
  pulseId: string | null;
  onClose: () => void;
};

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

function formatDuration(
  startedAt: string | null,
  finishedAt: string | null,
): string {
  if (!startedAt || !finishedAt) return '—';
  const start = new Date(startedAt).getTime();
  const end = new Date(finishedAt).getTime();
  const diffMs = end - start;
  if (diffMs < 1000) return '<1s';
  const diffSecs = Math.floor(diffMs / 1000);
  if (diffSecs < 60) return `${diffSecs}s`;
  const diffMins = Math.floor(diffSecs / 60);
  return `${diffMins}m ${diffSecs % 60}s`;
}

const STATUS_ICONS: Record<PulseRun['status'], typeof CheckCircle> = {
  succeeded: CheckCircle,
  failed: XCircle,
  queued: Clock,
  running: Loader,
};

const STATUS_STYLES: Record<PulseRun['status'], string> = {
  succeeded: 'text-green-500',
  failed: 'text-red-500',
  queued: 'text-yellow-500',
  running: 'text-blue-500 animate-spin',
};

export function PulseHistoryDrawer(props: PulseHistoryDrawerProps) {
  const [runs, setRuns] = createSignal<PulseRun[]>([]);
  const [isLoading, setIsLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const token = () => resolveToken() ?? '';

  const load = async () => {
    if (!props.pulseId) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await getPulseHistory(token(), props.pulseId, 20);
      setRuns(data.runs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load history');
    } finally {
      setIsLoading(false);
    }
  };

  createEffect(() => {
    if (props.pulseId) {
      void load();
    }
  });

  return (
    <Show when={props.pulseId}>
      <div class="fixed inset-0 z-50 flex">
        {/* Backdrop */}
        <div class="absolute inset-0 bg-black/30" onClick={props.onClose} />

        {/* Drawer */}
        <div class="ml-auto relative w-full max-w-md bg-white dark:bg-gray-800 shadow-xl flex flex-col h-full">
          {/* Header */}
          <div class="flex items-center justify-between px-4 py-4 border-b border-gray-200 dark:border-gray-700">
            <h2 class="text-lg font-semibold text-text-primary">Run History</h2>
            <button
              onClick={props.onClose}
              class="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              <X class="w-5 h-5 text-text-tertiary" />
            </button>
          </div>

          {/* Content */}
          <div class="flex-1 overflow-y-auto p-4">
            <Show when={isLoading()}>
              <div class="flex items-center justify-center py-8">
                <div class="animate-pulse text-text-tertiary">Loading...</div>
              </div>
            </Show>

            <Show when={error()}>
              <p class="text-red-500 text-sm">{error()}</p>
            </Show>

            <Show when={!isLoading() && !error() && runs().length === 0}>
              <p class="text-text-tertiary text-sm text-center py-8">
                No runs yet
              </p>
            </Show>

            <Show when={!isLoading() && !error() && runs().length > 0}>
              <div class="space-y-3">
                <For each={runs()}>
                  {(run) => {
                    const Icon = STATUS_ICONS[run.status];
                    return (
                      <div class="bg-gray-50 dark:bg-gray-900 rounded-lg p-3 border border-gray-100 dark:border-gray-700">
                        <div class="flex items-center justify-between mb-2">
                          <div class="flex items-center gap-2">
                            <Icon
                              class={`w-4 h-4 ${STATUS_STYLES[run.status]}`}
                            />
                            <span class="text-sm font-medium text-text-primary capitalize">
                              {run.status}
                            </span>
                          </div>
                          <span class="text-xs text-text-tertiary">
                            {run.attemptNumber === 0
                              ? 'Manual'
                              : `#${run.attemptNumber}`}
                          </span>
                        </div>
                        <div class="grid grid-cols-2 gap-2 text-xs text-text-secondary">
                          <div>
                            <span class="text-text-tertiary">Started:</span>{' '}
                            {formatDateTime(run.startedAt)}
                          </div>
                          <div>
                            <span class="text-text-tertiary">Duration:</span>{' '}
                            {formatDuration(run.startedAt, run.finishedAt)}
                          </div>
                        </div>
                        <Show when={run.errorMessage}>
                          <p class="text-xs text-red-500 mt-2">
                            {run.errorCode}: {run.errorMessage}
                          </p>
                        </Show>
                      </div>
                    );
                  }}
                </For>
              </div>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
}
