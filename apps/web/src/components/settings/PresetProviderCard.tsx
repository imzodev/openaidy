import { Show } from 'solid-js';
import { Check, Settings2, Unplug } from 'lucide-solid';
import 'bootstrap-icons/font/bootstrap-icons.css';
import type { PresetProviderCardProps } from './PresetProviderCard.types';

export function PresetProviderCard(props: PresetProviderCardProps) {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      props.onSelect(props.preset);
    }
  };

  const handleDisconnectClick = (e: MouseEvent) => {
    // Stop the parent button from also receiving the click and
    // opening the management modal.
    e.stopPropagation();
    props.onDisconnect?.(props.preset);
  };

  return (
    <div
      role="button"
      tabindex="0"
      aria-label={`${props.isConfigured ? 'Manage' : 'Add'} ${props.preset.name}`}
      onClick={() => props.onSelect(props.preset)}
      onKeyDown={handleKeyDown}
      class={`group relative flex items-center gap-3 p-3 rounded-lg border transition-all duration-200 cursor-pointer ${
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

      {/* Inline disconnect shortcut — only when configured AND a
          callback is provided. Lives in the top-right corner so it
          doesn't compete with the main click target. */}
      <Show when={props.isConfigured && props.onDisconnect}>
        <button
          type="button"
          onClick={handleDisconnectClick}
          disabled={props.isDisconnectPending}
          title="Disconnect"
          aria-label={`Disconnect ${props.preset.name}`}
          class="absolute top-1.5 right-1.5 p-1 rounded text-text-tertiary hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed opacity-0 group-hover:opacity-100 focus:opacity-100"
        >
          <Unplug class="w-3.5 h-3.5" />
        </button>
      </Show>
    </div>
  );
}
