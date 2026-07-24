import { Show } from 'solid-js';
import { Check } from 'lucide-solid';
import 'bootstrap-icons/font/bootstrap-icons.css';
import type { PersonalityPresetCardProps } from './PersonalityPresetCard.types';

/**
 * A selectable card for one prebuilt agent personality. Mirrors
 * PresetProviderCard's look; selecting it prefills the create form.
 */
export function PersonalityPresetCard(props: PersonalityPresetCardProps) {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      props.onSelect(props.preset);
    }
  };

  return (
    <div
      role="button"
      tabindex="0"
      aria-pressed={props.selected}
      aria-label={`Use the ${props.preset.name} personality`}
      onClick={() => props.onSelect(props.preset)}
      onKeyDown={handleKeyDown}
      class={`group relative flex items-start gap-3 p-3 rounded-lg border transition-all duration-200 cursor-pointer ${
        props.selected
          ? 'border-primary/60 bg-primary/[0.06] dark:bg-primary/[0.08]'
          : 'border-gray-200 dark:border-gray-700 hover:border-primary/40 hover:bg-gray-50/50 dark:hover:bg-gray-800/30'
      }`}
    >
      {/* Icon */}
      <div
        class={`shrink-0 w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
          props.selected
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
          <Show when={props.selected}>
            <Check class="w-3.5 h-3.5 text-primary shrink-0" />
          </Show>
        </div>
        <span class="block text-xs text-text-tertiary line-clamp-2">
          {props.preset.description}
        </span>
      </div>
    </div>
  );
}
