import { For, Show } from 'solid-js';
import type { ModelPreset } from '@openaidy/shared-types';

interface ModelMultiSelectProps {
  models: ModelPreset[];
  selectedIds: ReadonlySet<string>;
  onToggle: (modelId: string) => void;
}

/**
 * Checkbox list for picking which preset models are available
 * for agent assignment. All entries are checked by default; the
 * parent owns the selected set so the same state can drive
 * downstream splits (e.g. OpenCode Go routes some models to a
 * separate `opencode-go-anthropic` provider).
 */
export function ModelMultiSelect(props: ModelMultiSelectProps) {
  return (
    <div class="space-y-2">
      <For each={props.models}>
        {(model) => {
          const isChecked = () => props.selectedIds.has(model.id);
          return (
            <label
              class={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                isChecked()
                  ? 'border-primary/50 bg-primary/5 dark:bg-primary/10'
                  : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
              }`}
            >
              <input
                type="checkbox"
                checked={isChecked()}
                onChange={() => props.onToggle(model.id)}
                class="text-primary focus:ring-primary/50 rounded"
              />
              <div class="flex-1 min-w-0">
                <div class="flex items-center justify-between gap-2">
                  <span class="font-medium text-text-primary truncate">
                    {model.name}
                  </span>
                  <Show when={model.contextWindow}>
                    <span class="text-xs text-text-tertiary shrink-0">
                      {Number(model.contextWindow).toLocaleString()} ctx
                    </span>
                  </Show>
                </div>
                <Show when={model.description}>
                  <span class="text-xs text-text-tertiary block truncate">
                    {model.description}
                  </span>
                </Show>
              </div>
            </label>
          );
        }}
      </For>
    </div>
  );
}
