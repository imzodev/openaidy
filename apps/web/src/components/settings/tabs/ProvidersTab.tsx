import { createSignal, Show, For } from 'solid-js';
import { Settings2, Sparkles, X } from 'lucide-solid';
import { PresetProviderCard } from '../PresetProviderCard';
import { PresetProviderModal } from '../PresetProviderModal';
import { DialogConnectProvider } from '../../providers/DialogConnectProvider';
import {
  DynamicConfigForm,
  getProvidersSectionSchemaWithModels,
} from '../../../config';
import { CollapsibleCard } from '../../ui';
import type { AppConfig, ProviderConfig } from '../../../lib/api';
import type { ProviderPreset, ProviderPresetId } from '@openaidy/shared-types';
import { PROVIDER_PRESETS } from '@openaidy/shared-types';

const READY_PROVIDER_IDS = new Set(PROVIDER_PRESETS.map((p) => p.id));

interface ProvidersTabProps {
  config: () => AppConfig | undefined;
  isPending: boolean;
  onAddProvider: (provider: ProviderConfig) => void;
  onDeleteProvider: (providerId: string) => void;
  onUpdateProvider: (providerId: string, provider: ProviderConfig) => void;
}

export function ProvidersTab(props: ProvidersTabProps) {
  const [selectedPreset, setSelectedPreset] =
    createSignal<ProviderPreset | null>(null);
  const [showCustomModal, setShowCustomModal] = createSignal(false);
  const [connectingProvider, setConnectingProvider] =
    createSignal<ProviderPreset | null>(null);

  const getCustomProviders = (): ProviderConfig[] => {
    return (
      props
        .config()
        ?.providers?.filter(
          (p) => !READY_PROVIDER_IDS.has(p.id as ProviderPresetId),
        ) ?? []
    );
  };

  const hasCustomProviders = () => getCustomProviders().length > 0;

  const handleSavePreset = (provider: ProviderConfig) => {
    const existing = props
      .config()
      ?.providers?.find((p) => p.id === provider.id);
    if (existing) {
      props.onUpdateProvider(provider.id, provider);
    } else {
      props.onAddProvider(provider);
    }
    setSelectedPreset(null);
  };

  return (
    <div class="p-4 sm:p-6 space-y-5 sm:space-y-6">
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
        <div>
          <h2 class="text-lg font-semibold text-text-primary">Providers</h2>
          <p class="text-sm text-text-tertiary mt-0.5">
            Configure AI providers for your agents
          </p>
        </div>
        <button
          onClick={() => setShowCustomModal(true)}
          disabled={props.isPending}
          class="flex items-center justify-center gap-2 px-3 py-1.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-text-primary rounded-lg transition-colors text-sm font-medium shrink-0"
        >
          <Settings2 class="w-4 h-4" />
          Add Custom
        </button>
      </div>

      {/* Ready Providers Grid */}
      <div>
        <div class="flex items-center gap-2 mb-3">
          <Sparkles class="w-4 h-4 text-primary" />
          <h3 class="text-sm font-medium text-text-primary">Ready Providers</h3>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-2 gap-2">
          <For each={PROVIDER_PRESETS as ProviderPreset[]}>
            {(preset) => {
              const isConfigured = () =>
                props.config()?.providers?.some((p) => p.id === preset.id) ??
                false;
              const handleSelect = () => {
                if (isConfigured()) {
                  // If configured, show the config modal
                  setSelectedPreset(preset);
                } else {
                  // If not configured, show connection dialog
                  setConnectingProvider(preset);
                }
              };
              return (
                <PresetProviderCard
                  preset={preset}
                  isConfigured={isConfigured()}
                  onSelect={handleSelect}
                />
              );
            }}
          </For>
        </div>
      </div>

      {/* Custom Providers Section */}
      <Show when={hasCustomProviders()}>
        <div>
          <h3 class="text-sm font-medium text-text-primary mb-3 flex items-center gap-2">
            <Settings2 class="w-4 h-4 text-text-tertiary" />
            Custom Providers
          </h3>
          <div class="space-y-3">
            <For each={getCustomProviders()}>
              {(provider, index) => (
                <CollapsibleCard
                  title={provider.name}
                  index={index()}
                  badge={provider.vendorFamily}
                  badgeVariant="info"
                  showEnabled
                  enabled={provider.enabled}
                  onDelete={() => props.onDeleteProvider(provider.id)}
                  isPending={props.isPending}
                >
                  <DynamicConfigForm
                    config={
                      { providers: [provider] } as Record<string, unknown>
                    }
                    schema={{
                      sections: [getProvidersSectionSchemaWithModels(provider)],
                    }}
                    onChange={(newConfig) =>
                      props.onUpdateProvider(
                        provider.id,
                        (newConfig as { providers: ProviderConfig[] })
                          .providers[0],
                      )
                    }
                    errors={{}}
                  />
                </CollapsibleCard>
              )}
            </For>
          </div>
        </div>
      </Show>

      {/* Empty State */}
      <Show when={!hasCustomProviders()}>
        <div class="text-center py-8 text-text-tertiary">
          <p>No providers configured yet.</p>
          <p class="text-sm mt-2">
            Add a Ready Provider above or create a custom one.
          </p>
        </div>
      </Show>

      {/* Preset Modal */}
      <Show when={selectedPreset()}>
        <PresetProviderModal
          preset={selectedPreset()!}
          existingProvider={
            props
              .config()
              ?.providers?.find((p) => p.id === selectedPreset()!.id) as
              | ProviderConfig
              | undefined
          }
          onClose={() => setSelectedPreset(null)}
          onSave={handleSavePreset}
          isPending={props.isPending}
        />
      </Show>

      {/* Custom Provider Modal */}
      <Show when={showCustomModal()}>
        <CustomProviderModal
          onClose={() => setShowCustomModal(false)}
          onSave={(provider) => {
            props.onAddProvider(provider);
            setShowCustomModal(false);
          }}
          isPending={props.isPending}
        />
      </Show>

      {/* Connect Provider Dialog */}
      <DialogConnectProvider
        provider={connectingProvider()}
        onClose={() => setConnectingProvider(null)}
        onConnected={(providerId, _authMethod) => {
          setConnectingProvider(null);
          // Find the preset and open the preset modal to configure
          const preset = PROVIDER_PRESETS.find((p) => p.id === providerId);
          if (preset) {
            setSelectedPreset(preset);
          }
        }}
      />
    </div>
  );
}

interface CustomProviderModalProps {
  onClose: () => void;
  onSave: (provider: ProviderConfig) => void;
  isPending: boolean;
}

function CustomProviderModal(props: CustomProviderModalProps) {
  const [id, setId] = createSignal('');
  const [name, setName] = createSignal('');
  const [vendorFamily, setVendorFamily] = createSignal<
    'openai-compatible' | 'anthropic' | 'gemini'
  >('openai-compatible');
  const [baseUrl, setBaseUrl] = createSignal('');
  const [apiKeyEnv, setApiKeyEnv] = createSignal('');

  const handleSave = () => {
    if (!id() || !name()) return;

    const provider: ProviderConfig = {
      id: id(),
      name: name(),
      vendorFamily: vendorFamily(),
      enabled: true,
      baseUrl: baseUrl() || undefined,
      apiKeyEnv: apiKeyEnv() || undefined,
      models: [],
    };

    props.onSave(provider);
  };

  return (
    <div class="fixed inset-0 z-50 flex items-center justify-center">
      <div
        class="absolute inset-0 bg-black/50"
        onClick={() => props.onClose()}
      />
      <div class="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4">
        <div class="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h3 class="text-lg font-semibold text-text-primary">
            Add Custom Provider
          </h3>
          <button
            onClick={() => props.onClose()}
            class="p-1 text-text-tertiary hover:text-text-secondary"
          >
            <X class="w-5 h-5" />
          </button>
        </div>

        <div class="p-4 space-y-4">
          <div>
            <label class="block text-sm font-medium text-text-primary mb-1">
              Provider ID <span class="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={id()}
              onInput={(e) => setId(e.currentTarget.value)}
              placeholder="e.g., custom-ai"
              class="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          <div>
            <label class="block text-sm font-medium text-text-primary mb-1">
              Display Name <span class="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name()}
              onInput={(e) => setName(e.currentTarget.value)}
              placeholder="e.g., Custom AI"
              class="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          <div>
            <label class="block text-sm font-medium text-text-primary mb-1">
              Vendor Family
            </label>
            <select
              value={vendorFamily()}
              onChange={(e) =>
                setVendorFamily(
                  e.currentTarget.value as
                    | 'openai-compatible'
                    | 'anthropic'
                    | 'gemini',
                )
              }
              class="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              <option value="openai-compatible">OpenAI Compatible</option>
              <option value="anthropic">Anthropic</option>
              <option value="gemini">Google Gemini</option>
            </select>
          </div>

          <div>
            <label class="block text-sm font-medium text-text-primary mb-1">
              Base URL
            </label>
            <input
              type="text"
              value={baseUrl()}
              onInput={(e) => setBaseUrl(e.currentTarget.value)}
              placeholder="e.g., https://api.custom.ai/v1"
              class="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          <div>
            <label class="block text-sm font-medium text-text-primary mb-1">
              API Key Env Variable
            </label>
            <input
              type="text"
              value={apiKeyEnv()}
              onInput={(e) => setApiKeyEnv(e.currentTarget.value)}
              placeholder="e.g., CUSTOM_AI_API_KEY"
              class="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
        </div>

        <div class="flex items-center justify-end gap-3 p-4 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={() => props.onClose()}
            class="px-4 py-2 text-sm font-medium text-text-secondary hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={props.isPending || !id() || !name()}
            class="px-4 py-2 text-sm font-medium text-white bg-primary hover:bg-primary-hover disabled:bg-primary-disabled disabled:cursor-not-allowed rounded-lg transition-colors"
          >
            {props.isPending ? 'Adding...' : 'Add Provider'}
          </button>
        </div>
      </div>
    </div>
  );
}
