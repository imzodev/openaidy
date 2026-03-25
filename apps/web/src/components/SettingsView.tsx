import { createSignal, Show, onMount } from 'solid-js';
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
} from '../lib/api';
import { Save, AlertCircle, CheckCircle2 } from 'lucide-solid';

type ConfigResponse =
  | { config: AppConfig; status: ConfigStatus }
  | { error: string };

export function SettingsView() {
  const queryClient = useQueryClient();
  const [viewMode, setViewMode] = createSignal<'form' | 'raw'>('form');
  const [rawJson, setRawJson] = createSignal('');
  const [saveMessage, setSaveMessage] = createSignal<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const configQuery = createQuery(() => ({
    queryKey: ['config'],
    queryFn: getConfig,
  }));

  // When config loads, populate the raw JSON
  onMount(() => {
    const data = configQuery.data as ConfigResponse | undefined;
    if (data && 'config' in data && data.config) {
      setRawJson(JSON.stringify(data.config, null, 2));
    }
  });

  // Watch for data updates
  const config = () => {
    const data = configQuery.data as ConfigResponse | undefined;
    return data && 'config' in data ? data.config : undefined;
  };

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
    } catch (_e) {
      setSaveMessage({ type: 'error', text: 'Invalid JSON format' });
    }
  };

  const handleUpdateDefault = (field: string, value: string) => {
    const currentConfig = config();
    if (!currentConfig) return;
    const newConfig: AppConfig = {
      ...currentConfig,
      defaults: {
        ...(currentConfig.defaults || {}),
        [field]: value,
      },
    };
    updateMutation.mutateAsync(newConfig);
  };

  return (
    <div class="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900">
      <div class="max-w-5xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div class="flex items-center justify-between mb-8">
          <h1 class="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Config
          </h1>

          <div class="flex items-center space-x-4">
            {/* View Toggle */}
            <div class="bg-gray-200 dark:bg-gray-800 p-1 rounded-lg flex text-sm">
              <button
                onClick={() => {
                  setViewMode('form');
                  if (config()) setRawJson(JSON.stringify(config(), null, 2));
                }}
                class={`px-4 py-1.5 rounded-md transition-colors ${
                  viewMode() === 'form'
                    ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                }`}
              >
                Form
              </button>
              <button
                onClick={() => {
                  if (config()) setRawJson(JSON.stringify(config(), null, 2));
                  setViewMode('raw');
                }}
                class={`px-4 py-1.5 rounded-md transition-colors ${
                  viewMode() === 'raw'
                    ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                }`}
              >
                Raw
              </button>
            </div>

            <Show when={viewMode() === 'raw'}>
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
        </div>

        {/* Notifications */}
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

        {/* Content */}
        <div class="bg-white dark:bg-gray-800 shadow rounded-lg flex flex-col min-h-[500px]">
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
            <Show when={viewMode() === 'form'}>
              <div class="p-6 space-y-8">
                <div>
                  <h3 class="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4 pb-2 border-b border-gray-200 dark:border-gray-700">
                    Default Settings
                  </h3>

                  <div class="space-y-4 max-w-xl">
                    <div>
                      <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Default Provider
                      </label>
                      <select
                        class="w-full bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-gray-900 dark:text-white"
                        value={config()?.defaults?.providerId || ''}
                        onChange={(e) =>
                          handleUpdateDefault(
                            'providerId',
                            e.currentTarget.value,
                          )
                        }
                      >
                        <option value="">Select a provider...</option>
                        {config()?.providers?.map((p) => (
                          <option value={p.id}>
                            {p.name} ({p.id})
                          </option>
                        ))}
                      </select>
                      <p class="mt-1 text-xs text-gray-500">
                        The provider to use if none is specified by the agent.
                      </p>
                    </div>

                    <div>
                      <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Default Model
                      </label>
                      <input
                        type="text"
                        class="w-full bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-gray-900 dark:text-white"
                        value={config()?.defaults?.modelId || ''}
                        onChange={(e) =>
                          handleUpdateDefault('modelId', e.currentTarget.value)
                        }
                        placeholder="e.g. gpt-4o"
                      />
                    </div>
                  </div>
                </div>

                <div class="pt-4">
                  <div class="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg border border-blue-100 dark:border-blue-900/50">
                    <h4 class="text-sm font-medium text-blue-800 dark:text-blue-300 flex items-center gap-2 mb-2">
                      <AlertCircle class="w-4 h-4" />
                      Advanced Configuration
                    </h4>
                    <p class="text-sm text-blue-700 dark:text-blue-400">
                      To configure providers, API keys, agents, and other
                      advanced settings, please switch to the{' '}
                      <strong>Raw</strong> JSON view using the toggle at the top
                      right.
                    </p>
                  </div>
                </div>
              </div>
            </Show>

            <Show when={viewMode() === 'raw'}>
              <div class="flex flex-col flex-1 p-0 h-full">
                <textarea
                  value={rawJson()}
                  onInput={(e) => setRawJson(e.currentTarget.value)}
                  class="flex-1 w-full bg-gray-900 text-gray-100 p-6 font-mono text-sm leading-relaxed border-0 focus:ring-0 rounded-b-lg resize-none min-h-[500px]"
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
