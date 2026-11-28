import { Show, For, createSignal } from 'solid-js';
import { Brain, ChevronDown, X } from 'lucide-solid';
import {
  REASONING_EFFORT_LABELS,
  type ReasoningEffort,
  type ThinkingPickerProps,
} from '@aidyagent/shared-types';

/**
 * How hard the model thinks in this conversation. "Auto" defers to the
 * agent's default (or the model's own when the agent has none). Rendered
 * only for models with a known thinking control, so every option shown is
 * one the model accepts.
 */
export function ThinkingPicker(props: ThinkingPickerProps) {
  const [isOpen, setIsOpen] = createSignal(false);
  const variant = () => props.variant ?? 'inline';

  const autoLabel = () =>
    props.agentDefault
      ? `Auto (${REASONING_EFFORT_LABELS[props.agentDefault]})`
      : 'Auto';
  const selectedLabel = () =>
    props.value ? REASONING_EFFORT_LABELS[props.value] : autoLabel();

  const handleSelect = (value: ReasoningEffort | undefined) => {
    props.onChange(value);
    setIsOpen(false);
  };

  const optionClass = (active: boolean) =>
    `w-full px-3 py-3 md:py-2 rounded-lg text-left text-[13px] hover:bg-fill flex items-center gap-2 ${
      active
        ? 'bg-fill-strong text-text-primary font-medium'
        : 'text-text-secondary'
    }`;

  const OptionList = () => (
    <>
      <button
        type="button"
        onClick={() => handleSelect(undefined)}
        class={optionClass(props.value === undefined)}
      >
        <span>{autoLabel()}</span>
      </button>
      <div class="h-px bg-separator my-1 mx-2" />
      <For each={props.levels}>
        {(level) => (
          <button
            type="button"
            onClick={() => handleSelect(level)}
            class={optionClass(props.value === level)}
          >
            <span>{REASONING_EFFORT_LABELS[level]}</span>
          </button>
        )}
      </For>
    </>
  );

  return (
    <div
      class={
        variant() === 'inline' ? 'relative flex-shrink-0' : 'flex-shrink-0'
      }
    >
      <Show
        when={variant() === 'icon'}
        fallback={
          <button
            type="button"
            onClick={() => !props.disabled && setIsOpen(!isOpen())}
            disabled={props.disabled}
            aria-label="Thinking effort"
            title="How hard the model thinks"
            class="flex items-center gap-1.5 pl-2.5 pr-2 h-9 rounded-full bg-fill hover:bg-fill-strong disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Brain class="w-4 h-4 text-text-tertiary" />
            <span class="text-[13px] font-medium text-text-secondary whitespace-nowrap">
              {selectedLabel()}
            </span>
            <ChevronDown class="w-4 h-4 text-text-tertiary" />
          </button>
        }
      >
        <button
          type="button"
          onClick={() => !props.disabled && setIsOpen(true)}
          disabled={props.disabled}
          aria-label="Thinking effort"
          title={`Thinking: ${selectedLabel()}`}
          class={`flex items-center justify-center w-8 h-8 rounded-full bg-fill hover:bg-fill-strong disabled:opacity-50 disabled:cursor-not-allowed ${
            props.value ? 'text-primary' : 'text-text-tertiary'
          }`}
        >
          <Brain class="w-4 h-4" />
        </button>
      </Show>

      <Show when={isOpen() && variant() === 'inline'}>
        <div
          class="fixed inset-0 z-40"
          onClick={() => setIsOpen(false)}
          aria-hidden="true"
        />
        <div class="absolute bottom-full left-0 mb-2 min-w-[160px] material-sheet rounded-xl shadow-xl ring-1 ring-black/5 dark:ring-white/10 z-50 p-1 animate-sheet-in">
          <div class="px-3 pt-1.5 pb-1 text-[11px] text-text-muted">
            Thinking
          </div>
          <OptionList />
        </div>
      </Show>

      <Show when={isOpen() && variant() === 'icon'}>
        <div
          class="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px] animate-fade-in"
          onClick={() => setIsOpen(false)}
        />
        <div class="fixed inset-x-0 bottom-0 z-50 rounded-t-[22px] material-sheet shadow-2xl max-h-[70vh] overflow-y-auto pb-[max(1.5rem,env(safe-area-inset-bottom))] animate-sheet-in">
          <div class="sticky top-0 flex items-center justify-between px-4 py-3 hairline-b material-sheet">
            <span class="text-sm font-medium text-text-primary">Thinking</span>
            <button
              type="button"
              aria-label="Close thinking picker"
              onClick={() => setIsOpen(false)}
              class="p-1 text-text-tertiary hover:text-text-primary"
            >
              <X class="w-5 h-5" />
            </button>
          </div>
          <OptionList />
        </div>
      </Show>
    </div>
  );
}
