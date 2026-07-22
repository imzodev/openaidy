import { createResource, createSignal, createEffect, Show } from 'solid-js';
import { Copy, RefreshCw, ArrowUpCircle } from 'lucide-solid';
import {
  fetchAppInfo,
  checkForUpdates,
  triggerUpdate,
  ApiRequestError,
  type AppInfo,
} from '../../../lib/api';
import { ConfirmDialog, SaveMessage, type SaveMessageType } from '../../ui';
import {
  recordUpdateCheck,
  dismissUpdate,
  setUpdateInProgress,
  updateInProgress,
} from '../../../stores/update-notice';

const RELEASES_URL = 'https://github.com/imzodev/openaidy/releases';

/** Seconds to wait for the server to come back after a self-update, then reload. */
const RELOAD_AFTER_UPDATE_MS = 15_000;

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
  // Update check is admin-scoped and may fail (offline, non-admin). Keep it
  // separate from `info` so a check failure never hides the version panel.
  const [update, { refetch: refetchUpdate }] = createResource(checkForUpdates);
  const [copied, setCopied] = createSignal(false);
  const [confirmOpen, setConfirmOpen] = createSignal(false);
  const [message, setMessage] = createSignal<SaveMessageType>(null);

  // Feed the sidebar badge whenever a fresh check resolves.
  createEffect(() => {
    const result = update();
    if (result) recordUpdateCheck(result);
  });

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

  const handleConfirmUpdate = async () => {
    setMessage(null);
    setUpdateInProgress(true);
    try {
      await triggerUpdate();
      // The server is now installing + restarting. Dismiss the badge (the
      // user acted on it) and tell them the page will reconnect on its own.
      dismissUpdate();
      setConfirmOpen(false);
      setMessage({
        type: 'success',
        text: 'Updating… the server is installing the new version and will restart. This page will reload automatically.',
      });
      // Give the server time to install + restart, then reload to pick up the
      // new bundle. If it isn't back yet the reload simply retries the load.
      setTimeout(() => window.location.reload(), RELOAD_AFTER_UPDATE_MS);
    } catch (err) {
      setUpdateInProgress(false);
      setConfirmOpen(false);
      const text =
        err instanceof ApiRequestError
          ? (err.body?.message ?? err.body?.error ?? 'Update failed.')
          : 'Update failed. The server may be unreachable.';
      setMessage({ type: 'error', text });
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

      <SaveMessage message={message} />

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
              <div class="flex items-center gap-3 flex-wrap">
                <div class="font-mono text-3xl font-semibold text-text-primary">
                  v{data().version}
                </div>
                {/* Update-to button — only when a newer version exists AND this
                    deployment can update itself (packaged global install). */}
                <Show
                  when={update()?.updateAvailable && update()?.canSelfUpdate}
                >
                  <button
                    type="button"
                    onClick={() => setConfirmOpen(true)}
                    disabled={updateInProgress()}
                    class="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-primary hover:bg-primary-hover text-white text-sm disabled:opacity-50"
                  >
                    <ArrowUpCircle class="w-4 h-4" />
                    {updateInProgress()
                      ? 'Updating…'
                      : `Update to v${update()!.latestVersion}`}
                  </button>
                </Show>
              </div>
              <a
                href={`${RELEASES_URL}/tag/v${data().version}`}
                target="_blank"
                rel="noreferrer noopener"
                class="inline-block mt-2 text-sm text-primary hover:text-primary-hover hover:underline"
              >
                View release on GitHub →
              </a>

              {/* Let the user dismiss the sidebar update badge without updating
                  (issue #456: badge persists "until dismissed or updated"). */}
              <Show when={update()?.updateAvailable}>
                <button
                  type="button"
                  onClick={() => dismissUpdate()}
                  class="inline-block mt-2 ml-4 text-xs text-text-tertiary hover:text-text-secondary hover:underline"
                >
                  Dismiss update notice
                </button>
              </Show>

              {/* Update available but this install can't self-update (dev /
                  from-source) — guide the user to update manually. */}
              <Show
                when={update()?.updateAvailable && !update()?.canSelfUpdate}
              >
                <div class="mt-3 rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-3 text-sm text-text-secondary">
                  <div class="mb-1">
                    <span class="font-medium text-text-primary">
                      v{update()!.latestVersion}
                    </span>{' '}
                    is available. This install can't update itself — run:
                  </div>
                  <code class="block font-mono text-xs bg-gray-100 dark:bg-gray-900 rounded px-2 py-1 overflow-x-auto">
                    npm install -g @openaidy/app@latest && openaidy restart
                  </code>
                </div>
              </Show>
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
                onClick={() => {
                  refetch();
                  refetchUpdate();
                }}
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

            <ConfirmDialog
              isOpen={confirmOpen()}
              title="Update OpenAidy?"
              confirmLabel="Update & restart"
              cancelLabel="Cancel"
              isPending={updateInProgress()}
              onConfirm={handleConfirmUpdate}
              onCancel={() => setConfirmOpen(false)}
              body={
                <div class="space-y-3">
                  <p class="text-text-secondary">
                    Update from <span class="font-mono">v{data().version}</span>{' '}
                    to <span class="font-mono">v{update()?.latestVersion}</span>
                    ? The server will restart and this page will reconnect
                    automatically. Any in-progress runs will be interrupted.
                  </p>
                  <Show when={update()?.releaseNotes}>
                    <div>
                      <div class="text-xs uppercase tracking-wide text-text-tertiary mb-1">
                        Release notes
                      </div>
                      <pre class="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-gray-100 dark:bg-gray-900 p-2 text-xs text-text-secondary">
                        {update()!.releaseNotes}
                      </pre>
                    </div>
                  </Show>
                </div>
              }
            />
          </>
        )}
      </Show>
    </div>
  );
}
