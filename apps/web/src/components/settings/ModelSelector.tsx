import { For, Show } from 'solid-js';
import type { ModelPreset } from '@openaidy/shared-types';

interface ModelSelectorProps {
  models: ModelPreset[];
  selectedModelId: string;
  onSelect: (modelId: string) => void;
}

export function ModelSelector(props: ModelSelectorProps) {
  return (
    <div class="space-y-2">
      <For each={props.models}>
        {(model) => (
          <label
            class={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
              props.selectedModelId === model.id
                ? 'border-primary/50 bg-primary/5 dark:bg-primary/10'
                : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
            }`}
          >
            <input
              type="radio"
              name="model"
              value={model.id}
              checked={props.selectedModelId === model.id}
              onChange={() => props.onSelect(model.id)}
              class="text-primary focus:ring-primary/50"
            />
            <div class="flex-1">
              <div class="flex items-center justify-between">
                <span class="font-medium text-text-primary">{model.name}</span>
                <Show when={model.contextWindow}>
                  <span class="text-xs text-text-tertiary">
                    {model.contextWindow?.toLocaleString()} ctx
                  </span>
                </Show>
              </div>
              <Show when={model.description}>
                <span class="text-xs text-text-tertiary">
                  {model.description}
                </span>
              </Show>
            </div>
          </label>
        )}
      </For>
    </div>
  );
}
