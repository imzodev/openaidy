import { For, Show, createSignal, onMount } from 'solid-js';
import {
  Copy,
  Plus,
  Trash2,
  Key,
  AlertTriangle,
  CheckCircle,
} from 'lucide-solid';
import { Layout } from './Layout';
import {
  listApiKeys,
  createApiKey,
  revokeApiKey,
  type ApiKeyRecord,
} from '../../lib/api';
import { resolveToken } from '../../lib/auth-token';

const AVAILABLE_SCOPES = [
  { value: '*', label: 'Admin (all scopes)' },
  { value: 'sessions.read', label: 'Sessions — Read' },
  { value: 'sessions.write', label: 'Sessions — Write' },
  { value: 'sessions.stream', label: 'Sessions — Stream' },
  { value: 'sessions.delete', label: 'Sessions — Delete' },
  { value: 'agents.read', label: 'Agents — Read' },
  { value: 'agents.invoke', label: 'Agents — Invoke' },
  { value: 'providers.read', label: 'Providers — Read' },
  { value: 'config.read', label: 'Config — Read' },
  { value: 'config.write', label: 'Config — Write' },
];

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function ScopeTag(props: { scope: string }) {
  return (
    <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
      {props.scope}
    </span>
  );
}

export function ApiKeysPage() {
  const [keys, setKeys] = createSignal<ApiKeyRecord[]>([]);
  const [isLoading, setIsLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);

  const [showCreateForm, setShowCreateForm] = createSignal(false);
  const [newKeyName, setNewKeyName] = createSignal('');
  const [newKeyScopes, setNewKeyScopes] = createSignal<string[]>([
    'sessions.read',
  ]);
  const [isCreating, setIsCreating] = createSignal(false);
  const [createError, setCreateError] = createSignal<string | null>(null);

  const [revealedKey, setRevealedKey] = createSignal<string | null>(null);
  const [copiedKey, setCopiedKey] = createSignal(false);

  const [revokingId, setRevokingId] = createSignal<string | null>(null);

  const token = () => resolveToken() ?? '';

  const loadKeys = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await listApiKeys(token());
      setKeys(data.keys);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load API keys');
    } finally {
      setIsLoading(false);
    }
  };

  onMount(() => {
    void loadKeys();
  });

  const toggleScope = (scope: string) => {
    setNewKeyScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );
  };

  const handleCreate = async () => {
    const name = newKeyName().trim();
    if (!name) {
      setCreateError('Name is required');
      return;
    }
    if (newKeyScopes().length === 0) {
      setCreateError('Select at least one scope');
      return;
    }

    setIsCreating(true);
    setCreateError(null);
    try {
      const result = await createApiKey(token(), {
        name,
        scopes: newKeyScopes(),
      });
      setRevealedKey(result.rawKey);
      setKeys((prev) => [result.key, ...prev]);
      setNewKeyName('');
      setNewKeyScopes(['sessions.read']);
      setShowCreateForm(false);
    } catch (err) {
      setCreateError(
        err instanceof Error ? err.message : 'Failed to create key',
      );
    } finally {
      setIsCreating(false);
    }
  };

  const handleRevoke = async (id: string) => {
    setRevokingId(id);
    try {
      const revoked = await revokeApiKey(token(), id);
      setKeys((prev) => prev.map((k) => (k.id === id ? revoked : k)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke key');
    } finally {
      setRevokingId(null);
    }
  };

  const copyRevealedKey = async () => {
    const key = revealedKey();
    if (!key) return;
    await navigator.clipboard.writeText(key);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  const activeKeys = () => keys().filter((k) => !k.revoked);
  const revokedKeys = () => keys().filter((k) => k.revoked);

  return (
    <Layout
      title="API Keys"
      description="Manage access tokens for users and external tools"
      actions={
        <button
          onClick={() => {
            setShowCreateForm(true);
            setCreateError(null);
          }}
          class="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-hover text-white rounded-lg text-sm font-medium transition-colors"
        >
          <Plus class="w-4 h-4" />
          New Key
        </button>
      }
    >
      {/* One-time key reveal banner */}
      <Show when={revealedKey()}>
        <div class="mb-6 bg-green-50 dark:bg-green-900/20 border border-green-300 dark:border-green-700 rounded-lg p-4">
          <div class="flex items-start gap-3">
            <CheckCircle class="w-5 h-5 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-green-800 dark:text-green-300 mb-2">
                API key created — copy it now, it won't be shown again
              </p>
              <div class="flex items-center gap-2">
                <code class="flex-1 text-xs font-mono bg-white dark:bg-gray-900 border border-green-200 dark:border-green-700 rounded px-3 py-2 text-green-900 dark:text-green-100 break-all">
                  {revealedKey()}
                </code>
                <button
                  onClick={() => void copyRevealedKey()}
                  class="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded text-xs font-medium transition-colors"
                >
                  <Copy class="w-3.5 h-3.5" />
                  {copiedKey() ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>
            <button
              onClick={() => setRevealedKey(null)}
              class="text-green-600 dark:text-green-400 hover:text-green-800 dark:hover:text-green-200 flex-shrink-0 text-lg leading-none"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        </div>
      </Show>

      {/* Create form */}
      <Show when={showCreateForm()}>
        <div class="mb-6 bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700 p-5">
          <h2 class="text-base font-semibold text-text-primary mb-4">
            Create New API Key
          </h2>

          <div class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-text-primary mb-1">
                Name
              </label>
              <input
                type="text"
                value={newKeyName()}
                onInput={(e) => setNewKeyName(e.currentTarget.value)}
                placeholder="e.g. CI Pipeline, Alice's CLI"
                class="w-full px-3 py-2 rounded-lg border border-border bg-gray-50 dark:bg-gray-900 text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-colors"
              />
            </div>

            <div>
              <label class="block text-sm font-medium text-text-primary mb-2">
                Scopes
              </label>
              <div class="flex flex-wrap gap-2">
                <For each={AVAILABLE_SCOPES}>
                  {(scope) => (
                    <button
                      type="button"
                      onClick={() => toggleScope(scope.value)}
                      class={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                        newKeyScopes().includes(scope.value)
                          ? 'bg-primary text-white border-primary'
                          : 'bg-white dark:bg-gray-900 text-text-secondary border-border hover:border-primary hover:text-primary'
                      }`}
                    >
                      {scope.label}
                    </button>
                  )}
                </For>
              </div>
            </div>

            <Show when={createError()}>
              <p class="text-sm text-red-500 dark:text-red-400">
                {createError()}
              </p>
            </Show>

            <div class="flex items-center gap-2 pt-1">
              <button
                onClick={() => void handleCreate()}
                disabled={isCreating()}
                class="px-4 py-2 bg-primary hover:bg-primary-hover disabled:bg-primary-disabled text-white rounded-lg text-sm font-medium transition-colors"
              >
                {isCreating() ? 'Creating…' : 'Create Key'}
              </button>
              <button
                onClick={() => setShowCreateForm(false)}
                class="px-4 py-2 text-text-secondary hover:text-text-primary text-sm transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </Show>

      {/* Loading */}
      <Show when={isLoading()}>
        <div class="flex items-center justify-center h-48">
          <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      </Show>

      {/* Error */}
      <Show when={!isLoading() && error()}>
        <div class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-4">
          <div class="flex items-center gap-2 text-red-700 dark:text-red-400">
            <AlertTriangle class="w-4 h-4 flex-shrink-0" />
            <span class="text-sm">{error()}</span>
          </div>
        </div>
      </Show>

      {/* Empty state */}
      <Show when={!isLoading() && !error() && keys().length === 0}>
        <div class="flex flex-col items-center justify-center h-48 text-center">
          <Key class="w-10 h-10 text-text-tertiary mb-3" />
          <p class="text-text-secondary font-medium">No API keys yet</p>
          <p class="text-sm text-text-tertiary mt-1">
            Create a key to allow users or tools to connect
          </p>
        </div>
      </Show>

      {/* Active keys */}
      <Show when={!isLoading() && activeKeys().length > 0}>
        <div class="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden mb-6">
          <div class="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
            <h2 class="text-sm font-semibold text-text-primary">Active Keys</h2>
          </div>
          <div class="divide-y divide-gray-100 dark:divide-gray-700">
            <For each={activeKeys()}>
              {(key) => (
                <div class="px-4 py-3 flex items-start justify-between gap-4">
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2 mb-1">
                      <span class="font-medium text-sm text-text-primary">
                        {key.name}
                      </span>
                      <code class="text-xs text-text-tertiary font-mono">
                        {key.keyPrefix}…
                      </code>
                    </div>
                    <div class="flex flex-wrap gap-1 mb-1.5">
                      <For each={key.scopes}>
                        {(scope) => <ScopeTag scope={scope} />}
                      </For>
                    </div>
                    <div class="flex items-center gap-3 text-xs text-text-tertiary">
                      <span>Created {formatDate(key.createdAt)}</span>
                      <Show when={key.lastUsedAt}>
                        <span>Last used {formatDate(key.lastUsedAt)}</span>
                      </Show>
                      <Show when={key.expiresAt}>
                        <span>Expires {formatDate(key.expiresAt)}</span>
                      </Show>
                    </div>
                  </div>
                  <button
                    onClick={() => void handleRevoke(key.id)}
                    disabled={revokingId() === key.id}
                    title="Revoke key"
                    class="flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 transition-colors"
                  >
                    <Trash2 class="w-3.5 h-3.5" />
                    {revokingId() === key.id ? 'Revoking…' : 'Revoke'}
                  </button>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>

      {/* Revoked keys */}
      <Show when={!isLoading() && revokedKeys().length > 0}>
        <div class="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden opacity-60">
          <div class="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
            <h2 class="text-sm font-semibold text-text-tertiary">
              Revoked Keys
            </h2>
          </div>
          <div class="divide-y divide-gray-100 dark:divide-gray-700">
            <For each={revokedKeys()}>
              {(key) => (
                <div class="px-4 py-3 flex items-start gap-4">
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2 mb-1">
                      <span class="font-medium text-sm text-text-tertiary line-through">
                        {key.name}
                      </span>
                      <code class="text-xs text-text-tertiary font-mono">
                        {key.keyPrefix}…
                      </code>
                      <span class="px-1.5 py-0.5 rounded text-xs bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                        revoked
                      </span>
                    </div>
                    <div class="text-xs text-text-tertiary">
                      Created {formatDate(key.createdAt)}
                    </div>
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
