/**
 * Number field renderer
 *
 * Renders numeric inputs with optional min/max/step constraints.
 * Uses local state to prevent focus loss on every keystroke.
 */

import { createSignal, createEffect } from 'solid-js';
import type { FieldRendererProps, FieldRenderer } from './types';
import { FieldLabel } from './FieldLabel';

export const NumberField: FieldRenderer = (props: FieldRendererProps) => {
  // Local state to prevent focus loss on every keystroke
  const getInitialValue = () => {
    const v = props.value;
    return typeof v === 'number' ? v : '';
  };
  const [localValue, setLocalValue] = createSignal<string | number>(
    getInitialValue(),
  );

  // Sync local state when props.value changes externally
  createEffect(() => {
    const v = props.value;
    setLocalValue(typeof v === 'number' ? v : '');
  });

  const handleInput = (e: Event) => {
    const target = e.currentTarget as HTMLInputElement;
    setLocalValue(target.value);
    // Don't call props.onChange here - that causes re-render and focus loss
  };

  const handleBlur = () => {
    // Only propagate changes to parent on blur
    const numValue = parseFloat(localValue() as string);
    if (!Number.isNaN(numValue)) {
      props.onChange(numValue);
    }
  };

  return (
    <div class="field-container mb-4">
      <FieldLabel schema={props.schema} error={props.error} />

      <input
        type="number"
        value={localValue()}
        onInput={handleInput}
        onBlur={handleBlur}
        placeholder={props.schema.placeholder}
        disabled={props.disabled}
        min={props.schema.min}
        max={props.schema.max}
        step={props.schema.step ?? 1}
        class="w-full bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
      />
    </div>
  );
};
