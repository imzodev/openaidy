import { For, Show, createSignal, onMount } from 'solid-js';
import {
  Puzzle,
  AlertTriangle,
  Power,
  PowerOff,
  Trash2,
  RefreshCw,
} from 'lucide-solid';
import { Layout } from './Layout';
import {
  listAddons,
  enableAddon,
  disableAddon,
  uninstallAddon,
  type AddonRecord,
} from '../../lib/api';
import { resolveToken } from '../../lib/auth-token';

function StatusBadge(props: { status: AddonRecord['status'] }) {
  const styles: Record<AddonRecord['status'], string> = {
    enabled:
      'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
    disabled: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
    installed:
      'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
    error: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  };
  return (
    <span
      class={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[props.status]}`}
    >
      {props.status}
    </span>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function AddonsPage() {
  const [addons, setAddons] = createSignal<AddonRecord[]>([]);
  const [isLoading, setIsLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [actionId, setActionId] = createSignal<string | null>(null);
  const [actionError, setActionError] = createSignal<string | null>(null);

  const token = () => resolveToken() ?? '';

  const load = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await listAddons(token());
      setAddons(data.addons);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load addons');
    } finally {
      setIsLoading(false);
    }
  };

  onMount(() => {
    void load();
  });

  const handleEnable = async (id: string, permissions: string[]) => {
    setActionId(id);
    setActionError(null);
    try {
      const result = await enableAddon(token(), id, permissions);
      setAddons((prev) => prev.map((a) => (a.id === id ? result.addon : a)));
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Failed to enable addon',
      );
    } finally {
      setActionId(null);
    }
  };

  const handleDisable = async (id: string) => {
    setActionId(id);
    setActionError(null);
    try {
      const result = await disableAddon(token(), id);
      setAddons((prev) => prev.map((a) => (a.id === id ? result.addon : a)));
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Failed to disable addon',
      );
    } finally {
      setActionId(null);
    }
  };

  const handleUninstall = async (id: string) => {
    if (!confirm('Uninstall this addon? This cannot be undone.')) return;
    setActionId(id);
    setActionError(null);
    try {
      await uninstallAddon(token(), id);
      setAddons((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Failed to uninstall addon',
      );
    } finally {
      setActionId(null);
    }
  };

  return (
    <Layout
      title="Addons"
      description="Extend OpenAidy with addons"
      actions={
        <button
          onClick={() => void load()}
          disabled={isLoading()}
          class="flex items-center gap-2 px-3 py-2 text-sm text-text-secondary border border-border rounded-lg hover:text-text-primary hover:border-gray-400 transition-colors disabled:opacity-50"
        >
          <RefreshCw class={`w-4 h-4 ${isLoading() ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      }
    >
      {/* Action error */}
      <Show when={actionError()}>
        <div class="mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <div class="flex items-center gap-2 text-red-700 dark:text-red-400">
            <AlertTriangle class="w-4 h-4 flex-shrink-0" />
            <span class="text-sm">{actionError()}</span>
            <button
              onClick={() => setActionError(null)}
              class="ml-auto text-lg leading-none"
            >
              ×
            </button>
          </div>
        </div>
      </Show>

      {/* Loading */}
      <Show when={isLoading()}>
        <div class="flex items-center justify-center h-48">
          <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      </Show>

      {/* Load error */}
      <Show when={!isLoading() && error()}>
        <div class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <div class="flex items-center gap-2 text-red-700 dark:text-red-400">
            <AlertTriangle class="w-4 h-4 flex-shrink-0" />
            <span class="text-sm">{error()}</span>
          </div>
        </div>
      </Show>

      {/* Empty state */}
      <Show when={!isLoading() && !error() && addons().length === 0}>
        <div class="flex flex-col items-center justify-center h-64 text-center">
          <Puzzle class="w-12 h-12 text-text-tertiary mb-4" />
          <p class="text-text-secondary font-medium">No addons installed</p>
          <p class="text-sm text-text-tertiary mt-1 max-w-sm">
            Build and publish an addon, then install it via the API or use{' '}
            <code class="font-mono text-xs bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">
              openaidy addon create
            </code>{' '}
            to scaffold one.
          </p>
        </div>
      </Show>

      {/* Addon list */}
      <Show when={!isLoading() && addons().length > 0}>
        <div class="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
          <div class="divide-y divide-gray-100 dark:divide-gray-700">
            <For each={addons()}>
              {(addon) => (
                <div class="px-5 py-4 flex items-start justify-between gap-4">
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2 mb-1">
                      <Puzzle class="w-4 h-4 text-text-tertiary flex-shrink-0" />
                      <span class="font-medium text-sm text-text-primary">
                        {addon.name}
                      </span>
                      <code class="text-xs text-text-tertiary font-mono">
                        v{addon.version}
                      </code>
                      <StatusBadge status={addon.status} />
                    </div>
                    <Show when={addon.description}>
                      <p class="text-sm text-text-secondary mb-1.5">
                        {addon.description}
                      </p>
                    </Show>
                    <div class="flex items-center gap-3 text-xs text-text-tertiary">
                      <span>
                        ID: <code class="font-mono">{addon.id}</code>
                      </span>
                      <span>Installed {formatDate(addon.installedAt)}</span>
                    </div>
                  </div>

                  <div class="flex items-center gap-2 flex-shrink-0">
                    <Show
                      when={
                        addon.status === 'disabled' ||
                        addon.status === 'installed'
                      }
                    >
                      <button
                        onClick={() =>
                          void handleEnable(addon.id, addon.permissions ?? [])
                        }
                        disabled={actionId() === addon.id}
                        title="Enable addon"
                        class="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800 rounded-lg hover:bg-green-50 dark:hover:bg-green-900/20 disabled:opacity-50 transition-colors"
                      >
                        <Power class="w-3.5 h-3.5" />
                        Enable
                      </button>
                    </Show>
                    <Show when={addon.status === 'enabled'}>
                      <button
                        onClick={() => void handleDisable(addon.id)}
                        disabled={actionId() === addon.id}
                        title="Disable addon"
                        class="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-yellow-700 dark:text-yellow-400 border border-yellow-200 dark:border-yellow-800 rounded-lg hover:bg-yellow-50 dark:hover:bg-yellow-900/20 disabled:opacity-50 transition-colors"
                      >
                        <PowerOff class="w-3.5 h-3.5" />
                        Disable
                      </button>
                    </Show>
                    <button
                      onClick={() => void handleUninstall(addon.id)}
                      disabled={actionId() === addon.id}
                      title="Uninstall addon"
                      class="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 transition-colors"
                    >
                      <Trash2 class="w-3.5 h-3.5" />
                      Uninstall
                    </button>
                  </div>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>
    </Layout>
  );
}
