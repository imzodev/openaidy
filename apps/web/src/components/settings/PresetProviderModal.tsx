import { createSignal } from 'solid-js';
import { X } from 'lucide-solid';
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
  const [selectedModel, setSelectedModel] = createSignal(
    props.existingProvider?.models?.[0]?.id || props.preset.recommendedModel,
  );

  const handleSave = () => {
    if (!apiKey()) return;

    const provider: ProviderConfig = {
      id: props.preset.id,
      name: props.preset.name,
      vendorFamily: props.preset.vendorFamily,
      enabled: true,
      baseUrl: props.preset.baseUrl,
      apiKeyEnv: apiKey(),
      models: [
        {
          id: selectedModel(),
          name:
            props.preset.models.find(
              (m: ModelPreset) => m.id === selectedModel(),
            )?.name || selectedModel(),
        },
      ],
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
              models={props.preset.models}
              selectedModelId={selectedModel()}
              onSelect={setSelectedModel}
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
