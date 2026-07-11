import { createResource, createSignal, Show } from 'solid-js';
import { Copy, RefreshCw } from 'lucide-solid';
import { fetchAppInfo, type AppInfo } from '../../../lib/api';

const RELEASES_URL = 'https://github.com/imzodev/openaidy/releases';

/**
 * Format an uptime duration (ms) as a compact human string.
 * Examples: "12s", "3m 14s", "1h 27m", "2d 4h".
 */
function formatUptime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function buildDebugBlock(info: AppInfo): string {
  return [
    `OpenAidy v${info.version}`,
    `Node ${info.nodeVersion}`,
    `Platform ${info.platform}/${info.arch}`,
    `PID ${info.pid}`,
    `Uptime ${formatUptime(info.uptimeMs)}`,
    `Captured ${new Date().toISOString()}`,
  ].join('\n');
}

export function AboutTab() {
  const [info, { refetch }] = createResource(fetchAppInfo);
  const [copied, setCopied] = createSignal(false);

  const handleCopy = async () => {
    const value = info();
    if (!value) return;
    const text = buildDebugBlock(value);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1_500);
    } catch {
      // Clipboard not available (insecure context). Fall back to a visible
      // textarea selection so the user can copy manually.
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        setCopied(true);
        setTimeout(() => setCopied(false), 1_500);
      } catch {
        // ignore — user can still copy by hand
      } finally {
        document.body.removeChild(ta);
      }
    }
  };

  return (
    <div class="p-6 max-w-2xl">
      <h2 class="text-lg font-semibold text-text-primary mb-1">
        About OpenAidy
      </h2>
      <p class="text-sm text-text-tertiary mb-6">
        Build and runtime information for this OpenAidy instance.
      </p>

      <Show when={info.loading}>
        <div class="text-text-tertiary">Loading version info…</div>
      </Show>

      <Show when={info.error}>
        <div class="rounded-lg border border-red-300 bg-red-50 dark:bg-red-900/20 dark:border-red-800 p-4">
          <div class="text-red-700 dark:text-red-300 font-medium mb-2">
            Unable to retrieve version info
          </div>
          <div class="text-sm text-red-600 dark:text-red-400 mb-3">
            The server did not respond. It may be unreachable or restarting.
          </div>
          <button
            type="button"
            onClick={() => refetch()}
            class="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-red-600 hover:bg-red-700 text-white text-sm"
          >
            <RefreshCw class="w-3.5 h-3.5" />
            Retry
          </button>
        </div>
      </Show>

      <Show when={info()}>
        {(data) => (
          <>
            <div class="mb-6">
              <div class="text-xs uppercase tracking-wide text-text-tertiary mb-1">
                Version
              </div>
              <div class="font-mono text-3xl font-semibold text-text-primary">
                v{data().version}
              </div>
              <a
                href={`${RELEASES_URL}/tag/v${data().version}`}
                target="_blank"
                rel="noreferrer noopener"
                class="inline-block mt-2 text-sm text-primary hover:text-primary-hover hover:underline"
              >
                View release on GitHub →
              </a>
            </div>

            <dl class="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm mb-6">
              <dt class="text-text-tertiary">Node</dt>
              <dd class="font-mono text-text-primary">{data().nodeVersion}</dd>

              <dt class="text-text-tertiary">Platform</dt>
              <dd class="font-mono text-text-primary">
                {data().platform}/{data().arch}
              </dd>

              <dt class="text-text-tertiary">PID</dt>
              <dd class="font-mono text-text-primary">{data().pid}</dd>

              <dt class="text-text-tertiary">Uptime</dt>
              <dd class="font-mono text-text-primary">
                {formatUptime(data().uptimeMs)}
              </dd>

              <dt class="text-text-tertiary">Started</dt>
              <dd class="font-mono text-text-primary">
                {new Date(data().startedAt).toLocaleString()}
              </dd>
            </dl>

            <div class="flex items-center gap-3">
              <button
                type="button"
                onClick={handleCopy}
                class="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-primary hover:bg-primary-hover text-white text-sm disabled:opacity-50"
              >
                <Copy class="w-3.5 h-3.5" />
                {copied() ? 'Copied!' : 'Copy debug info'}
              </button>
              <button
                type="button"
                onClick={() => refetch()}
                class="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 text-text-primary hover:bg-gray-50 dark:hover:bg-gray-700 text-sm"
              >
                <RefreshCw class="w-3.5 h-3.5" />
                Refresh
              </button>
            </div>

            <p class="mt-6 text-xs text-text-tertiary">
              The version is read directly from the server's{' '}
              <code class="font-mono">package.json</code> at startup. The
              display prefix <span class="font-mono">v</span> matches the GitHub
              release tag (e.g. <span class="font-mono">v{data().version}</span>
              ).
            </p>
          </>
        )}
      </Show>
    </div>
  );
}
