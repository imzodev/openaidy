import { Layout } from './Layout';
import { For, Show, createSignal, onMount } from 'solid-js';
import { listMcpServers, type McpServer } from '../lib/api';

export function McpsPage() {
  const [servers, setServers] = createSignal<McpServer[]>([]);
  const [isLoading, setIsLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [selectedServer, setSelectedServer] = createSignal<string | null>(null);

  const loadServers = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await listMcpServers();
      setServers(data.servers);
      if (data.servers.length > 0 && !selectedServer()) {
        setSelectedServer(data.servers[0]?.id ?? null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load MCP servers');
    } finally {
      setIsLoading(false);
    }
  };

  onMount(() => {
    void loadServers();
  });

  const selectedServerData = () => servers().find((s) => s.id === selectedServer());

  const connectedCount = () => servers().filter((s) => s.connected).length;
  const totalTools = () =>
    servers()
      .filter((s) => s.connected)
      .reduce((sum, s) => sum + s.tools.length, 0);

  return (
    <Layout title="MCP Servers" description="Model Context Protocol connections">
      {/* Loading State */}
      <Show when={isLoading()}>
        <div class="flex items-center justify-center h-64">
          <div class="text-center">
            <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
            <p class="text-text-tertiary">Loading MCP servers...</p>
          </div>
        </div>
      </Show>

      {/* Error State */}
      <Show when={!isLoading() && error()}>
        <div class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-6">
          <p class="text-red-700 dark:text-red-400">{error()}</p>
          <button
            onClick={() => void loadServers()}
            class="mt-2 text-sm text-red-600 dark:text-red-400 underline hover:no-underline"
          >
            Try again
          </button>
        </div>
      </Show>

      {/* Empty State */}
      <Show when={!isLoading() && !error() && servers().length === 0}>
        <div class="flex items-center justify-center h-64">
          <div class="text-center">
            <div class="text-4xl mb-4">🔌</div>
            <p class="text-text-secondary mb-2">No MCP servers configured</p>
            <p class="text-sm text-text-tertiary">
              Add MCP servers to your{' '}
              <code class="bg-gray-100 dark:bg-gray-800 px-1 rounded">
                config/openaidy.json
              </code>{' '}
              to get started
            </p>
          </div>
        </div>
      </Show>

      {/* Main Content */}
      <Show when={!isLoading() && !error() && servers().length > 0}>
        {/* Stats Bar */}
        <div class="grid grid-cols-3 gap-4 mb-6">
          <div class="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
            <div class="text-2xl font-bold text-primary">{servers().length}</div>
            <div class="text-sm text-text-secondary">Configured Servers</div>
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
          {/* Server List */}
          <div class="bg-white dark:bg-gray-800 rounded-lg shadow">
            <div class="p-4 border-b dark:border-gray-700 flex items-center justify-between">
              <h2 class="text-lg font-semibold">Servers</h2>
              <button
                onClick={() => void loadServers()}
                disabled={isLoading()}
                class="text-sm text-primary hover:text-primary/80 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                title="Refresh server list"
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
                Refresh
              </button>
            </div>
            <div class="divide-y dark:divide-gray-700">
              <For each={servers()}>
                {(server) => (
                  <button
                    class={`w-full p-4 text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${
                      selectedServer() === server.id
                        ? 'bg-primary-50 dark:bg-primary-900/20 border-l-4 border-primary'
                        : ''
                    }`}
                    onClick={() => setSelectedServer(server.id)}
                  >
                    <div class="flex items-center justify-between mb-1">
                      <span class="font-medium">
                        {server.name ?? server.id}
                      </span>
                      <span
                        class={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          server.connected
                            ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                            : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-400'
                        }`}
                      >
                        {server.connected ? 'Connected' : 'Disconnected'}
                      </span>
                    </div>
                    <div class="text-sm text-text-tertiary">
                      {server.connected
                        ? `${server.tools.length} tools available`
                        : 'Not connected'}
                    </div>
                  </button>
                )}
              </For>
            </div>
          </div>

          {/* Tool Details */}
          <div class="lg:col-span-2 bg-white dark:bg-gray-800 rounded-lg shadow">
            <div class="p-4 border-b dark:border-gray-700">
              <h2 class="text-lg font-semibold">
                Tools
                <Show when={selectedServerData()}>
                  <span class="font-normal text-text-tertiary ml-2">
                    from {selectedServerData()?.name ?? selectedServerData()?.id}
                  </span>
                </Show>
              </h2>
            </div>

            <Show when={!selectedServerData()?.connected}>
              <div class="p-8 text-center">
                <div class="text-3xl mb-3">⚠️</div>
                <p class="text-text-secondary">Server not connected</p>
                <p class="text-sm text-text-tertiary mt-1">
                  Check server logs for connection errors
                </p>
              </div>
            </Show>

            <Show
              when={
                selectedServerData()?.connected &&
                selectedServerData()?.tools.length === 0
              }
            >
              <div class="p-8 text-center">
                <div class="text-3xl mb-3">📭</div>
                <p class="text-text-secondary">No tools available</p>
                <p class="text-sm text-text-tertiary mt-1">
                  This server may not expose any tools
                </p>
              </div>
            </Show>

            <Show
              when={
                selectedServerData()?.connected &&
                selectedServerData()!.tools.length > 0
              }
            >
              <div class="divide-y dark:divide-gray-700 max-h-96 overflow-y-auto">
                <For each={selectedServerData()?.tools}>
                  {(tool) => (
                    <div class="p-4">
                      <div class="font-mono text-sm text-primary mb-1">
                        {tool.name}
                      </div>
                      <Show when={tool.description}>
                        <p class="text-sm text-text-secondary">
                          {tool.description}
                        </p>
                      </Show>
                      <Show when={!tool.description}>
                        <p class="text-sm text-text-tertiary italic">
                          No description available
                        </p>
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            </Show>

            <Show when={!selectedServer()}>
              <div class="p-8 text-center">
                <p class="text-text-tertiary">Select a server to see tools</p>
              </div>
            </Show>
          </div>
        </div>
      </Show>
    </Layout>
  );
}
