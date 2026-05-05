import {
  createSignal,
  createEffect,
  onCleanup,
  onMount,
  For,
  Show,
} from 'solid-js';
import {
  RefreshCw,
  Trash2,
  Search,
  Filter,
  Activity,
  AlertCircle,
  AlertTriangle,
  Info,
  Bug,
} from 'lucide-solid';
import { Layout } from './Layout';
import { queryLogs, getLogStats, clearLogs } from '../../lib/api';
import type { LogEntry, LogLevel, LogStats } from '@openaidy/shared-types';

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  info: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  warn: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300',
  error: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
};

const LEVEL_ICONS: Record<LogLevel, typeof Bug> = {
  debug: Bug,
  info: Info,
  warn: AlertTriangle,
  error: AlertCircle,
};

export function LogsPage() {
  const [logs, setLogs] = createSignal<LogEntry[]>([]);
  const [stats, setStats] = createSignal<LogStats | null>(null);
  const [isLoading, setIsLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  // Filters
  const [selectedLevels, setSelectedLevels] = createSignal<LogLevel[]>([]);
  const [searchQuery, setSearchQuery] = createSignal('');

  const [_contexts, setContexts] = createSignal<string[]>([]);

  // Pagination
  const [hasMore, setHasMore] = createSignal(false);
  const [offset, setOffset] = createSignal(0);
  const limit = 100;

  let logListRef: HTMLDivElement | undefined;

  // Auto-refresh
  const [autoRefresh, setAutoRefresh] = createSignal(false);
  let refreshInterval: ReturnType<typeof setInterval> | null = null;

  const loadLogs = async (resetOffset = true) => {
    setIsLoading(true);
    setError(null);

    try {
      const newOffset = resetOffset ? 0 : offset();
      const result = await queryLogs({
        levels: selectedLevels().length > 0 ? selectedLevels() : undefined,
        search: searchQuery() || undefined,
        limit,
        offset: newOffset,
      });

      if (resetOffset) {
        setLogs(result.items);
        setOffset(0);
        // Scroll to top to show newest entries
        logListRef?.scrollTo({ top: 0, behavior: 'instant' });
      } else {
        setLogs([...logs(), ...result.items]);
      }
      setHasMore(result.hasMore);
      setOffset(newOffset + result.items.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load logs');
    } finally {
      setIsLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      const result = await getLogStats();
      setStats(result);
      // Extract unique contexts from stats
      setContexts(Object.keys(result.byContext));
    } catch (err) {
      console.error('Failed to load stats:', err);
    }
  };

  const handleClearLogs = async () => {
    if (!confirm('Are you sure you want to clear all logs?')) return;

    try {
      await clearLogs();
      setLogs([]);
      setStats(null);
      loadStats();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear logs');
    }
  };

  const toggleLevel = (level: LogLevel) => {
    const current = selectedLevels();
    if (current.includes(level)) {
      setSelectedLevels(current.filter((l) => l !== level));
    } else {
      setSelectedLevels([...current, level]);
    }
  };

  const formatTimestamp = (ts: string) => {
    const date = new Date(ts);
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
    });
  };

  // Load on mount
  onMount(() => {
    loadLogs(true);
    loadStats();
  });

  // Auto-refresh effect
  createEffect(() => {
    if (autoRefresh()) {
      refreshInterval = setInterval(() => {
        loadLogs(true);
        loadStats();
      }, 5000);
    } else if (refreshInterval) {
      clearInterval(refreshInterval);
      refreshInterval = null;
    }
  });

  // Cleanup interval on component unmount
  onCleanup(() => {
    if (refreshInterval) {
      clearInterval(refreshInterval);
    }
  });

  return (
    <Layout
      title="Logs"
      description="System and application logs"
      actions={
        <div class="flex items-center gap-2">
          <button
            onClick={() => {
              loadLogs(true);
              loadStats();
            }}
            disabled={isLoading()}
            class="flex items-center gap-1.5 px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50"
          >
            <RefreshCw class={`w-4 h-4 ${isLoading() ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            onClick={() => setAutoRefresh(!autoRefresh())}
            class={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors ${
              autoRefresh()
                ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                : 'text-text-secondary hover:text-text-primary hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
          >
            <Activity class="w-4 h-4" />
            Auto
          </button>
          <button
            onClick={handleClearLogs}
            class="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
          >
            <Trash2 class="w-4 h-4" />
            Clear
          </button>
        </div>
      }
    >
      {/* Stats Bar */}
      <Show when={stats()}>
        <div class="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
          <div class="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
            <div class="text-2xl font-bold text-text-primary">
              {stats()!.total}
            </div>
            <div class="text-xs text-text-tertiary">Total Logs</div>
          </div>
          <div class="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
            <div class="text-2xl font-bold text-gray-600 dark:text-gray-400">
              {stats()!.byLevel.debug}
            </div>
            <div class="text-xs text-text-tertiary">Debug</div>
          </div>
          <div class="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
            <div class="text-2xl font-bold text-blue-600 dark:text-blue-400">
              {stats()!.byLevel.info}
            </div>
            <div class="text-xs text-text-tertiary">Info</div>
          </div>
          <div class="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
            <div class="text-2xl font-bold text-yellow-600 dark:text-yellow-400">
              {stats()!.byLevel.warn}
            </div>
            <div class="text-xs text-text-tertiary">Warnings</div>
          </div>
          <div class="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
            <div class="text-2xl font-bold text-red-600 dark:text-red-400">
              {stats()!.byLevel.error}
            </div>
            <div class="text-xs text-text-tertiary">Errors</div>
          </div>
        </div>
      </Show>

      {/* Filters */}
      <div class="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 mb-4">
        <div class="flex items-center gap-4 flex-wrap">
          <div class="flex items-center gap-2">
            <Filter class="w-4 h-4 text-text-tertiary" />
            <span class="text-sm font-medium text-text-primary">Filter:</span>
          </div>

          {/* Level filters */}
          <div class="flex items-center gap-2">
            <For each={['debug', 'info', 'warn', 'error'] as LogLevel[]}>
              {(level) => {
                const Icon = LEVEL_ICONS[level];
                return (
                  <button
                    onClick={() => toggleLevel(level)}
                    class={`flex items-center gap-1 px-2 py-1 text-xs rounded-md transition-colors ${
                      selectedLevels().includes(level)
                        ? LEVEL_COLORS[level]
                        : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                    }`}
                  >
                    <Icon class="w-3 h-3" />
                    {level}
                  </button>
                );
              }}
            </For>
          </div>

          {/* Search */}
          <div class="flex-1 min-w-48">
            <div class="relative">
              <Search class="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
              <input
                type="text"
                placeholder="Search logs..."
                value={searchQuery()}
                onInput={(e) => setSearchQuery(e.currentTarget.value)}
                onKeyPress={(e) => e.key === 'Enter' && loadLogs(true)}
                class="w-full pl-8 pr-3 py-1.5 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 text-text-primary"
              />
            </div>
          </div>

          {/* Apply button */}
          <button
            onClick={() => loadLogs(true)}
            disabled={isLoading()}
            class="px-3 py-1.5 text-sm bg-primary hover:bg-primary-hover text-white rounded-lg transition-colors disabled:opacity-50"
          >
            Apply
          </button>
        </div>
      </div>

      {/* Error */}
      <Show when={error()}>
        <div class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-4">
          <div class="flex items-center gap-2 text-red-700 dark:text-red-300">
            <AlertCircle class="w-4 h-4" />
            <span>{error()}</span>
          </div>
        </div>
      </Show>

      {/* Logs List */}
      <div class="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        <Show when={isLoading() && logs().length === 0}>
          <div class="text-center py-12">
            <div class="animate-pulse text-text-tertiary">Loading logs...</div>
          </div>
        </Show>

        <Show when={!isLoading() && logs().length === 0}>
          <div class="text-center py-12">
            <Bug class="w-12 h-12 mx-auto mb-4 text-text-muted" />
            <h3 class="text-lg font-medium text-text-primary mb-2">
              No logs found
            </h3>
            <p class="text-text-secondary">
              {searchQuery() || selectedLevels().length > 0
                ? 'Try adjusting your filters'
                : 'Logs will appear here as they are generated'}
            </p>
          </div>
        </Show>

        <Show when={logs().length > 0}>
          <div
            ref={logListRef}
            class="divide-y divide-gray-100 dark:divide-gray-700"
          >
            <For each={logs()}>
              {(log) => {
                const LevelIcon = LEVEL_ICONS[log.level];
                return (
                  <div class="p-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                    <div class="flex items-start gap-3">
                      {/* Level badge */}
                      <div
                        class={`shrink-0 flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${LEVEL_COLORS[log.level]}`}
                      >
                        <LevelIcon class="w-3 h-3" />
                        {log.level.toUpperCase()}
                      </div>

                      {/* Content */}
                      <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2 text-xs text-text-tertiary mb-1">
                          <span class="font-mono">
                            {formatTimestamp(log.timestamp)}
                          </span>
                          <Show when={log.context}>
                            <span class="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-text-secondary">
                              {log.context}
                            </span>
                          </Show>
                          <Show when={log.sessionId}>
                            <span class="text-blue-500 dark:text-blue-400">
                              session: {log.sessionId!.slice(0, 8)}...
                            </span>
                          </Show>
                          <Show when={log.requestId}>
                            <span class="text-purple-500 dark:text-purple-400">
                              req: {log.requestId!.slice(0, 8)}...
                            </span>
                          </Show>
                        </div>
                        <div class="text-sm text-text-primary font-mono break-all">
                          {log.message}
                        </div>
                        <Show when={log.args && log.args.length > 0}>
                          <div class="mt-1 text-xs text-text-tertiary font-mono bg-gray-50 dark:bg-gray-900 rounded p-2 overflow-x-auto">
                            {JSON.stringify(log.args, null, 2)}
                          </div>
                        </Show>
                      </div>
                    </div>
                  </div>
                );
              }}
            </For>
          </div>

          {/* Load older logs */}
          <Show when={hasMore()}>
            <div class="p-4 border-t border-gray-100 dark:border-gray-700 text-center">
              <button
                onClick={() => loadLogs(false)}
                disabled={isLoading()}
                class="px-4 py-2 text-sm text-primary hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors disabled:opacity-50"
              >
                {isLoading() ? 'Loading...' : 'Load older logs'}
              </button>
            </div>
          </Show>
        </Show>
      </div>
    </Layout>
  );
}
