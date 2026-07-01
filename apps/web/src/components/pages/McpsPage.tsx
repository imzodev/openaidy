import { Layout } from './Layout';
import { For, Show, createSignal, onMount, createMemo } from 'solid-js';
import {
  listMcpServers,
  createMcpServer,
  updateMcpServer,
  deleteMcpServer,
  connectMcpServer,
  disconnectMcpServer,
  importMcpServers,
  type McpServerRecord,
} from '../../lib/api';
import type {
  CreateMcpServerRequest,
  UpdateMcpServerRequest,
  ImportMcpServersRequest,
} from '../../lib/api';

/** A server is awaiting configuration when it references secrets not yet set. */
function isAwaitingConfig(server: McpServerRecord): boolean {
  return (server.missingSecrets?.length ?? 0) > 0;
}

function StatusBadge(props: { connected: boolean; awaitingConfig?: boolean }) {
  const label = () =>
    props.connected
      ? 'Connected'
      : props.awaitingConfig
        ? 'Needs API key'
        : 'Disconnected';
  const classes = () =>
    props.connected
      ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
      : props.awaitingConfig
        ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400'
        : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400';
  return (
    <span
      class={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${classes()}`}
    >
      {label()}
    </span>
  );
}

function ServerFormModal(props: {
  mode: 'create' | 'edit';
  server?: McpServerRecord;
  onSave: (
    data: CreateMcpServerRequest | UpdateMcpServerRequest,
  ) => Promise<void>;
  onClose: () => void;
}) {
  const [transport, setTransport] = createSignal<'stdio' | 'http'>(
    props.server?.transport ?? 'stdio',
  );
  const [formData, setFormData] = createSignal({
    id: props.server?.id ?? '',
    name: props.server?.name ?? '',
    command: props.server?.command ?? '',
    args: props.server?.args?.join(' ') ?? '',
    url: props.server?.url ?? '',
    env: props.server?.env
      ? Object.entries(props.server.env)
          .map(([k, v]) => `${k}=${v}`)
          .join('\n')
      : '',
  });
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const isEdit = () => props.mode === 'edit';
  const isStdio = () => transport() === 'stdio';

  const buildRequest = (): CreateMcpServerRequest | UpdateMcpServerRequest => {
    const base = {
      name: formData().name || undefined,
      transport: transport(),
    };

    if (isStdio()) {
      return {
        ...base,
        command: formData().command || undefined,
        args: formData().args ? formData().args.trim().split(/\s+/) : undefined,
        env: formData().env
          ? Object.fromEntries(
              formData()
                .env.split('\n')
                .filter((l) => l.includes('='))
                .map((l) => {
                  const idx = l.indexOf('=');
                  return [l.slice(0, idx), l.slice(idx + 1)];
                }),
            )
          : undefined,
      };
    } else {
      return {
        ...base,
        url: formData().url || undefined,
      };
    }
  };

  const handleSave = async () => {
    if (!isEdit() && !formData().id.trim()) {
      setError('Server ID is required');
      return;
    }
    if (isStdio() && !formData().command.trim()) {
      setError('Command is required for stdio transport');
      return;
    }
    if (!isStdio() && !formData().url.trim()) {
      setError('URL is required for HTTP transport');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await props.onSave(buildRequest());
      props.onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save server');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div class="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg mx-4">
        <div class="flex items-center justify-between p-4 border-b dark:border-gray-700">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {isEdit() ? 'Edit MCP Server' : 'Add MCP Server'}
          </h2>
          <button
            onClick={props.onClose}
            class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-2xl leading-none"
          >
            ×
          </button>
        </div>

        <div class="p-4 space-y-4">
          <Show when={error()}>
            <div class="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-400">
              {error()}
            </div>
          </Show>

          {/* Transport selector */}
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Transport
            </label>
            <div class="flex gap-3">
              <label class="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="transport"
                  value="stdio"
                  checked={transport() === 'stdio'}
                  onChange={() => setTransport('stdio')}
                  class="accent-primary"
                />
                <span class="text-sm text-gray-800 dark:text-gray-200">
                  stdio (local process)
                </span>
              </label>
              <label class="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="transport"
                  value="http"
                  checked={transport() === 'http'}
                  onChange={() => setTransport('http')}
                  class="accent-primary"
                />
                <span class="text-sm text-gray-800 dark:text-gray-200">
                  HTTP (remote server)
                </span>
              </label>
            </div>
          </div>

          {/* ID field — only on create */}
          <Show when={!isEdit()}>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Server ID <span class="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData().id}
                onInput={(e) =>
                  setFormData((p) => ({ ...p, id: e.currentTarget.value }))
                }
                placeholder="e.g. filesystem-server"
                class="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <p class="mt-1 text-xs text-text-tertiary">
                Unique identifier. Must match the server's internal name.
              </p>
            </div>
          </Show>

          {/* Name field */}
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Display Name
            </label>
            <input
              type="text"
              value={formData().name}
              onInput={(e) =>
                setFormData((p) => ({ ...p, name: e.currentTarget.value }))
              }
              placeholder="e.g. Filesystem Tools"
              class="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {/* stdio fields */}
          <Show when={isStdio()}>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Command <span class="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData().command}
                onInput={(e) =>
                  setFormData((p) => ({ ...p, command: e.currentTarget.value }))
                }
                placeholder="e.g. npx"
                class="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary font-mono"
              />
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Arguments
              </label>
              <input
                type="text"
                value={formData().args}
                onInput={(e) =>
                  setFormData((p) => ({ ...p, args: e.currentTarget.value }))
                }
                placeholder="e.g. @modelcontextprotocol/server-filesystem /path"
                class="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary font-mono"
              />
              <p class="mt-1 text-xs text-text-tertiary">
                Space-separated arguments
              </p>
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Environment Variables
              </label>
              <textarea
                value={formData().env}
                onInput={(e) =>
                  setFormData((p) => ({ ...p, env: e.currentTarget.value }))
                }
                placeholder="KEY=value&#10;SECRET=mysecret"
                rows={3}
                class="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary font-mono"
              />
              <p class="mt-1 text-xs text-text-tertiary">
                One KEY=value per line. Use $&#123;VAR_NAME&#125; for env var
                placeholders.
              </p>
            </div>
          </Show>

          {/* HTTP fields */}
          <Show when={!isStdio()}>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                URL <span class="text-red-500">*</span>
              </label>
              <input
                type="url"
                value={formData().url}
                onInput={(e) =>
                  setFormData((p) => ({ ...p, url: e.currentTarget.value }))
                }
                placeholder="https://my-mcp-server.com/mcp"
                class="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </Show>
        </div>

        <div class="flex items-center justify-end gap-3 p-4 border-t dark:border-gray-700">
          <button
            onClick={props.onClose}
            class="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={saving()}
            class="px-4 py-2 text-sm text-white bg-primary rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving() ? 'Saving…' : isEdit() ? 'Save Changes' : 'Add Server'}
          </button>
        </div>
      </div>
    </div>
  );
}

const IMPORT_PLACEHOLDER = `{
  "mcpServers": {
    "github": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp/",
      "headers": {
        "Authorization": "Bearer \${GITHUB_PERSONAL_ACCESS_TOKEN}"
      }
    }
  }
}`;

function ImportModal(props: {
  onImport: (body: ImportMcpServersRequest) => Promise<void>;
  onClose: () => void;
}) {
  const [text, setText] = createSignal('');
  const [importing, setImporting] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const handleImport = async () => {
    setError(null);

    let parsed: unknown;
    try {
      parsed = JSON.parse(text());
    } catch {
      setError('Invalid JSON — paste a valid MCP server config.');
      return;
    }

    // Accept either the standard `{ "mcpServers": { … } }` wrapper or a bare
    // `{ "<id>": { … } }` map.
    const map =
      parsed && typeof parsed === 'object' && 'mcpServers' in parsed
        ? (parsed as { mcpServers: unknown }).mcpServers
        : parsed;

    if (!map || typeof map !== 'object' || Array.isArray(map)) {
      setError('Expected an object mapping server ids to their config.');
      return;
    }

    setImporting(true);
    try {
      await props.onImport({
        mcpServers: map as ImportMcpServersRequest['mcpServers'],
      });
      props.onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import servers');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div class="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg mx-4">
        <div class="flex items-center justify-between p-4 border-b dark:border-gray-700">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Import MCP Servers
          </h2>
          <button
            onClick={props.onClose}
            class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-2xl leading-none"
          >
            ×
          </button>
        </div>

        <div class="p-4 space-y-3">
          <Show when={error()}>
            <div class="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-400">
              {error()}
            </div>
          </Show>

          <p class="text-sm text-text-secondary">
            Paste a standard MCP config (Claude Desktop / VS Code / Cursor).
            Secrets stay safe: reference them with{' '}
            <code class="text-xs px-1 py-0.5 bg-gray-100 dark:bg-gray-700 rounded">
              ${'{ENV_VAR}'}
            </code>{' '}
            placeholders resolved from the server environment.
          </p>

          <textarea
            value={text()}
            onInput={(e) => setText(e.currentTarget.value)}
            placeholder={IMPORT_PLACEHOLDER}
            rows={12}
            class="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary font-mono"
          />
        </div>

        <div class="flex items-center justify-end gap-3 p-4 border-t dark:border-gray-700">
          <button
            onClick={props.onClose}
            class="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => void handleImport()}
            disabled={importing() || !text().trim()}
            class="px-4 py-2 text-sm text-white bg-primary rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {importing() ? 'Importing…' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmDeleteModal(props: {
  server: McpServerRecord;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [deleting, setDeleting] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const handleDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      await props.onConfirm();
      props.onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete server');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div class="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md mx-4">
        <div class="p-4 border-b dark:border-gray-700">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Delete MCP Server
          </h2>
        </div>
        <div class="p-4">
          <Show when={error()}>
            <div class="mb-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-400">
              {error()}
            </div>
          </Show>
          <p class="text-sm text-gray-600 dark:text-gray-400">
            Remove{' '}
            <strong class="text-gray-900 dark:text-gray-100">
              {props.server.name ?? props.server.id}
            </strong>{' '}
            from the config? This will disconnect the server and remove it from
            all agents.
          </p>
        </div>
        <div class="flex items-center justify-end gap-3 p-4 border-t dark:border-gray-700">
          <button
            onClick={props.onClose}
            class="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => void handleDelete()}
            disabled={deleting()}
            class="px-4 py-2 text-sm text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {deleting() ? 'Deleting…' : 'Delete Server'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function McpsPage() {
  const [servers, setServers] = createSignal<McpServerRecord[]>([]);
  const [isLoading, setIsLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [actionId, setActionId] = createSignal<string | null>(null);
  const [actionError, setActionError] = createSignal<string | null>(null);
  const [showForm, setShowForm] = createSignal<{
    mode: 'create' | 'edit';
    server?: McpServerRecord;
  } | null>(null);
  const [showDelete, setShowDelete] = createSignal<McpServerRecord | null>(
    null,
  );
  const [showImport, setShowImport] = createSignal(false);

  const selected = createMemo(() =>
    servers().find((s) => s.id === selectedId()),
  );

  const loadServers = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await listMcpServers();
      setServers(data.servers);
      if (data.servers.length > 0 && !selectedId()) {
        setSelectedId(data.servers[0]?.id ?? null);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to load MCP servers',
      );
    } finally {
      setIsLoading(false);
    }
  };

  onMount(() => {
    void loadServers();
  });

  const handleConnect = async (server: McpServerRecord) => {
    setActionId(server.id);
    setActionError(null);
    try {
      const result = await connectMcpServer(server.id);
      setServers((prev) =>
        prev.map((s) =>
          s.id === server.id ? { ...s, connected: result.connected } : s,
        ),
      );
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Failed to connect server',
      );
    } finally {
      setActionId(null);
    }
  };

  const handleDisconnect = async (server: McpServerRecord) => {
    setActionId(server.id);
    setActionError(null);
    try {
      const result = await disconnectMcpServer(server.id);
      setServers((prev) =>
        prev.map((s) =>
          s.id === server.id ? { ...s, connected: !result.disconnected } : s,
        ),
      );
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Failed to disconnect server',
      );
    } finally {
      setActionId(null);
    }
  };

  const handleSave = async (
    data: CreateMcpServerRequest | UpdateMcpServerRequest,
  ) => {
    if (showForm()?.mode === 'edit' && showForm()?.server) {
      const result = await updateMcpServer(
        showForm()!.server!.id,
        data as UpdateMcpServerRequest,
      );
      setServers((prev) =>
        prev.map((s) => (s.id === showForm()!.server!.id ? result.server : s)),
      );
    } else {
      const result = await createMcpServer(data as CreateMcpServerRequest);
      setServers((prev) => [...prev, result.server]);
      setSelectedId(result.server.id);
    }
  };

  const handleDelete = async () => {
    if (!showDelete()) return;
    await deleteMcpServer(showDelete()!.id);
    setServers((prev) => prev.filter((s) => s.id !== showDelete()!.id));
    if (selectedId() === showDelete()?.id) {
      setSelectedId(servers()[0]?.id ?? null);
    }
  };

  const handleImport = async (body: ImportMcpServersRequest) => {
    await importMcpServers(body);
    // Refetch so the list reflects the newly imported + connected servers.
    await loadServers();
  };

  const connectedCount = () => servers().filter((s) => s.connected).length;
  const totalTools = () =>
    servers()
      .filter((s) => s.connected)
      .reduce((sum, s) => sum + s.toolCount, 0);

  return (
    <Layout
      title="MCP Servers"
      description="Manage Model Context Protocol server connections"
      actions={
        <div class="flex items-center gap-2">
          <button
            onClick={() => setShowImport(true)}
            class="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            Import
          </button>
          <button
            onClick={() => setShowForm({ mode: 'create' })}
            class="flex items-center gap-2 px-3 py-2 text-sm text-white bg-primary rounded-lg hover:bg-primary/90 transition-colors"
          >
            + Add Server
          </button>
        </div>
      }
    >
      {/* Action-level error banner */}
      <Show when={actionError()}>
        <div class="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-center justify-between gap-3">
          <span class="text-sm text-red-700 dark:text-red-400">
            {actionError()}
          </span>
          <button
            onClick={() => setActionError(null)}
            class="text-red-500 hover:text-red-700 text-xl leading-none"
          >
            ×
          </button>
        </div>
      </Show>

      {/* Loading */}
      <Show when={isLoading()}>
        <div class="flex items-center justify-center h-64">
          <div class="text-center">
            <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4" />
            <p class="text-text-tertiary">Loading MCP servers…</p>
          </div>
        </div>
      </Show>

      {/* Load error */}
      <Show when={!isLoading() && error()}>
        <div class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 flex items-center justify-between gap-3">
          <span class="text-sm text-red-700 dark:text-red-400">{error()}</span>
          <button
            onClick={() => void loadServers()}
            class="text-sm text-red-600 dark:text-red-400 underline hover:no-underline"
          >
            Try again
          </button>
        </div>
      </Show>

      {/* Empty state */}
      <Show when={!isLoading() && !error() && servers().length === 0}>
        <div class="flex flex-col items-center justify-center h-64 text-center">
          <div class="text-4xl mb-4">🔌</div>
          <p class="text-text-secondary font-medium mb-1">
            No MCP servers configured
          </p>
          <p class="text-sm text-text-tertiary mb-4">
            Add servers to enable tools from external services
          </p>
          <button
            onClick={() => setShowForm({ mode: 'create' })}
            class="px-4 py-2 text-sm text-white bg-primary rounded-lg hover:bg-primary/90 transition-colors"
          >
            Add your first server
          </button>
        </div>
      </Show>

      {/* Server list + detail */}
      <Show when={!isLoading() && servers().length > 0}>
        {/* Stats bar */}
        <div class="grid grid-cols-3 gap-4 mb-6">
          <div class="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
            <div class="text-2xl font-bold text-primary">
              {servers().length}
            </div>
            <div class="text-sm text-text-secondary">Configured</div>
          </div>
          <div class="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
            <div class="text-2xl font-bold text-green-600 dark:text-green-400">
              {connectedCount()}
            </div>
            <div class="text-sm text-text-secondary">Connected</div>
          </div>
          <div class="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
            <div class="text-2xl font-bold text-blue-600 dark:text-blue-400">
              {totalTools()}
            </div>
            <div class="text-sm text-text-secondary">Tools Available</div>
          </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Server list */}
          <div class="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden flex flex-col">
            <div class="p-4 border-b dark:border-gray-700 flex items-center justify-between">
              <h2 class="text-base font-semibold">Servers</h2>
              <button
                onClick={() => void loadServers()}
                class="text-sm text-primary hover:text-primary/80 flex items-center gap-1"
                title="Refresh"
              >
                <svg
                  class={`w-4 h-4 ${isLoading() ? 'animate-spin' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
              </button>
            </div>

            <div class="flex-1 overflow-y-auto divide-y dark:divide-gray-700">
              <For each={servers()}>
                {(server) => (
                  <button
                    class={`w-full p-4 text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${
                      selectedId() === server.id
                        ? 'bg-primary-50 dark:bg-primary-900/20 border-l-4 border-primary'
                        : 'border-l-4 border-transparent'
                    }`}
                    onClick={() => setSelectedId(server.id)}
                  >
                    <div class="flex items-center justify-between mb-1">
                      <span class="font-medium text-sm text-gray-900 dark:text-gray-100">
                        {server.name ?? server.id}
                      </span>
                      <StatusBadge
                        connected={server.connected}
                        awaitingConfig={isAwaitingConfig(server)}
                      />
                    </div>
                    <div class="text-xs text-text-tertiary">
                      {server.transport} ·{' '}
                      {server.connected
                        ? `${server.toolCount} tool${server.toolCount !== 1 ? 's' : ''}`
                        : isAwaitingConfig(server)
                          ? 'needs API key'
                          : 'disconnected'}
                    </div>
                  </button>
                )}
              </For>
            </div>
          </div>

          {/* Detail panel */}
          <div class="lg:col-span-2 bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden flex flex-col">
            <Show when={!selected()}>
              <div class="flex-1 flex items-center justify-center">
                <p class="text-text-tertiary">
                  Select a server to view details
                </p>
              </div>
            </Show>

            <Show when={selected()}>
              {/* Detail header */}
              <div class="p-4 border-b dark:border-gray-700 flex items-start justify-between gap-3">
                <div>
                  <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    {selected()!.name ?? selected()!.id}
                  </h3>
                  <div class="mt-1 flex items-center gap-2 flex-wrap">
                    <code class="text-xs px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-gray-600 dark:text-gray-300">
                      {selected()!.id}
                    </code>
                    <span class="text-xs px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded">
                      {selected()!.transport}
                    </span>
                  </div>
                </div>

                <div class="flex items-center gap-2 flex-shrink-0">
                  <Show when={!selected()!.connected}>
                    <button
                      onClick={() => void handleConnect(selected()!)}
                      disabled={actionId() === selected()!.id}
                      class="flex items-center gap-1.5 px-3 py-1.5 text-xs text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800 rounded-lg hover:bg-green-50 dark:hover:bg-green-900/20 disabled:opacity-50 transition-colors"
                    >
                      <svg
                        class="w-3.5 h-3.5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M13 10V3L4 14h7v7l9-11h-7z"
                        />
                      </svg>
                      Connect
                    </button>
                  </Show>
                  <Show when={selected()!.connected}>
                    <button
                      onClick={() => void handleDisconnect(selected()!)}
                      disabled={actionId() === selected()!.id}
                      class="flex items-center gap-1.5 px-3 py-1.5 text-xs text-yellow-700 dark:text-yellow-400 border border-yellow-200 dark:border-yellow-800 rounded-lg hover:bg-yellow-50 dark:hover:bg-yellow-900/20 disabled:opacity-50 transition-colors"
                    >
                      <svg
                        class="w-3.5 h-3.5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M18.364 18.364A5 5 0 005.636 5.636m12.728 12.728A5 5 0 015.636 5.636m12.728 12.728L5.636 5.636"
                        />
                      </svg>
                      Disconnect
                    </button>
                  </Show>

                  <button
                    onClick={() =>
                      setShowForm({ mode: 'edit', server: selected()! })
                    }
                    class="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
                  >
                    <svg
                      class="w-3.5 h-3.5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                      />
                    </svg>
                    Edit
                  </button>

                  <button
                    onClick={() => setShowDelete(selected()!)}
                    class="flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 transition-colors"
                  >
                    <svg
                      class="w-3.5 h-3.5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                    Delete
                  </button>
                </div>
              </div>

              {/* Config details */}
              <div class="flex-1 overflow-y-auto p-4 space-y-3 text-sm">
                <Show when={isAwaitingConfig(selected()!)}>
                  <div class="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg text-amber-800 dark:text-amber-300">
                    <p class="text-sm font-medium">Awaiting configuration</p>
                    <p class="mt-1 text-xs">
                      This server needs a value for{' '}
                      <For each={selected()!.missingSecrets}>
                        {(name, i) => (
                          <>
                            <code class="px-1 py-0.5 bg-amber-100 dark:bg-amber-900/40 rounded">
                              {name}
                            </code>
                            {i() < selected()!.missingSecrets.length - 1
                              ? ', '
                              : ''}
                          </>
                        )}
                      </For>{' '}
                      before it can connect. Click <strong>Edit</strong> and
                      paste your API key in place of the{' '}
                      <code class="px-1 py-0.5 bg-amber-100 dark:bg-amber-900/40 rounded">
                        ${'{…}'}
                      </code>{' '}
                      placeholder, or set it in the server environment.
                    </p>
                  </div>
                </Show>
                <Show when={selected()!.transport === 'stdio'}>
                  <div>
                    <span class="text-xs text-text-tertiary">Command</span>
                    <p class="font-mono text-gray-900 dark:text-gray-100">
                      {selected()!.command ?? '—'}
                    </p>
                  </div>
                </Show>
                <Show when={selected()!.transport === 'http'}>
                  <div>
                    <span class="text-xs text-text-tertiary">URL</span>
                    <p class="font-mono text-gray-900 dark:text-gray-100">
                      {selected()!.url ?? '—'}
                    </p>
                  </div>
                </Show>

                <Show when={selected()!.args && selected()!.args!.length > 0}>
                  <div>
                    <span class="text-xs text-text-tertiary">Arguments</span>
                    <p class="font-mono text-gray-900 dark:text-gray-100">
                      {selected()!.args!.join(' ')}
                    </p>
                  </div>
                </Show>

                <Show
                  when={
                    selected()!.env && Object.keys(selected()!.env!).length > 0
                  }
                >
                  <div>
                    <span class="text-xs text-text-tertiary">
                      Environment Variables
                    </span>
                    <div class="mt-1 space-y-0.5">
                      <For each={Object.entries(selected()!.env!)}>
                        {([key, val]) => (
                          <p class="font-mono text-xs text-gray-700 dark:text-gray-300">
                            {key}=<span class="text-text-tertiary">{val}</span>
                          </p>
                        )}
                      </For>
                    </div>
                  </div>
                </Show>

                {/* Tools */}
                <div>
                  <span class="text-xs text-text-tertiary">
                    Tools ({selected()!.toolCount})
                  </span>
                  <Show when={selected()!.tools.length === 0}>
                    <p class="mt-1 text-text-tertiary italic text-xs">
                      {selected()!.connected
                        ? 'No tools exposed by this server'
                        : 'Connect to see available tools'}
                    </p>
                  </Show>
                  <Show when={selected()!.tools.length > 0}>
                    <div class="mt-2 space-y-2">
                      <For each={selected()!.tools}>
                        {(tool) => (
                          <div class="p-2 bg-gray-50 dark:bg-gray-900 rounded-lg">
                            <div class="font-mono text-xs text-primary">
                              {tool.name}
                            </div>
                            <Show when={tool.description}>
                              <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400 line-clamp-2">
                                {tool.description}
                              </p>
                            </Show>
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
              </div>
            </Show>
          </div>
        </div>
      </Show>

      {/* Modals */}
      <Show when={showForm()}>
        <ServerFormModal
          mode={showForm()!.mode}
          server={showForm()!.server}
          onSave={handleSave}
          onClose={() => setShowForm(null)}
        />
      </Show>

      <Show when={showDelete()}>
        <ConfirmDeleteModal
          server={showDelete()!}
          onConfirm={handleDelete}
          onClose={() => setShowDelete(null)}
        />
      </Show>

      <Show when={showImport()}>
        <ImportModal
          onImport={handleImport}
          onClose={() => setShowImport(false)}
        />
      </Show>
    </Layout>
  );
}
