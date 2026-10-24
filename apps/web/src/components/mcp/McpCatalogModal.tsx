/**
 * "Browse integrations" gallery for the MCP Servers page.
 *
 * Lists the server's curated catalog (GET /mcp/catalog). One-click entries
 * connect straight away; Google entries first ask for the client ID/secret
 * of an OAuth app the user creates in Google Cloud. The actual install +
 * sign-in is done by the page via `onConnect`, which must be called inside
 * the click handler so the sign-in popup isn't blocked.
 */

import { For, Show, createMemo, createSignal, onMount } from 'solid-js';
import {
  listMcpCatalog,
  mcpOAuthOrigin,
  type McpCatalogEntry,
} from '../../lib/api';

const CATEGORY_LABELS: Record<McpCatalogEntry['category'], string> = {
  productivity: 'Productivity',
  payments: 'Payments',
  marketing: 'Marketing',
  google: 'Google Workspace',
  developer: 'Developer',
};

export type McpCatalogConnectRequest = {
  entry: McpCatalogEntry;
  clientId?: string;
  clientSecret?: string;
  /** Connect with a pasted API token instead of signing in. */
  apiKey?: string;
};

export function McpCatalogModal(props: {
  onConnect: (request: McpCatalogConnectRequest) => Promise<void>;
  onClose: () => void;
}) {
  const [entries, setEntries] = createSignal<McpCatalogEntry[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [query, setQuery] = createSignal('');
  const [category, setCategory] = createSignal<
    McpCatalogEntry['category'] | 'all'
  >('all');
  // Own-app entry whose client ID form is open.
  const [expandedId, setExpandedId] = createSignal<string | null>(null);
  const [clientId, setClientId] = createSignal('');
  const [clientSecret, setClientSecret] = createSignal('');
  // Entry whose "use an API token instead" form is open.
  const [apiKeyFormId, setApiKeyFormId] = createSignal<string | null>(null);
  const [apiKey, setApiKey] = createSignal('');
  const [connectingId, setConnectingId] = createSignal<string | null>(null);

  onMount(async () => {
    try {
      setEntries((await listMcpCatalog()).entries);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to load integrations',
      );
    } finally {
      setLoading(false);
    }
  });

  const categories = createMemo(() => [
    ...new Set(entries().map((e) => e.category)),
  ]);

  const visible = createMemo(() => {
    const q = query().trim().toLowerCase();
    return entries().filter(
      (e) =>
        (category() === 'all' || e.category === category()) &&
        (!q ||
          e.name.toLowerCase().includes(q) ||
          e.description.toLowerCase().includes(q)),
    );
  });

  const connect = (request: McpCatalogConnectRequest) => {
    setConnectingId(request.entry.id);
    setError(null);
    props
      .onConnect(request)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Failed to connect'),
      )
      .finally(() => setConnectingId(null));
  };

  const openOwnAppForm = (entry: McpCatalogEntry) => {
    setExpandedId(expandedId() === entry.id ? null : entry.id);
    setClientId('');
    setClientSecret('');
  };

  const chipClass = (active: boolean) =>
    `px-3 py-1 text-xs rounded-full border transition-colors ${
      active
        ? 'bg-primary text-white border-primary'
        : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
    }`;

  return (
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div class="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-3xl mx-4 max-h-[90vh] flex flex-col">
        <div class="flex items-center justify-between p-4 border-b dark:border-gray-700">
          <div>
            <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Browse integrations
            </h2>
            <p class="text-xs text-text-tertiary">
              Connect an app by signing in with your account.
            </p>
          </div>
          <button
            onClick={props.onClose}
            class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-2xl leading-none"
          >
            ×
          </button>
        </div>

        <div class="p-4 space-y-3 border-b dark:border-gray-700">
          <input
            type="search"
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
            placeholder="Search integrations…"
            class="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <div class="flex flex-wrap gap-2">
            <button
              class={chipClass(category() === 'all')}
              onClick={() => setCategory('all')}
            >
              All
            </button>
            <For each={categories()}>
              {(c) => (
                <button
                  class={chipClass(category() === c)}
                  onClick={() => setCategory(c)}
                >
                  {CATEGORY_LABELS[c]}
                </button>
              )}
            </For>
          </div>
        </div>

        <div class="flex-1 overflow-y-auto p-4">
          <Show when={error()}>
            <div class="mb-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-400">
              {error()}
            </div>
          </Show>
          <Show when={loading()}>
            <p class="text-sm text-text-tertiary">Loading integrations…</p>
          </Show>
          <Show when={!loading() && visible().length === 0 && !error()}>
            <p class="text-sm text-text-tertiary">No integrations match.</p>
          </Show>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <For each={visible()}>
              {(entry) => (
                <div class="p-3 rounded-lg border border-gray-200 dark:border-gray-700 flex flex-col gap-2">
                  <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0">
                      <div class="text-sm font-medium text-gray-900 dark:text-gray-100">
                        {entry.name}
                      </div>
                      <p class="text-xs text-text-tertiary mt-0.5">
                        {entry.description}
                      </p>
                    </div>
                    <Show
                      when={!entry.installed}
                      fallback={
                        <span class="flex-shrink-0 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                          Added
                        </span>
                      }
                    >
                      <button
                        onClick={() =>
                          entry.setup === 'oauth'
                            ? connect({ entry })
                            : openOwnAppForm(entry)
                        }
                        disabled={connectingId() !== null}
                        class="flex-shrink-0 px-3 py-1.5 text-xs text-white bg-primary rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
                      >
                        {connectingId() === entry.id
                          ? 'Connecting…'
                          : 'Connect'}
                      </button>
                    </Show>
                  </div>

                  <Show
                    when={entry.setup === 'oauth-own-app' && !entry.installed}
                  >
                    <p class="text-xs text-amber-700 dark:text-amber-400">
                      Needs an OAuth app from Google Cloud Console.
                    </p>
                  </Show>

                  <Show when={expandedId() === entry.id}>
                    <div class="space-y-2 pt-1">
                      <p class="text-xs text-text-tertiary">
                        Create an OAuth client (type "Web application") with
                        this redirect URL, then paste its credentials.{' '}
                        <a
                          href={entry.docsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          class="text-primary underline hover:no-underline"
                        >
                          Setup guide →
                        </a>
                      </p>
                      <code class="block text-xs font-mono break-all p-2 bg-gray-100 dark:bg-gray-900 rounded">
                        {mcpOAuthOrigin()}/api/mcp/oauth/callback
                      </code>
                      <input
                        type="text"
                        value={clientId()}
                        onInput={(e) => setClientId(e.currentTarget.value)}
                        placeholder="Client ID"
                        class="w-full px-3 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-xs text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary font-mono"
                      />
                      <input
                        type="password"
                        value={clientSecret()}
                        onInput={(e) => setClientSecret(e.currentTarget.value)}
                        placeholder="Client secret"
                        class="w-full px-3 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-xs text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary font-mono"
                      />
                      <button
                        onClick={() =>
                          connect({
                            entry,
                            clientId: clientId().trim(),
                            clientSecret: clientSecret().trim(),
                          })
                        }
                        disabled={!clientId().trim() || connectingId() !== null}
                        class="w-full px-3 py-1.5 text-xs text-white bg-primary rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
                      >
                        {connectingId() === entry.id
                          ? 'Connecting…'
                          : `Save and sign in to ${entry.name}`}
                      </button>
                    </div>
                  </Show>

                  <Show when={!entry.installed && entry.apiKey}>
                    {(option) => (
                      <Show
                        when={apiKeyFormId() === entry.id}
                        fallback={
                          <button
                            onClick={() => {
                              setApiKeyFormId(entry.id);
                              setApiKey('');
                            }}
                            class="self-start text-xs text-primary hover:underline"
                          >
                            Or use an {option().label} instead
                          </button>
                        }
                      >
                        <div class="space-y-2 pt-1">
                          <p class="text-xs text-text-tertiary">
                            Paste a {entry.name} {option().label} — stored
                            encrypted.{' '}
                            <a
                              href={option().setupUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              class="text-primary underline hover:no-underline"
                            >
                              Create one →
                            </a>
                          </p>
                          <input
                            type="password"
                            value={apiKey()}
                            onInput={(e) => setApiKey(e.currentTarget.value)}
                            placeholder={option().label}
                            class="w-full px-3 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-xs text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary font-mono"
                          />
                          <div class="flex gap-2">
                            <button
                              onClick={() =>
                                connect({ entry, apiKey: apiKey().trim() })
                              }
                              disabled={
                                !apiKey().trim() || connectingId() !== null
                              }
                              class="flex-1 px-3 py-1.5 text-xs text-white bg-primary rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
                            >
                              {connectingId() === entry.id
                                ? 'Connecting…'
                                : `Connect with ${option().label}`}
                            </button>
                            <button
                              onClick={() => setApiKeyFormId(null)}
                              class="px-3 py-1.5 text-xs text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      </Show>
                    )}
                  </Show>

                  <Show when={entry.setup === 'oauth'}>
                    <a
                      href={entry.docsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="text-xs text-text-tertiary hover:text-primary"
                    >
                      Docs →
                    </a>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </div>
      </div>
    </div>
  );
}
