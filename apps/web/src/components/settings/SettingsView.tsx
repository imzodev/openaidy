import { createSignal, Show, createEffect } from 'solid-js';
import { Save } from 'lucide-solid';
import type { AppConfig } from '../../lib/api';
import { useConfig } from './hooks/useConfig';
import { SaveMessage, Tabs, type Tab } from '../ui';
import { DefaultsTab, ProvidersTab, AgentsTab, RawJsonTab } from './tabs';
import type { ConfigTab } from './types';

const tabs: { id: ConfigTab; label: string }[] = [
  { id: 'defaults', label: 'Defaults' },
  { id: 'providers', label: 'Providers' },
  { id: 'agents', label: 'Agents' },
  { id: 'raw', label: 'Raw JSON' },
];

export function SettingsView() {
  const [activeTab, setActiveTab] = createSignal<ConfigTab>('defaults');
  // Local state for editing - only saved to server when Save button is clicked
  const [localConfig, setLocalConfig] = createSignal<AppConfig | undefined>();
  const [hasChanges, setHasChanges] = createSignal(false);

  // Config hook - handles data fetching and mutations
  const {
    configQuery,
    config,
    updateMutation,
    updateConfigData,
    rawJson,
    setRawJson,
    saveMessage,
    showSaveError,
  } = useConfig();

  // Sync local config with server config when data loads
  createEffect(() => {
    const serverConfig = config();
    if (serverConfig && !localConfig()) {
      setLocalConfig(serverConfig);
    }
  });

  // Handle global save
  const handleSave = () => {
    const configToSave = activeTab() === 'raw' ? parseRawJson() : localConfig();
    if (configToSave) {
      updateConfigData(configToSave);
      setHasChanges(false);
    }
  };

  // Parse raw JSON for saving
  const parseRawJson = (): AppConfig | null => {
    try {
      return JSON.parse(rawJson()) as AppConfig;
    } catch {
      showSaveError('Invalid JSON format');
      return null;
    }
  };

  // Handle defaults tab change - update local state only
  const handleDefaultsChange = (newConfig: Record<string, unknown>) => {
    setLocalConfig(
      (prev) =>
        ({
          ...prev,
          defaults: {
            ...(prev?.defaults ?? {}),
            ...((newConfig.defaults as Record<string, unknown> | undefined) ??
              {}),
          },
        }) as AppConfig,
    );
    setHasChanges(true);
  };

  // Handle provider update - update local state only
  const handleUpdateProvider = (
    _providerId: string,
    updatedProvider: import('../../lib/api').ProviderConfig,
  ) => {
    setLocalConfig((prev) => {
      if (!prev) return prev;
      const updatedProviders = [...(prev.providers || [])];
      const providerIndex = updatedProviders.findIndex(
        (p) => p.id === _providerId,
      );
      if (providerIndex !== -1) {
        updatedProviders[providerIndex] = updatedProvider;
      }
      return { ...prev, providers: updatedProviders } as AppConfig;
    });
    setHasChanges(true);
  };

  // Handle agent update - update local state only
  const handleUpdateAgent = (
    _agentId: string,
    updatedAgent: import('../../lib/api').AgentConfig,
  ) => {
    setLocalConfig((prev) => {
      if (!prev) return prev;
      const updatedAgents = [...(prev.agents || [])];
      const agentIndex = updatedAgents.findIndex((a) => a.id === _agentId);
      if (agentIndex !== -1) {
        updatedAgents[agentIndex] = updatedAgent;
      }
      return { ...prev, agents: updatedAgents } as AppConfig;
    });
    setHasChanges(true);
  };

  // Handle add provider - saves immediately (modal action)
  const handleAddProvider = async (
    newProvider: import('../../lib/api').ProviderConfig,
  ) => {
    const currentConfig = localConfig() || config();
    if (!currentConfig) return false;

    const updatedConfig = {
      ...currentConfig,
      providers: [...(currentConfig.providers || []), newProvider],
    } as AppConfig;

    await updateConfigData(updatedConfig);
    setLocalConfig(updatedConfig);
    return true;
  };

  // Handle delete provider - saves immediately
  const handleDeleteProvider = async (providerId: string) => {
    const currentConfig = localConfig() || config();
    if (!currentConfig) return;

    const updatedConfig = {
      ...currentConfig,
      providers: currentConfig.providers?.filter((p) => p.id !== providerId),
    } as AppConfig;

    await updateConfigData(updatedConfig);
    setLocalConfig(updatedConfig);
  };

  // Handle add agent - saves immediately
  const handleAddAgent = async () => {
    const currentConfig = localConfig() || config();
    if (!currentConfig) return;

    const newAgent: import('../../lib/api').AgentConfig = {
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

    await updateConfigData(updatedConfig);
    setLocalConfig(updatedConfig);
  };

  // Handle delete agent - saves immediately
  const handleDeleteAgent = async (agentId: string) => {
    const currentConfig = localConfig() || config();
    if (!currentConfig) return;

    const updatedConfig = {
      ...currentConfig,
      agents: currentConfig.agents?.filter((a) => a.id !== agentId),
    } as AppConfig;

    await updateConfigData(updatedConfig);
    setLocalConfig(updatedConfig);
  };

  // Handle tab change with raw JSON sync
  const handleTabChange = (tab: ConfigTab) => {
    setActiveTab(tab);
    if (tab === 'raw') {
      const configToSync = localConfig() || config();
      if (configToSync) {
        setRawJson(JSON.stringify(configToSync, null, 2));
      }
    }
  };

  return (
    <div class="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900">
      <div class="max-w-5xl mx-auto py-4 sm:py-6 lg:py-8 px-3 sm:px-4 lg:px-8">
        <div class="flex items-center justify-between mb-6">
          <h1 class="text-2xl font-bold text-text-primary">Configuration</h1>

          {/* Global Save Button - always visible */}
          <button
            onClick={handleSave}
            disabled={updateMutation.isPending || !hasChanges()}
            class="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-hover disabled:bg-primary-disabled text-white rounded-lg transition-colors text-sm font-medium"
          >
            <Save class="w-4 h-4" />
            {updateMutation.isPending
              ? 'Saving...'
              : hasChanges()
                ? 'Save Changes'
                : 'No Changes'}
          </button>
        </div>

        <SaveMessage message={saveMessage} />

        {/* Tab Navigation */}
        <Tabs
          tabs={tabs as Tab<ConfigTab>[]}
          activeTab={activeTab}
          onTabChange={handleTabChange}
        />

        {/* Tab Content */}
        <div class="bg-white dark:bg-gray-800 shadow rounded-b-lg min-h-[500px]">
          <Show when={configQuery.isLoading}>
            <div class="p-8 text-center text-text-tertiary">
              Loading configuration...
            </div>
          </Show>

          <Show when={configQuery.error}>
            <div class="p-8 text-center text-red-500">
              Error loading configuration
            </div>
          </Show>

          <Show when={localConfig()}>
            {/* Defaults Tab */}
            <Show when={activeTab() === 'defaults'}>
              <DefaultsTab
                config={localConfig}
                onChange={handleDefaultsChange}
              />
            </Show>

            {/* Providers Tab */}
            <Show when={activeTab() === 'providers'}>
              <ProvidersTab
                config={localConfig}
                isPending={updateMutation.isPending}
                onAddProvider={handleAddProvider}
                onDeleteProvider={handleDeleteProvider}
                onUpdateProvider={handleUpdateProvider}
              />
            </Show>

            {/* Agents Tab */}
            <Show when={activeTab() === 'agents'}>
              <AgentsTab
                config={localConfig}
                providers={localConfig()?.providers ?? []}
                isPending={updateMutation.isPending}
                onAddAgent={handleAddAgent}
                onDeleteAgent={handleDeleteAgent}
                onUpdateAgent={handleUpdateAgent}
              />
            </Show>

            {/* Raw JSON Tab */}
            <Show when={activeTab() === 'raw'}>
              <RawJsonTab
                value={rawJson}
                onInput={(val) => {
                  setRawJson(val);
                  setHasChanges(true);
                }}
              />
            </Show>
          </Show>
        </div>
      </div>
    </div>
  );
}
