import { Show, For, createSignal } from 'solid-js';
import {
  Clock,
  CheckCircle,
  XCircle,
  Loader,
  AlertCircle,
  ChevronDown,
  ChevronUp,
} from 'lucide-solid';
import type { SessionRun, RunStatus } from '../lib/api';

type RunListProps = {
  runs: SessionRun[];
  isLoading: boolean;
  error?: string;
  /** Called when user clicks on a run — passes the run's firstMessageId to scroll to */
  onRunClick?: (firstMessageId: string | undefined) => void;
};

/**
 * Get icon for run status
 */
function getStatusIcon(status: RunStatus) {
  switch (status) {
    case 'queued':
      return <Clock class="w-4 h-4 text-text-tertiary" />;
    case 'running':
      return <Loader class="w-4 h-4 text-blue-500 animate-spin" />;
    case 'succeeded':
      return <CheckCircle class="w-4 h-4 text-green-500" />;
    case 'failed':
      return <XCircle class="w-4 h-4 text-red-500" />;
    case 'cancelled':
      return <AlertCircle class="w-4 h-4 text-yellow-500" />;
    default:
      return <Clock class="w-4 h-4 text-text-tertiary" />;
  }
}

/**
 * Get status badge class
 */
function getStatusClass(status: RunStatus) {
  switch (status) {
    case 'queued':
      return 'bg-gray-100 dark:bg-gray-700 text-text-secondary';
    case 'running':
      return 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400';
    case 'succeeded':
      return 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400';
    case 'failed':
      return 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400';
    case 'cancelled':
      return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400';
    default:
      return 'bg-gray-100 dark:bg-gray-700 text-text-secondary';
  }
}

/**
 * Format timestamp
 */
function formatTime(isoString: string): string {
  return new Date(isoString).toLocaleTimeString();
}

/**
 * Truncate ID for display
 */
function truncateId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) + '...' : id;
}

export function RunList(props: RunListProps) {
  const [isCollapsed, setIsCollapsed] = createSignal(true);

  return (
    <div class="border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
      {/* Header */}
      <div
        class="px-4 py-2 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800/70 transition-colors"
        onClick={() => setIsCollapsed(!isCollapsed())}
      >
        <div class="flex items-center gap-2">
          <Show
            when={isCollapsed()}
            fallback={<ChevronDown class="w-4 h-4 text-text-tertiary" />}
          >
            <ChevronUp class="w-4 h-4 text-text-tertiary" />
          </Show>
          <h3 class="text-sm font-medium text-text-secondary">Runs</h3>
        </div>
        <Show when={props.runs.length > 0}>
          <span class="text-xs text-text-tertiary">
            {props.runs.length} run{props.runs.length !== 1 ? 's' : ''}
          </span>
        </Show>
      </div>

      {/* Content - hidden when collapsed */}
      <Show when={!isCollapsed()}>
        {/* Loading state */}
        <Show when={props.isLoading}>
          <div class="px-4 py-4 text-center text-sm text-text-tertiary">
            <Loader class="w-4 h-4 animate-spin inline mr-2" />
            Loading runs...
          </div>
        </Show>

        {/* Error state */}
        <Show when={props.error}>
          <div class="px-4 py-4 text-center text-sm text-error">
            {props.error}
          </div>
        </Show>

        {/* Empty state */}
        <Show
          when={!props.isLoading && !props.error && props.runs.length === 0}
        >
          <div class="px-4 py-4 text-center text-sm text-text-tertiary">
            No runs yet
          </div>
        </Show>

        {/* Runs list */}
        <Show when={!props.isLoading && props.runs.length > 0}>
          <div class="max-h-48 overflow-y-auto">
            <For each={props.runs}>
              {(run) => (
                <div
                  class="px-4 py-2 border-b border-gray-100 dark:border-gray-700 last:border-b-0 hover:bg-white dark:hover:bg-gray-800 transition-colors cursor-pointer"
                  onClick={() => {
                    props.onRunClick?.(run.firstMessageId);
                  }}
                >
                  <div class="flex items-center justify-between gap-2">
                    {/* Left side: status and ID */}
                    <div class="flex items-center gap-2">
                      {getStatusIcon(run.status)}
                      <code class="text-xs font-mono text-text-tertiary">
                        {truncateId(run.id)}
                      </code>
                      <Show when={run.agentId}>
                        <span class="text-xs text-text-tertiary">
                          • {run.agentId}
                        </span>
                      </Show>
                    </div>

                    {/* Right side: status badge and time */}
                    <div class="flex items-center gap-2">
                      <span
                        class={`text-xs px-2 py-0.5 rounded-full ${getStatusClass(run.status)}`}
                      >
                        {run.status}
                      </span>
                      <span class="text-xs text-text-tertiary">
                        {formatTime(run.createdAt)}
                      </span>
                    </div>
                  </div>

                  {/* Provider/Model info */}
                  <div class="mt-1 flex items-center gap-2 text-xs text-text-tertiary">
                    <span>{run.providerId}</span>
                    <span>•</span>
                    <span>{run.modelId}</span>
                  </div>

                  {/* Error message */}
                  <Show when={run.status === 'failed' && run.errorMessage}>
                    <div class="mt-1 text-xs text-red-600 dark:text-red-400">
                      {run.errorMessage}
                    </div>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  );
}
