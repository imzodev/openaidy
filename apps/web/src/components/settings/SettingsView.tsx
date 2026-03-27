import { createSignal, Show } from 'solid-js';
import { Save } from 'lucide-solid';
import type { AppConfig } from '../../lib/api';
import { useConfig, useProviders, useAgents } from './hooks';
import { SaveMessage, Tabs, type Tab } from '../ui';
import { AddProviderModal } from './AddProviderModal';
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

  // Providers hook - handles provider CRUD operations
  const {
    showAddProviderModal,
    newProviderData,
    setNewProviderData,
    openAddProviderModal,
    closeAddProviderModal,
    saveNewProvider,
    deleteProvider,
    updateProvider,
  } = useProviders(config, updateConfigData, showSaveError);

  // Agents hook - handles agent CRUD operations
  const { addAgent, deleteAgent, updateAgent } = useAgents(
    config,
    updateConfigData,
  );

  // Handle raw JSON save
  const handleSaveRaw = () => {
    try {
      const parsed = JSON.parse(rawJson()) as AppConfig;
      updateConfigData(parsed);
    } catch {
      showSaveError('Invalid JSON format');
    }
  };

  // Handle defaults tab change
  const handleDefaultsChange = (newConfig: Record<string, unknown>) => {
    const currentConfig = config();
    const mergedConfig = {
      ...currentConfig,
      defaults: newConfig.defaults,
    } as AppConfig;
    updateConfigData(mergedConfig);
  };

  // Handle tab change with raw JSON sync
  const handleTabChange = (tab: ConfigTab) => {
    setActiveTab(tab);
    if (tab === 'raw' && config()) {
      setRawJson(JSON.stringify(config(), null, 2));
    }
  };

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
              <DefaultsTab config={config} onChange={handleDefaultsChange} />
            </Show>

            {/* Providers Tab */}
            <Show when={activeTab() === 'providers'}>
              <ProvidersTab
                config={config}
                isPending={updateMutation.isPending}
                onAddProvider={openAddProviderModal}
                onDeleteProvider={deleteProvider}
                onUpdateProvider={updateProvider}
              />
            </Show>

            {/* Agents Tab */}
            <Show when={activeTab() === 'agents'}>
              <AgentsTab
                config={config}
                isPending={updateMutation.isPending}
                onAddAgent={addAgent}
                onDeleteAgent={deleteAgent}
                onUpdateAgent={updateAgent}
              />
            </Show>

            {/* Raw JSON Tab */}
            <Show when={activeTab() === 'raw'}>
              <RawJsonTab value={rawJson} onInput={setRawJson} />
            </Show>
          </Show>
        </div>
      </div>

      {/* Add Provider Modal */}
      <AddProviderModal
        show={showAddProviderModal}
        onClose={closeAddProviderModal}
        onSave={saveNewProvider}
        data={newProviderData}
        setData={setNewProviderData}
        isPending={updateMutation.isPending}
      />
    </div>
  );
}
