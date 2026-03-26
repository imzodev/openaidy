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
} from '../lib/api';
import { Save, AlertCircle, CheckCircle2, Plus, Trash2 } from 'lucide-solid';
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

  const handleAgentsChange = (newConfig: Record<string, unknown>) => {
    const currentConfig = config();
    const mergedConfig = {
      ...currentConfig,
      agents: newConfig.agents,
    } as AppConfig;
    updateMutation.mutateAsync(mergedConfig);
  };

  const handleAddProvider = () => {
    const currentConfig = config();
    if (!currentConfig) return;

    const newProvider: ProviderConfig = {
      id: `provider-${Date.now()}`,
      name: 'New Provider',
      vendorFamily: 'openai-compatible',
      baseUrl: 'https://api.openai.com/v1',
      apiKeyEnv: 'OPENAI_API_KEY',
      models: [],
    };

    const updatedConfig = {
      ...currentConfig,
      providers: [...(currentConfig.providers || []), newProvider],
    } as AppConfig;

    updateMutation.mutateAsync(updatedConfig);
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
                    onClick={handleAddProvider}
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
                    {(provider, index) => (
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
                          <button
                            onClick={() => handleDeleteProvider(provider.id)}
                            disabled={updateMutation.isPending}
                            class="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                            title="Delete provider"
                          >
                            <Trash2 class="w-4 h-4" />
                          </button>
                        </div>
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
                              const providerIndex = updatedProviders.findIndex(
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
                      </div>
                    )}
                  </For>
                </Show>
              </div>
            </Show>

            {/* Agents Tab */}
            <Show when={activeTab() === 'agents'}>
              <div class="p-6">
                <DynamicConfigForm
                  config={
                    { agents: config()?.agents } as Record<string, unknown>
                  }
                  schema={agentsSchema()}
                  onChange={handleAgentsChange}
                  errors={{}}
                />
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
    </div>
  );
}
