import { createSignal, Show, onMount, createMemo } from 'solid-js';
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
import {
  DynamicConfigForm,
  buildAppConfigSchema,
  type FormSchema,
} from '../config';

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

  const formSchema = createMemo((): FormSchema => {
    const currentConfig = config();
    return buildAppConfigSchema({
      providers: currentConfig?.providers?.map((p) => ({
        id: p.id,
        name: p.name,
      })),
      agents: currentConfig?.agents?.map((a) => ({
        id: a.id,
        name: a.name,
      })),
      includeProviders: false,
      includeAgents: false,
    });
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

  const handleConfigChange = (newConfig: Record<string, unknown>) => {
    const currentConfig = config();
    const mergedConfig = {
      ...currentConfig,
      ...newConfig,
    } as AppConfig;
    updateMutation.mutateAsync(mergedConfig);
  };

  return (
    <div class="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900">
      <div class="max-w-5xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <div class="flex items-center justify-between mb-8">
          <h1 class="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Config
          </h1>

          <div class="flex items-center space-x-4">
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
              <div class="p-6">
                <DynamicConfigForm
                  config={config() as Record<string, unknown>}
                  schema={formSchema()}
                  onChange={handleConfigChange}
                  errors={{}}
                />

                <div class="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
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
