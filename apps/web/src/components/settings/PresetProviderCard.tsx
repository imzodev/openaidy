import { Show } from 'solid-js';
import { Check } from 'lucide-solid';
import type { ProviderPreset } from '@openaidy/shared-types';
import 'bootstrap-icons/font/bootstrap-icons.css';

interface PresetProviderCardProps {
  preset: ProviderPreset;
  isConfigured: boolean;
  onSelect: (preset: ProviderPreset) => void;
}

export function PresetProviderCard(props: PresetProviderCardProps) {
  return (
    <button
      onClick={() => props.onSelect(props.preset)}
      class={`group relative flex flex-col items-center p-4 rounded-xl border transition-all min-h-[120px] ${
        props.isConfigured
          ? 'border-primary/30 bg-primary/5 dark:bg-primary/10 hover:border-primary/50'
          : 'border-gray-200 dark:border-gray-700 hover:border-primary/50 hover:bg-gray-50 dark:hover:bg-gray-800/50'
      }`}
    >
      <Show when={props.isConfigured}>
        <div class="absolute top-2 right-2 w-5 h-5 rounded-full bg-green-500 flex items-center justify-center">
          <Check class="w-3 h-3 text-white" />
        </div>
      </Show>

      <div class="w-10 h-10 rounded-full bg-gradient-to-br from-primary/20 to-primary/10 flex items-center justify-center mb-3">
        <i class={`bi ${props.preset.icon} text-lg text-primary`}></i>
      </div>

      <span class="text-sm font-semibold text-text-primary text-center leading-tight mb-1">
        {props.preset.name}
      </span>

      <span class="text-xs text-text-tertiary mb-3">
        {props.preset.models.length} models
      </span>

      <span
        class={`mt-auto text-xs px-3 py-1 rounded-full ${
          props.isConfigured
            ? 'bg-primary/10 text-primary'
            : 'bg-gray-100 dark:bg-gray-800 text-text-secondary group-hover:bg-primary/10 group-hover:text-primary'
        }`}
      >
        {props.isConfigured ? 'Edit' : 'Connect'}
      </span>
    </button>
  );
}
