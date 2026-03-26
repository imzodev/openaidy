import { createSignal, Show, onMount, createMemo, For } from 'solid-js';
import {
  createQuery,
  createMutation,
  useQueryClient,
} from '@tanstack/solid-query';
import {
  getConfig,
  updateConfig,
  type AppConfig,
  type ConfigStatus,
  type ProviderConfig,
  type AgentConfig,
} from '../lib/api';
import {
  Save,
  AlertCircle,
  CheckCircle2,
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  X,
} from 'lucide-solid';
import {
  DynamicConfigForm,
  getDefaultsSectionSchema,
  getProvidersSectionSchema,
  getAgentsSectionSchema,
  type FormSchema,
} from '../config';

type ConfigResponse =
  | { config: AppConfig; status: ConfigStatus }
  | { error: string };

type ConfigTab = 'defaults' | 'providers' | 'agents' | 'raw';

export function SettingsView() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = createSignal<ConfigTab>('defaults');
  const [rawJson, setRawJson] = createSignal('');
  const [saveMessage, setSaveMessage] = createSignal<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Modal state for adding new provider
  const [showAddProviderModal, setShowAddProviderModal] = createSignal(false);
  const [newProviderData, setNewProviderData] = createSignal<
    Partial<ProviderConfig>
  >({
    id: '',
    name: '',
    vendorFamily: 'openai-compatible',
    enabled: true,
    baseUrl: '',
    apiKeyEnv: '',
  });

  const configQuery = createQuery(() => ({
    queryKey: ['config'],
    queryFn: getConfig,
  }));

  onMount(() => {
    const data = configQuery.data as ConfigResponse | undefined;
    if (data && 'config' in data && data.config) {
      setRawJson(JSON.stringify(data.config, null, 2));
    }
  });

  const config = () => {
    const data = configQuery.data as ConfigResponse | undefined;
    return data && 'config' in data ? data.config : undefined;
  };

  // Schema for defaults tab
  const defaultsSchema = createMemo((): FormSchema => {
    const currentConfig = config();
    return {
      sections: [
        getDefaultsSectionSchema({
          providers: currentConfig?.providers?.map((p) => ({
            id: p.id,
            name: p.name,
          })),
          agents: currentConfig?.agents?.map((a) => ({
            id: a.id,
            name: a.name,
          })),
        }),
      ],
    };
  });

  // Schema for providers tab
  const providersSchema = createMemo((): FormSchema => {
    return {
      sections: [getProvidersSectionSchema()],
    };
  });

  // Schema for agents tab
  const agentsSchema = createMemo((): FormSchema => {
    return {
      sections: [getAgentsSectionSchema()],
    };
  });

  const updateMutation = createMutation(() => ({
    mutationFn: (newConfig: AppConfig) => updateConfig(newConfig),
    onSuccess: (data: ConfigResponse) => {
      queryClient.invalidateQueries({ queryKey: ['config'] });
      if (data && 'config' in data && data.config) {
        setRawJson(JSON.stringify(data.config, null, 2));
      }
      setSaveMessage({
        type: 'success',
        text: 'Configuration saved successfully',
      });
      setTimeout(() => setSaveMessage(null), 3000);
    },
    onError: (error: Error) => {
      setSaveMessage({
        type: 'error',
        text: `Failed to save: ${error.message}`,
      });
    },
  }));

  const handleSaveRaw = () => {
    try {
      const parsed = JSON.parse(rawJson()) as AppConfig;
      updateMutation.mutateAsync(parsed);
    } catch {
      setSaveMessage({ type: 'error', text: 'Invalid JSON format' });
    }
  };

  const handleDefaultsChange = (newConfig: Record<string, unknown>) => {
    const currentConfig = config();
    const mergedConfig = {
      ...currentConfig,
      defaults: newConfig.defaults,
    } as AppConfig;
    updateMutation.mutateAsync(mergedConfig);
  };

  const _handleProvidersChange = (newConfig: Record<string, unknown>) => {
    const currentConfig = config();
    const mergedConfig = {
      ...currentConfig,
      providers: newConfig.providers,
    } as AppConfig;
    updateMutation.mutateAsync(mergedConfig);
  };

  const handleOpenAddProviderModal = () => {
    setNewProviderData({
      id: '',
      name: '',
      vendorFamily: 'openai-compatible',
      enabled: true,
      baseUrl: '',
      apiKeyEnv: '',
    });
    setShowAddProviderModal(true);
  };

  const handleSaveNewProvider = () => {
    const currentConfig = config();
    if (!currentConfig) return;

    const providerData = newProviderData();
    if (!providerData.id || !providerData.name) {
      setSaveMessage({
        type: 'error',
        text: 'Provider ID and Name are required',
      });
      return;
    }

    const newProvider: ProviderConfig = {
      id: providerData.id || `provider-${Date.now()}`,
      name: providerData.name || 'New Provider',
      vendorFamily: providerData.vendorFamily || 'openai-compatible',
      enabled: providerData.enabled ?? true,
      baseUrl: providerData.baseUrl || '',
      apiKeyEnv: providerData.apiKeyEnv || '',
      models: [],
    };

    const updatedConfig = {
      ...currentConfig,
      providers: [...(currentConfig.providers || []), newProvider],
    } as AppConfig;

    updateMutation.mutateAsync(updatedConfig);
    setShowAddProviderModal(false);
  };

  const handleDeleteProvider = (providerId: string) => {
    const currentConfig = config();
    if (!currentConfig) return;

    const updatedConfig = {
      ...currentConfig,
      providers: currentConfig.providers?.filter((p) => p.id !== providerId),
    } as AppConfig;

    updateMutation.mutateAsync(updatedConfig);
  };

  const handleAddAgent = () => {
    const currentConfig = config();
    if (!currentConfig) return;

    const newAgent: AgentConfig = {
      id: `agent-${Date.now()}`,
      name: 'New Agent',
      enabled: true,
      description: '',
      systemPrompt: 'You are a helpful assistant.',
      model: '',
    };

    const updatedConfig = {
      ...currentConfig,
      agents: [...(currentConfig.agents || []), newAgent],
    } as AppConfig;

    updateMutation.mutateAsync(updatedConfig);
  };

  const handleDeleteAgent = (agentId: string) => {
    const currentConfig = config();
    if (!currentConfig) return;

    const updatedConfig = {
      ...currentConfig,
      agents: currentConfig.agents?.filter((a) => a.id !== agentId),
    } as AppConfig;

    updateMutation.mutateAsync(updatedConfig);
  };

  const tabs: { id: ConfigTab; label: string }[] = [
    { id: 'defaults', label: 'Defaults' },
    { id: 'providers', label: 'Providers' },
    { id: 'agents', label: 'Agents' },
    { id: 'raw', label: 'Raw JSON' },
  ];

  return (
    <div class="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900">
      <div class="max-w-5xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <div class="flex items-center justify-between mb-6">
          <h1 class="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Configuration
          </h1>

          <Show when={activeTab() === 'raw'}>
            <button
              onClick={handleSaveRaw}
              disabled={updateMutation.isPending}
              class="flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-400 text-white rounded-lg transition-colors text-sm font-medium"
            >
              <Save class="w-4 h-4" />
              {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
            </button>
          </Show>
        </div>

        <Show when={saveMessage()}>
          <div
            class={`mb-6 p-4 rounded-lg flex items-center gap-2 ${
              saveMessage()?.type === 'success'
                ? 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800'
                : 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800'
            }`}
          >
            {saveMessage()?.type === 'success' ? (
              <CheckCircle2 class="w-5 h-5" />
            ) : (
              <AlertCircle class="w-5 h-5" />
            )}
            <p>{saveMessage()?.text}</p>
          </div>
        </Show>

        {/* Tab Navigation */}
        <div class="bg-white dark:bg-gray-800 shadow rounded-t-lg">
          <div class="border-b border-gray-200 dark:border-gray-700">
            <nav class="flex -mb-px" aria-label="Tabs">
              <For each={tabs}>
                {(tab) => (
                  <button
                    onClick={() => {
                      setActiveTab(tab.id);
                      if (tab.id === 'raw' && config()) {
                        setRawJson(JSON.stringify(config(), null, 2));
                      }
                    }}
                    class={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                      activeTab() === tab.id
                        ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                        : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
                    }`}
                  >
                    {tab.label}
                  </button>
                )}
              </For>
            </nav>
          </div>
        </div>

        {/* Tab Content */}
        <div class="bg-white dark:bg-gray-800 shadow rounded-b-lg min-h-[500px]">
          <Show when={configQuery.isLoading}>
            <div class="p-8 text-center text-gray-500">
              Loading configuration...
            </div>
          </Show>

          <Show when={configQuery.error}>
            <div class="p-8 text-center text-red-500">
              Error loading configuration
            </div>
          </Show>

          <Show when={config()}>
            {/* Defaults Tab */}
            <Show when={activeTab() === 'defaults'}>
              <div class="p-6">
                <DynamicConfigForm
                  config={
                    { defaults: config()?.defaults } as Record<string, unknown>
                  }
                  schema={defaultsSchema()}
                  onChange={handleDefaultsChange}
                  errors={{}}
                />
              </div>
            </Show>

            {/* Providers Tab */}
            <Show when={activeTab() === 'providers'}>
              <div class="p-6">
                <div class="flex items-center justify-between mb-4">
                  <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    Providers
                  </h2>
                  <button
                    onClick={handleOpenAddProviderModal}
                    disabled={updateMutation.isPending}
                    class="flex items-center gap-2 px-3 py-1.5 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-400 text-white rounded-lg transition-colors text-sm font-medium"
                  >
                    <Plus class="w-4 h-4" />
                    Add Provider
                  </button>
                </div>

                <Show
                  when={(config()?.providers?.length ?? 0) > 0}
                  fallback={
                    <div class="text-center py-8 text-gray-500 dark:text-gray-400">
                      <p>No providers configured.</p>
                      <p class="text-sm mt-2">
                        Click "Add Provider" to add a new provider.
                      </p>
                    </div>
                  }
                >
                  <For each={config()?.providers}>
                    {(provider, index) => {
                      const [isCollapsed, setIsCollapsed] = createSignal(false);

                      return (
                        <div class="border border-gray-200 dark:border-gray-700 rounded-lg mb-4">
                          <div class="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-900/50 rounded-t-lg">
                            <div class="flex items-center gap-3">
                              <span class="text-sm font-medium text-gray-500 dark:text-gray-400">
                                #{index() + 1}
                              </span>
                              <h3 class="font-medium text-gray-900 dark:text-gray-100">
                                {provider.name}
                              </h3>
                              <span class="px-2 py-0.5 text-xs rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                                {provider.vendorFamily}
                              </span>
                            </div>
                            <div class="flex items-center gap-1">
                              <button
                                onClick={() => setIsCollapsed(!isCollapsed())}
                                class="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                                title={isCollapsed() ? 'Expand' : 'Collapse'}
                              >
                                <Show
                                  when={isCollapsed()}
                                  fallback={<ChevronDown class="w-4 h-4" />}
                                >
                                  <ChevronRight class="w-4 h-4" />
                                </Show>
                              </button>
                              <button
                                onClick={() =>
                                  handleDeleteProvider(provider.id)
                                }
                                disabled={updateMutation.isPending}
                                class="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                                title="Delete provider"
                              >
                                <Trash2 class="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                          <Show when={!isCollapsed()}>
                            <div class="p-4">
                              <DynamicConfigForm
                                config={
                                  { providers: [provider] } as Record<
                                    string,
                                    unknown
                                  >
                                }
                                schema={providersSchema()}
                                onChange={(newConfig) => {
                                  const currentConfig = config();
                                  const updatedProviders = [
                                    ...(currentConfig?.providers || []),
                                  ];
                                  const providerIndex =
                                    updatedProviders.findIndex(
                                      (p) => p.id === provider.id,
                                    );
                                  if (
                                    providerIndex !== -1 &&
                                    Array.isArray(newConfig.providers)
                                  ) {
                                    updatedProviders[providerIndex] = newConfig
                                      .providers[0] as ProviderConfig;
                                  }
                                  const mergedConfig = {
                                    ...currentConfig,
                                    providers: updatedProviders,
                                  } as AppConfig;
                                  updateMutation.mutateAsync(mergedConfig);
                                }}
                                errors={{}}
                              />
                            </div>
                          </Show>
                        </div>
                      );
                    }}
                  </For>
                </Show>
              </div>
            </Show>

            {/* Agents Tab */}
            <Show when={activeTab() === 'agents'}>
              <div class="p-6">
                <div class="flex items-center justify-between mb-4">
                  <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    Agents
                  </h2>
                  <button
                    onClick={handleAddAgent}
                    disabled={updateMutation.isPending}
                    class="flex items-center gap-2 px-3 py-1.5 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-400 text-white rounded-lg transition-colors text-sm font-medium"
                  >
                    <Plus class="w-4 h-4" />
                    Add Agent
                  </button>
                </div>

                <Show
                  when={(config()?.agents?.length ?? 0) > 0}
                  fallback={
                    <div class="text-center py-8 text-gray-500 dark:text-gray-400">
                      <p>No agents configured.</p>
                      <p class="text-sm mt-2">
                        Click "Add Agent" to add a new agent.
                      </p>
                    </div>
                  }
                >
                  <For each={config()?.agents}>
                    {(agent) => {
                      const [isCollapsed, setIsCollapsed] = createSignal(false);

                      return (
                        <div class="border border-gray-200 dark:border-gray-700 rounded-lg mb-4">
                          <div class="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-900/50 rounded-t-lg">
                            <div class="flex items-center gap-3">
                              <h3 class="font-medium text-gray-900 dark:text-gray-100">
                                {agent.name}
                              </h3>
                              <Show when={agent.description}>
                                <span class="text-sm text-gray-500 dark:text-gray-400">
                                  {agent.description}
                                </span>
                              </Show>
                              <Show when={agent.enabled}>
                                <span class="px-2 py-0.5 text-xs rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">
                                  enabled
                                </span>
                              </Show>
                            </div>
                            <div class="flex items-center gap-1">
                              <button
                                onClick={() => setIsCollapsed(!isCollapsed())}
                                class="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                                title={isCollapsed() ? 'Expand' : 'Collapse'}
                              >
                                <Show
                                  when={isCollapsed()}
                                  fallback={<ChevronDown class="w-4 h-4" />}
                                >
                                  <ChevronRight class="w-4 h-4" />
                                </Show>
                              </button>
                              <button
                                onClick={() => handleDeleteAgent(agent.id)}
                                disabled={updateMutation.isPending}
                                class="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                                title="Delete agent"
                              >
                                <Trash2 class="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                          <Show when={!isCollapsed()}>
                            <div class="p-4">
                              <DynamicConfigForm
                                config={
                                  { agents: [agent] } as Record<string, unknown>
                                }
                                schema={agentsSchema()}
                                onChange={(newConfig) => {
                                  const currentConfig = config();
                                  const updatedAgents = [
                                    ...(currentConfig?.agents || []),
                                  ];
                                  const agentIndex = updatedAgents.findIndex(
                                    (a) => a.id === agent.id,
                                  );
                                  if (
                                    agentIndex !== -1 &&
                                    Array.isArray(newConfig.agents)
                                  ) {
                                    updatedAgents[agentIndex] = newConfig
                                      .agents[0] as AgentConfig;
                                  }
                                  const mergedConfig = {
                                    ...currentConfig,
                                    agents: updatedAgents,
                                  } as AppConfig;
                                  updateMutation.mutateAsync(mergedConfig);
                                }}
                                errors={{}}
                              />
                            </div>
                          </Show>
                        </div>
                      );
                    }}
                  </For>
                </Show>
              </div>
            </Show>

            {/* Raw JSON Tab */}
            <Show when={activeTab() === 'raw'}>
              <div class="flex flex-col flex-1 p-0 h-full">
                <textarea
                  value={rawJson()}
                  onInput={(e) => setRawJson(e.currentTarget.value)}
                  class="w-full bg-gray-900 text-gray-100 p-6 font-mono text-sm leading-relaxed border-0 focus:ring-0 rounded-b-lg resize-none min-h-[500px]"
                  spellcheck={false}
                />
              </div>
            </Show>
          </Show>
        </div>
      </div>

      {/* Add Provider Modal */}
      <Show when={showAddProviderModal()}>
        <div class="fixed inset-0 z-50 flex items-center justify-center">
          <div
            class="absolute inset-0 bg-black/50"
            onClick={() => setShowAddProviderModal(false)}
          />
          <div class="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <div class="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
              <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Add New Provider
              </h3>
              <button
                onClick={() => setShowAddProviderModal(false)}
                class="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <X class="w-5 h-5" />
              </button>
            </div>
            <div class="p-4 space-y-4">
              {/* Provider ID */}
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Provider ID <span class="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={newProviderData().id || ''}
                  onInput={(e) =>
                    setNewProviderData({
                      ...newProviderData(),
                      id: e.currentTarget.value,
                    })
                  }
                  placeholder="e.g., openai, anthropic"
                  class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Unique identifier (lowercase letters, numbers, hyphens)
                </p>
              </div>

              {/* Display Name */}
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Display Name <span class="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={newProviderData().name || ''}
                  onInput={(e) =>
                    setNewProviderData({
                      ...newProviderData(),
                      name: e.currentTarget.value,
                    })
                  }
                  placeholder="e.g., OpenAI, Anthropic"
                  class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              {/* Vendor Family */}
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Vendor Family
                </label>
                <select
                  value={newProviderData().vendorFamily || 'openai-compatible'}
                  onChange={(e) =>
                    setNewProviderData({
                      ...newProviderData(),
                      vendorFamily: e.currentTarget
                        .value as ProviderConfig['vendorFamily'],
                    })
                  }
                  class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="openai-compatible">OpenAI Compatible</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="gemini">Google Gemini</option>
                </select>
              </div>

              {/* Base URL */}
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Base URL
                </label>
                <input
                  type="text"
                  value={newProviderData().baseUrl || ''}
                  onInput={(e) =>
                    setNewProviderData({
                      ...newProviderData(),
                      baseUrl: e.currentTarget.value,
                    })
                  }
                  placeholder="e.g., https://api.openai.com/v1"
                  class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              {/* API Key Env */}
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  API Key Environment Variable
                </label>
                <input
                  type="text"
                  value={newProviderData().apiKeyEnv || ''}
                  onInput={(e) =>
                    setNewProviderData({
                      ...newProviderData(),
                      apiKeyEnv: e.currentTarget.value,
                    })
                  }
                  placeholder="e.g., OPENAI_API_KEY"
                  class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Name of the environment variable containing the API key
                </p>
              </div>

              {/* Enabled */}
              <div class="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="provider-enabled"
                  checked={newProviderData().enabled ?? true}
                  onChange={(e) =>
                    setNewProviderData({
                      ...newProviderData(),
                      enabled: e.currentTarget.checked,
                    })
                  }
                  class="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <label
                  for="provider-enabled"
                  class="text-sm text-gray-700 dark:text-gray-300"
                >
                  Enabled
                </label>
              </div>
            </div>
            <div class="flex items-center justify-end gap-3 p-4 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={() => setShowAddProviderModal(false)}
                class="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveNewProvider}
                disabled={
                  updateMutation.isPending ||
                  !newProviderData().id ||
                  !newProviderData().name
                }
                class="px-4 py-2 text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 disabled:bg-blue-400 disabled:cursor-not-allowed rounded-lg transition-colors"
              >
                {updateMutation.isPending ? 'Adding...' : 'Add Provider'}
              </button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}
