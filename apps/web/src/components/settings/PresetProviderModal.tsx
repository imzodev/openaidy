import { createSignal, For, Show } from 'solid-js';
import { X, Plus, Trash2 } from 'lucide-solid';
import type { ProviderPreset, ModelPreset } from '@openaidy/shared-types';
import type { ProviderConfig } from '../../lib/api';
import { ApiKeyInput } from './ApiKeyInput';
import { ModelSelector } from './ModelSelector';

interface PresetProviderModalProps {
  preset: ProviderPreset;
  existingProvider?: ProviderConfig;
  onClose: () => void;
  onSave: (provider: ProviderConfig) => void;
  isPending: boolean;
}

export function PresetProviderModal(props: PresetProviderModalProps) {
  const [apiKey, setApiKey] = createSignal(
    props.existingProvider?.apiKeyEnv || '',
  );
  const [selectedModelId, setSelectedModelId] = createSignal(
    props.existingProvider?.models?.[0]?.id || props.preset.recommendedModel,
  );
  const [customModels, setCustomModels] = createSignal<
    { id: string; name: string }[]
  >(
    props.existingProvider?.models
      ?.filter((m) => !props.preset.models.some((pm) => pm.id === m.id))
      .map((m) => ({ id: m.id, name: m.name })) || [],
  );
  const [newModelId, setNewModelId] = createSignal('');
  const [newModelName, setNewModelName] = createSignal('');

  const allModels = () => [
    ...props.preset.models,
    ...customModels().map((cm) => ({
      id: cm.id,
      name: cm.name,
      custom: true as const,
    })),
  ];

  const addCustomModel = () => {
    if (!newModelId() || !newModelName()) return;
    if (customModels().some((m) => m.id === newModelId())) return;
    setCustomModels([
      ...customModels(),
      { id: newModelId(), name: newModelName() },
    ]);
    setNewModelId('');
    setNewModelName('');
  };

  const removeCustomModel = (id: string) => {
    setCustomModels(customModels().filter((m) => m.id !== id));
    if (selectedModelId() === id) {
      setSelectedModelId(props.preset.recommendedModel);
    }
  };

  const handleSave = () => {
    if (!apiKey()) return;

    const selectedPresetModel = props.preset.models.find(
      (m) => m.id === selectedModelId(),
    );
    const selectedCustomModel = customModels().find(
      (m) => m.id === selectedModelId(),
    );

    const models: ProviderConfig['models'] = [];

    if (selectedPresetModel) {
      models.push({
        id: selectedPresetModel.id,
        name: selectedPresetModel.name,
        enabled: true,
      });
    } else if (selectedCustomModel) {
      models.push({
        id: selectedCustomModel.id,
        name: selectedCustomModel.name,
        enabled: true,
      });
    }

    const provider: ProviderConfig = {
      id: props.preset.id,
      name: props.preset.name,
      vendorFamily: props.preset.vendorFamily,
      enabled: true,
      baseUrl: props.preset.baseUrl,
      apiKeyEnv: apiKey(),
      models,
    };

    props.onSave(provider);
  };

  return (
    <div class="fixed inset-0 z-50 flex items-center justify-center">
      <div
        class="absolute inset-0 bg-black/50"
        onClick={() => props.onClose()}
      />
      <div class="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto">
        <div class="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700 sticky top-0 bg-white dark:bg-gray-800">
          <h3 class="text-lg font-semibold text-text-primary">
            Configure {props.preset.name}
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
            <label class="block text-sm font-medium text-text-primary mb-2">
              API Key
            </label>
            <ApiKeyInput
              value={apiKey()}
              onInput={setApiKey}
              placeholder={`${props.preset.name} API Key`}
            />
          </div>

          <div>
            <label class="block text-sm font-medium text-text-primary mb-2">
              Model
            </label>
            <ModelSelector
              models={allModels() as ModelPreset[]}
              selectedModelId={selectedModelId()}
              onSelect={setSelectedModelId}
            />
          </div>

          <div class="pt-2 border-t border-gray-200 dark:border-gray-700">
            <label class="block text-sm font-medium text-text-primary mb-2">
              Add Custom Model
            </label>
            <div class="flex gap-2">
              <input
                type="text"
                value={newModelId()}
                onInput={(e) => setNewModelId(e.currentTarget.value)}
                placeholder="Model ID"
                class="flex-1 min-w-0 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
              <input
                type="text"
                value={newModelName()}
                onInput={(e) => setNewModelName(e.currentTarget.value)}
                placeholder="Display Name"
                class="flex-1 min-w-0 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
              <button
                onClick={addCustomModel}
                disabled={!newModelId() || !newModelName()}
                class="shrink-0 p-2 bg-primary hover:bg-primary-hover disabled:bg-primary-disabled text-white rounded-lg transition-colors"
              >
                <Plus class="w-4 h-4" />
              </button>
            </div>
          </div>

          <Show when={customModels().length > 0}>
            <div class="pt-2 border-t border-gray-200 dark:border-gray-700">
              <label class="block text-sm font-medium text-text-primary mb-2">
                Custom Models
              </label>
              <div class="space-y-2">
                <For each={customModels()}>
                  {(model) => (
                    <div class="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-700 rounded-lg">
                      <div>
                        <span class="text-sm font-medium text-text-primary">
                          {model.name}
                        </span>
                        <span class="text-xs text-text-tertiary ml-2">
                          {model.id}
                        </span>
                      </div>
                      <button
                        onClick={() => removeCustomModel(model.id)}
                        class="p-1 text-text-tertiary hover:text-red-500 transition-colors"
                      >
                        <Trash2 class="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </Show>
        </div>

        <div class="flex items-center justify-end gap-3 p-4 border-t border-gray-200 dark:border-gray-700 sticky bottom-0 bg-white dark:bg-gray-800">
          <button
            onClick={() => props.onClose()}
            class="px-4 py-2 text-sm font-medium text-text-secondary hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={props.isPending || !apiKey()}
            class="px-4 py-2 text-sm font-medium text-white bg-primary hover:bg-primary-hover disabled:bg-primary-disabled disabled:cursor-not-allowed rounded-lg transition-colors"
          >
            {props.isPending ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
