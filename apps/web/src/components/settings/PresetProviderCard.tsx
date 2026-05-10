import { Show } from 'solid-js';
import { Check, Settings2 } from 'lucide-solid';
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
      class={`group relative flex items-center gap-3 p-3 rounded-lg border transition-all duration-200 ${
        props.isConfigured
          ? 'border-primary/40 bg-primary/[0.03] dark:bg-primary/[0.05] hover:border-primary/60 hover:bg-primary/[0.06]'
          : 'border-gray-200 dark:border-gray-700 hover:border-primary/40 hover:bg-gray-50/50 dark:hover:bg-gray-800/30'
      }`}
    >
      {/* Icon */}
      <div
        class={`shrink-0 w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
          props.isConfigured
            ? 'bg-primary/10 text-primary'
            : 'bg-gray-100 dark:bg-gray-800 text-text-secondary group-hover:bg-primary/10 group-hover:text-primary'
        }`}
      >
        <i class={`bi ${props.preset.icon} text-base`}></i>
      </div>

      {/* Content */}
      <div class="flex-1 min-w-0 text-left">
        <div class="flex items-center gap-2">
          <span class="text-sm font-medium text-text-primary truncate">
            {props.preset.name}
          </span>
          <Show when={props.isConfigured}>
            <Check class="w-3.5 h-3.5 text-green-500 shrink-0" />
          </Show>
        </div>
        <span class="text-xs text-text-tertiary">
          {props.preset.models.length} models
        </span>
      </div>

      {/* Action Indicator */}
      <div
        class={`shrink-0 w-7 h-7 rounded-md flex items-center justify-center transition-all ${
          props.isConfigured
            ? 'bg-primary/10 text-primary'
            : 'bg-transparent text-text-tertiary group-hover:bg-gray-100 dark:group-hover:bg-gray-700 group-hover:text-text-secondary'
        }`}
      >
        <Show
          when={props.isConfigured}
          fallback={<span class="text-xs font-medium">+</span>}
        >
          <Settings2 class="w-3.5 h-3.5" />
        </Show>
      </div>
    </button>
  );
}
