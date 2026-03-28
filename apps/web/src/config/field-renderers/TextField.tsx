/**
 * Text field renderer
 *
 * Renders string inputs including single-line and multi-line (textarea) fields.
 * Uses local state to prevent focus loss on every keystroke.
 */

import { Show, createSignal, createEffect } from 'solid-js';
import type { FieldRendererProps, FieldRenderer } from './types';
import { FieldLabel } from './FieldLabel';

export const TextField: FieldRenderer = (props: FieldRendererProps) => {
  // Local state to prevent focus loss on every keystroke
  const [localValue, setLocalValue] = createSignal(
    (props.value as string | undefined) ?? '',
  );
  const multiline = () => props.schema.multiline ?? false;

  // Sync local state when props.value changes externally
  createEffect(() => {
    setLocalValue((props.value as string | undefined) ?? '');
  });

  const handleInput = (e: Event) => {
    const target = e.currentTarget as HTMLInputElement | HTMLTextAreaElement;
    setLocalValue(target.value);
    // Don't call props.onChange here - that causes re-render and focus loss
  };

  const handleBlur = () => {
    // Only propagate changes to parent on blur
    props.onChange(localValue());
  };

  return (
    <div class="field-container mb-4">
      <FieldLabel schema={props.schema} error={props.error} />

      <Show
        when={!multiline()}
        fallback={
          <textarea
            value={localValue()}
            onInput={handleInput}
            onBlur={handleBlur}
            placeholder={props.schema.placeholder}
            disabled={props.disabled}
            rows={4}
            class="w-full bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed resize-y"
          />
        }
      >
        <input
          type="text"
          value={localValue()}
          onInput={handleInput}
          onBlur={handleBlur}
          placeholder={props.schema.placeholder}
          disabled={props.disabled}
          class="w-full bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
        />
      </Show>
    </div>
  );
};
