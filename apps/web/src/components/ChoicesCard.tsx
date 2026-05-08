import { createSignal, For, onMount } from 'solid-js';
import { X } from 'lucide-solid';

export type ChoicesCardProps = {
  question?: string;
  choices: string[];
  onSelect: (choice: string) => void;
  onDismiss: () => void;
};

export function ChoicesCard(props: ChoicesCardProps) {
  const [focusedIndex, setFocusedIndex] = createSignal(0);
  let listRef: HTMLDivElement | undefined;

  onMount(() => {
    // Focus the list on mount so keyboard nav starts immediately
    listRef?.focus();
  });

  const handleKeyDown = (e: KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setFocusedIndex((i) => (i + 1) % props.choices.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusedIndex(
          (i) => (i - 1 + props.choices.length) % props.choices.length,
        );
        break;
      case 'Enter':
        e.preventDefault();
        props.onSelect(props.choices[focusedIndex()]);
        break;
      case 'Escape':
        e.preventDefault();
        props.onDismiss();
        break;
    }
  };

  return (
    <div class="mx-4 my-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg ring-1 ring-gray-900/5 overflow-hidden">
      {/* Header */}
      <div class="flex items-start justify-between px-4 pt-3 pb-2">
        <div class="flex-1 min-w-0">
          {props.question && (
            <p class="text-sm font-medium text-text-primary">
              {props.question}
            </p>
          )}
          {!props.question && (
            <p class="text-sm font-medium text-text-primary">
              Choose an option
            </p>
          )}
        </div>
        <button
          onClick={props.onDismiss}
          class="flex-shrink-0 p-1 rounded text-text-tertiary hover:text-text-primary hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          aria-label="Dismiss"
        >
          <X class="w-4 h-4" />
        </button>
      </div>

      {/* Choices listbox */}
      <div
        ref={listRef}
        role="listbox"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        class="px-3 pb-3 focus:outline-none"
        aria-label="Choices"
      >
        <For each={props.choices}>
          {(choice, index) => (
            <button
              type="button"
              role="option"
              aria-selected={focusedIndex() === index()}
              onClick={() => props.onSelect(choice)}
              onMouseEnter={() => setFocusedIndex(index())}
              class={[
                'w-full text-left px-3 py-2 rounded-lg mb-1 last:mb-0 transition-colors',
                focusedIndex() === index()
                  ? 'bg-primary/10 text-primary border border-primary/30'
                  : 'bg-gray-50 dark:bg-gray-900 text-text-primary border border-transparent hover:bg-gray-100 dark:hover:bg-gray-700',
              ].join(' ')}
            >
              <span class="text-sm font-medium">{choice}</span>
            </button>
          )}
        </For>
      </div>
    </div>
  );
}
