/**
 * Text field renderer
 *
 * Renders string inputs including single-line and multi-line (textarea) fields.
 */

import { Show } from 'solid-js';
import type { FieldRendererProps, FieldRenderer } from './types';
import { FieldLabel } from './FieldLabel';

export const TextField: FieldRenderer = (props: FieldRendererProps) => {
  const value = () => (props.value as string | undefined) ?? '';
  const multiline = () => props.schema.multiline ?? false;

  const handleChange = (e: Event) => {
    const target = e.currentTarget as HTMLInputElement | HTMLTextAreaElement;
    props.onChange(target.value);
  };

  return (
    <div class="field-container mb-4">
      <FieldLabel schema={props.schema} error={props.error} />

      <Show
        when={!multiline()}
        fallback={
          <textarea
            value={value()}
            onInput={handleChange}
            placeholder={props.schema.placeholder}
            disabled={props.disabled}
            rows={4}
            class="w-full bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed resize-y"
          />
        }
      >
        <input
          type="text"
          value={value()}
          onInput={handleChange}
          placeholder={props.schema.placeholder}
          disabled={props.disabled}
          class="w-full bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
        />
      </Show>
    </div>
  );
};
